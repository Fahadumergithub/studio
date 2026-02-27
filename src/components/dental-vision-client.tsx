'use client';

import { useState, useRef, useTransition, useEffect, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { Upload, Bot, ScanLine, Eye, Camera, Info, Loader2, Target, Sparkles, BookOpen, GraduationCap, ChevronRight, XCircle, HelpCircle, AlertTriangle, RefreshCcw, ArrowRight, CheckCircle2, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { runAnalysis, getClinicalInsights, getFindingLocations } from '@/app/actions';
import type { AiRadiographDetectionOutput } from '@/ai/flows/ai-radiograph-detection-flow';
import type { RadiographTutorOutput } from '@/ai/flows/radiograph-tutor-flow';
import type { LocateFindingsOutput } from '@/ai/flows/locate-findings-flow';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

type AnalysisResults = AiRadiographDetectionOutput['results'];
type Hotspots = LocateFindingsOutput['hotspots'];

// ─── Quad types ───────────────────────────────────────────────────────────────
interface QuadPoint { x: number; y: number; } // 0–1 normalized to canvas dims
type Quad = [QuadPoint, QuadPoint, QuadPoint, QuadPoint]; // TL TR BR BL

// ─── Coordinate helpers ───────────────────────────────────────────────────────

/**
 * Returns the rendered image rect inside an object-contain container.
 * Accounts for letterbox / pillarbox black bars.
 */
function getRenderedImageRect(
  containerW: number, containerH: number,
  imageW: number, imageH: number
) {
  const cr = containerW / containerH;
  const ir = imageW / imageH;
  let width: number, height: number;
  if (ir > cr) { width = containerW; height = containerW / ir; }
  else         { height = containerH; width = containerH * ir; }
  return {
    left:   (containerW - width)  / 2,
    top:    (containerH - height) / 2,
    width,
    height,
  };
}

// ─── Auto-detect OPG ─────────────────────────────────────────────────────────

const FALLBACK_QUAD: Quad = [
  { x: 0.05, y: 0.10 }, { x: 0.95, y: 0.10 },
  { x: 0.95, y: 0.90 }, { x: 0.05, y: 0.90 },
];

function autoDetectOPG(srcCanvas: HTMLCanvasElement): Quad {
  // Guard: canvas must have valid pixel data
  if (!srcCanvas || srcCanvas.width < 4 || srcCanvas.height < 4) return FALLBACK_QUAD;

  const SCALE = 0.25;
  const tmp = document.createElement('canvas');
  tmp.width  = Math.max(1, Math.round(srcCanvas.width  * SCALE));
  tmp.height = Math.max(1, Math.round(srcCanvas.height * SCALE));

  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = tmp.getContext('2d');
    if (!ctx) return FALLBACK_QUAD;
    ctx.drawImage(srcCanvas, 0, 0, tmp.width, tmp.height);
  } catch {
    return FALLBACK_QUAD;
  }

  const { data, width, height } = ctx.getImageData(0, 0, tmp.width, tmp.height);
  const lums = new Uint8Array(width * height);

  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const l = (data[i]*77 + data[i+1]*150 + data[i+2]*29) >> 8;
    lums[i >> 2] = l;
    total += l;
  }
  const mean = total / lums.length;

  // Try BOTH modes: OPG darker than background (classic), or lighter (screen glow)
  // Run both and pick whichever gives a more reasonable bounding box
  const pad = 0.02;

  function findBBox(targetDark: boolean): { minX:number; maxX:number; minY:number; maxY:number; count:number } {
    // For dark OPG: pixels significantly below mean
    // For light OPG: pixels significantly above mean
    const threshold = targetDark ? mean - 30 : mean + 30;
    let minX = width, maxX = 0, minY = height, maxY = 0, count = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const l = lums[y * width + x];
        const match = targetDark ? l < threshold : l > threshold;
        if (match) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          count++;
        }
      }
    }
    return { minX, maxX, minY, maxY, count };
  }

  function scoreBox(b: ReturnType<typeof findBBox>): number {
    if (b.count < 150) return 0;
    const area = (b.maxX - b.minX) * (b.maxY - b.minY);
    const frameArea = width * height;
    if (area < frameArea * 0.03 || area > frameArea * 0.96) return 0;
    // Prefer boxes that are landscape-ish (OPG aspect ratio ~2:1)
    const aspect = (b.maxX - b.minX) / Math.max(1, b.maxY - b.minY);
    const aspectScore = aspect > 1.0 ? 1.0 : 0.5; // reward landscape boxes
    return (area / frameArea) * aspectScore;
  }

  const darkBox  = findBBox(true);
  const lightBox = findBBox(false);
  const darkScore  = scoreBox(darkBox);
  const lightScore = scoreBox(lightBox);

  const best = darkScore >= lightScore ? darkBox : lightBox;

  if (scoreBox(best) > 0) {
    return [
      { x: Math.max(0, best.minX/width  - pad), y: Math.max(0, best.minY/height - pad) },
      { x: Math.min(1, best.maxX/width  + pad), y: Math.max(0, best.minY/height - pad) },
      { x: Math.min(1, best.maxX/width  + pad), y: Math.min(1, best.maxY/height + pad) },
      { x: Math.max(0, best.minX/width  - pad), y: Math.min(1, best.maxY/height + pad) },
    ];
  }

  return FALLBACK_QUAD;
}

// ─── Perspective warp ─────────────────────────────────────────────────────────

function solveHomography(src: [number,number][], dst: [number,number][]): number[] {
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [xs, ys] = src[i], [xd, yd] = dst[i];
    A.push([xs, ys, 1, 0, 0, 0, -xd*xs, -xd*ys]);
    A.push([0,  0,  0, xs, ys, 1, -yd*xs, -yd*ys]);
    b.push(xd, yd);
  }
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 8; col++) {
    let maxRow = col;
    for (let row = col+1; row < 8; row++)
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    const piv = M[col][col];
    if (Math.abs(piv) < 1e-10) continue;
    for (let j = col; j <= 8; j++) M[col][j] /= piv;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const f = M[row][col];
      for (let j = col; j <= 8; j++) M[row][j] -= f * M[col][j];
    }
  }
  return [...M.map(r => r[8]), 1];
}

function warpPerspective(srcCanvas: HTMLCanvasElement, quad: Quad, outW = 1200, outH = 600): string {
  const W = srcCanvas.width, H = srcCanvas.height;
  const srcPts = quad.map(({ x, y }): [number,number] => [x*W, y*H]);
  const dstPts: [number,number][] = [[0,0],[outW,0],[outW,outH],[0,outH]];
  const h = solveHomography(dstPts, srcPts);

  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const octx = out.getContext('2d')!;
  const srcData = srcCanvas.getContext('2d')!.getImageData(0, 0, W, H);
  const outData = octx.createImageData(outW, outH);

  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      const w2 = h[6]*dx + h[7]*dy + 1;
      const sx = Math.round((h[0]*dx + h[1]*dy + h[2]) / w2);
      const sy = Math.round((h[3]*dx + h[4]*dy + h[5]) / w2);
      const di = (dy*outW + dx) * 4;
      if (sx >= 0 && sx < W && sy >= 0 && sy < H) {
        const si = (sy*W + sx) * 4;
        outData.data[di]   = srcData.data[si];
        outData.data[di+1] = srcData.data[si+1];
        outData.data[di+2] = srcData.data[si+2];
        outData.data[di+3] = srcData.data[si+3];
      }
    }
  }
  octx.putImageData(outData, 0, 0);
  return out.toDataURL('image/jpeg', 0.92);
}

// ─── VerifyStage component ────────────────────────────────────────────────────

interface VerifyStageProps {
  imageUri: string;
  naturalW: number;
  naturalH: number;
  quad: Quad;
  onQuadChange: (q: Quad) => void;
}

function VerifyStage({ imageUri, naturalW, naturalH, quad, onQuadChange }: VerifyStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState<number | null>(null);

  useEffect(() => {
    const obs = new ResizeObserver(() => {
      if (containerRef.current)
        setContainerSize({ w: containerRef.current.clientWidth, h: containerRef.current.clientHeight });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const imgRect = containerSize.w > 0 && naturalW > 0
    ? getRenderedImageRect(containerSize.w, containerSize.h, naturalW, naturalH)
    : { left: 0, top: 0, width: containerSize.w, height: containerSize.h };

  const toScreen = (p: QuadPoint) => ({
    x: imgRect.left + p.x * imgRect.width,
    y: imgRect.top  + p.y * imgRect.height,
  });

  const toCanvas = useCallback((screenX: number, screenY: number): QuadPoint => ({
    x: Math.max(0, Math.min(1, (screenX - imgRect.left) / imgRect.width)),
    y: Math.max(0, Math.min(1, (screenY - imgRect.top)  / imgRect.height)),
  }), [imgRect]);

  const onPointerDown = (idx: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(idx);
  };

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging === null || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pt = toCanvas(e.clientX - rect.left, e.clientY - rect.top);
    onQuadChange(quad.map((p, i) => i === dragging ? pt : p) as Quad);
  }, [dragging, quad, toCanvas, onQuadChange]);

  const screenPts = quad.map(toScreen);
  const polyPoints = screenPts.map(p => `${p.x},${p.y}`).join(' ');
  const { w: cw, h: ch } = containerSize;
  const HANDLE_R = 22;
  const LABELS = ['TL', 'TR', 'BR', 'BL'];

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black overflow-hidden"
      style={{ touchAction: 'none' }}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragging(null)}
    >
      {/* Captured frame */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUri} alt="Captured" className="w-full h-full object-contain" draggable={false} />

      {/* Overlay SVG */}
      {cw > 0 && (
        <svg className="absolute inset-0 pointer-events-none" width={cw} height={ch} viewBox={`0 0 ${cw} ${ch}`}>
          <defs>
            <mask id="qmask">
              <rect width={cw} height={ch} fill="white" />
              <polygon points={polyPoints} fill="black" />
            </mask>
          </defs>
          {/* Darken outside quad */}
          <rect width={cw} height={ch} fill="rgba(0,0,0,0.60)" mask="url(#qmask)" />
          {/* Quad border */}
          <polygon points={polyPoints} fill="none" stroke="#14b8a6" strokeWidth="2.5" strokeLinejoin="round" />
          {/* Rule-of-thirds grid */}
          {[1/3, 2/3].map(t => {
            const [tl, tr, br, bl] = screenPts;
            const vTop = { x: tl.x + (tr.x-tl.x)*t, y: tl.y + (tr.y-tl.y)*t };
            const vBot = { x: bl.x + (br.x-bl.x)*t, y: bl.y + (br.y-bl.y)*t };
            const hL   = { x: tl.x + (bl.x-tl.x)*t, y: tl.y + (bl.y-tl.y)*t };
            const hR   = { x: tr.x + (br.x-tr.x)*t, y: tr.y + (br.y-tr.y)*t };
            return (
              <g key={t} opacity={0.3}>
                <line x1={vTop.x} y1={vTop.y} x2={vBot.x} y2={vBot.y} stroke="#14b8a6" strokeWidth="1" />
                <line x1={hL.x}  y1={hL.y}  x2={hR.x}  y2={hR.y}  stroke="#14b8a6" strokeWidth="1" />
              </g>
            );
          })}
        </svg>
      )}

      {/* Drag handles — div elements for reliable mobile touch */}
      {cw > 0 && screenPts.map((sp, i) => (
        <div
          key={i}
          onPointerDown={onPointerDown(i)}
          className="absolute flex items-center justify-center rounded-full bg-teal-500 border-2 border-white shadow-xl font-mono font-black text-white select-none"
          style={{
            width:  HANDLE_R * 2,
            height: HANDLE_R * 2,
            left:   sp.x - HANDLE_R,
            top:    sp.y - HANDLE_R,
            fontSize: 10,
            cursor: dragging === i ? 'grabbing' : 'grab',
            touchAction: 'none',
            zIndex: 10,
          }}
        >
          {LABELS[i]}
        </div>
      ))}

      {/* Instruction banner */}
      <div className="absolute top-3 left-3 right-3 bg-teal-600/95 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-lg pointer-events-none">
        <Info className="h-4 w-4 shrink-0" />
        <p className="text-[11px] font-black uppercase tracking-wider">Drag corners to fit OPG boundary</p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DentalVisionClient() {
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState('upload');

  const [currentOriginalImage, setCurrentOriginalImage] = useState<string | null>(null);
  const [currentProcessedImage, setCurrentProcessedImage] = useState<string | null>(null);
  const [currentResults, setCurrentResults] = useState<AnalysisResults | null>(null);
  const [clinicalInsights, setClinicalInsights] = useState<RadiographTutorOutput | null>(null);
  const [hotspots, setHotspots] = useState<Hotspots | null>(null);
  const [selectedFindingIndex, setSelectedFindingIndex] = useState<number | null>(null);
  const [isAiRateLimited, setIsAiRateLimited] = useState(false);

  const [isAnalyzing, startAnalysisTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live AR state
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [isProcessingLive, setIsProcessingLive] = useState(false);
  const [showLiveResults, setShowLiveResults] = useState(false);
  const [isVerifyingScan, setIsVerifyingScan] = useState(false);
  const [flash, setFlash] = useState(false);

  // Quad state
  const [quad, setQuad] = useState<Quad>([
    { x: 0.05, y: 0.15 }, { x: 0.95, y: 0.15 },
    { x: 0.95, y: 0.85 }, { x: 0.05, y: 0.85 },
  ]);
  const [imgNaturalSize, setImgNaturalSize] = useState({ w: 0, h: 0 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
    return () => stopLive();
  }, []);

  const compressImage = (dataUri: string, maxDim = 1200): Promise<string> =>
    new Promise(resolve => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height) { if (width > maxDim) { height *= maxDim/width; width = maxDim; } }
        else                { if (height > maxDim) { width *= maxDim/height; height = maxDim; } }
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = dataUri;
    });

  const initCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 } }
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setIsLiveActive(true);
      setShowLiveResults(false);
      setIsVerifyingScan(false);
      setCurrentProcessedImage(null);
      setImgNaturalSize({ w: 0, h: 0 }); // reset so container goes back to camera ratio
    } catch {
      toast({ variant: 'destructive', title: 'Camera Access Denied', description: 'Please allow camera access to use Live View Shoot.' });
    }
  };

  const stopLive = () => {
    setIsLiveActive(false);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const processImage = async (dataUri: string, autoNav = true, originalFallbackUri?: string) => {
    setCurrentProcessedImage(null);
    setCurrentResults(null);
    setClinicalInsights(null);
    setHotspots(null);
    setSelectedFindingIndex(null);
    setIsAiRateLimited(false);

    try {
      const compressedUri = await compressImage(dataUri, 1200);
      let result = await runAnalysis({ radiographDataUri: compressedUri });

      if (!result.success && originalFallbackUri) {
        const compressedFallback = await compressImage(originalFallbackUri, 1200);
        result = await runAnalysis({ radiographDataUri: compressedFallback });
      }

      if (result.success) {
        setCurrentProcessedImage(result.data.processedImage);
        setCurrentResults(result.data.results);

        try {
          const [insights, locationData] = await Promise.all([
            getClinicalInsights({ originalImageDataUri: compressedUri, detections: result.data.results }),
            getFindingLocations({ processedRadiographDataUri: result.data.processedImage, findings: result.data.results })
          ]);
          if (!insights || !locationData) setIsAiRateLimited(true);
          else { setClinicalInsights(insights); setHotspots(locationData.hotspots); }
        } catch {
          setIsAiRateLimited(true);
        }

        if (autoNav) setActiveTab('consult');
        else setShowLiveResults(true);
        toast({ title: 'Analysis Complete', description: 'Clinical findings have been mapped.' });
      } else {
        const errorMsg = result.error.toLowerCase().includes('argmin')
          ? 'AI could not identify the dental arch. Please centre the OPG and ensure it is well-lit.'
          : result.error;
        toast({ variant: 'destructive', title: 'Analysis Failed', description: errorMsg });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'System Error', description: e.message || 'A communication error occurred.' });
    }
  };

  // ── Capture: draw frame to canvas, auto-detect quad, show verify stage ──────
  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 150);

    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Capture BEFORE stopping the stream
    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    // Stop camera AFTER we've drawn the frame
    stopLive();

    const rawUri = canvas.toDataURL('image/jpeg', 0.95);
    setCurrentOriginalImage(rawUri);
    setImgNaturalSize({ w: canvas.width, h: canvas.height });

    // Auto-detect while canvas still has valid pixel data
    const detected = autoDetectOPG(canvas);
    setQuad(detected);

    setIsProcessingLive(false);
    setIsVerifyingScan(true);
  };

  // ── Confirm: reload capture → perspective-warp quad → send to API ────────
  const startAnalysisFromVerified = () => {
    if (!currentOriginalImage || !canvasRef.current) return;

    startAnalysisTransition(async () => {
      // Re-draw the captured image back onto canvas (in case canvas was cleared)
      await new Promise<void>(resolve => {
        const img = new window.Image();
        img.onload = () => {
          const canvas = canvasRef.current!;
          canvas.width  = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d')!.drawImage(img, 0, 0);
          resolve();
        };
        img.src = currentOriginalImage!;
      });

      const warped = warpPerspective(canvasRef.current!, quad, 1200, 600);
      await processImage(warped, false, currentOriginalImage || undefined);
      setIsVerifyingScan(false);
    });
  };

  // ── Reset quad to full frame ─────────────────────────────────────────────
  const useFullFrameInstead = () => {
    setQuad([{ x:0,y:0 },{ x:1,y:0 },{ x:1,y:1 },{ x:0,y:1 }]);
    toast({ title: 'Full frame selected', description: 'Adjust handles if needed, then confirm.' });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = event => {
        const dataUri = event.target?.result as string;
        setCurrentOriginalImage(dataUri);
        setCurrentResults(null);
        setCurrentProcessedImage(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearUpload = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentOriginalImage(null);
    setCurrentResults(null);
    setCurrentProcessedImage(null);
  };

  const startUploadAnalysis = () => {
    if (currentOriginalImage)
      startAnalysisTransition(async () => { await processImage(currentOriginalImage, true); });
  };

  const selectedExplanation = useMemo(() => {
    if (!clinicalInsights || selectedFindingIndex === null || !currentResults) return null;
    const disease = currentResults[selectedFindingIndex].disease.toLowerCase();
    return clinicalInsights.pathologyExplanation.find(p =>
      p.condition.toLowerCase().includes(disease) || disease.includes(p.condition.toLowerCase())
    );
  }, [clinicalInsights, selectedFindingIndex, currentResults]);

  if (!isMounted) return null;

  const LoadingOverlay = ({ label = 'Analyzing Radiograph' }: { label?: string }) => (
    <div className="absolute inset-0 bg-background/90 backdrop-blur-md flex flex-col items-center justify-center z-50 animate-in fade-in duration-300">
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
        <div className="relative h-24 w-24 bg-primary/10 rounded-full flex items-center justify-center border-4 border-primary/20">
          <Sparkles className="h-10 w-10 text-primary animate-pulse" />
        </div>
      </div>
      <div className="text-center space-y-2">
        <h3 className="text-xl font-black text-primary tracking-tighter uppercase">{label}</h3>
        <div className="flex items-center justify-center gap-2">
          <div className="h-1 w-12 bg-primary/20 rounded-full overflow-hidden">
            <div className="h-full bg-primary animate-progress" />
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Running Inference</p>
          <div className="h-1 w-12 bg-primary/20 rounded-full overflow-hidden">
            <div className="h-full bg-primary animate-progress" />
          </div>
        </div>
      </div>
      <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent opacity-50 animate-scan" />
    </div>
  );

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-20 px-2 sm:px-0">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-4 h-11 bg-muted/50 rounded-lg p-1">
          <TabsTrigger value="upload" onClick={stopLive} className="text-[11px] sm:text-sm font-bold uppercase">
            <Upload className="mr-2 h-4 w-4 hidden sm:block" />Upload
          </TabsTrigger>
          <TabsTrigger value="live" onClick={initCamera} className="text-[11px] sm:text-sm font-bold uppercase">
            <Camera className="mr-2 h-4 w-4 hidden sm:block" />Live View Shoot
          </TabsTrigger>
          <TabsTrigger value="consult" disabled={!currentResults} className="text-[11px] sm:text-sm font-bold uppercase">
            <Sparkles className="mr-2 h-4 w-4 hidden sm:block" />AI Consult
          </TabsTrigger>
        </TabsList>

        {/* ── UPLOAD TAB ── */}
        <TabsContent value="upload">
          <Card className="border-primary/10 shadow-xl rounded-2xl overflow-hidden relative">
            <CardContent className="p-4 sm:p-8">
              <div
                onClick={() => !currentOriginalImage && !isAnalyzing && fileInputRef.current?.click()}
                className={cn(
                  'w-full aspect-video sm:aspect-[16/7] border-2 border-dashed rounded-2xl flex flex-col items-center justify-center transition-all group overflow-hidden relative',
                  currentOriginalImage ? 'border-primary/40 bg-primary/5 cursor-default' : 'border-primary/20 cursor-pointer hover:bg-primary/5'
                )}
              >
                {currentOriginalImage ? (
                  <>
                    <Image src={currentOriginalImage} alt="Uploaded OPG" fill className="object-contain p-2" />
                    {!isAnalyzing && (
                      <button onClick={clearUpload} className="absolute top-4 right-4 h-10 w-10 bg-background/80 backdrop-blur shadow-md rounded-full flex items-center justify-center hover:bg-destructive hover:text-white transition-colors z-20">
                        <XCircle className="h-6 w-6" />
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <Upload className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-sm font-bold text-primary uppercase tracking-wider">Select Panoramic X-Ray</p>
                    <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-widest font-black opacity-60">JPG or PNG preferred</p>
                  </>
                )}
              </div>

              {isAnalyzing && <LoadingOverlay />}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />

              {!currentResults && (
                <div className="mt-6 space-y-4">
                  {!currentOriginalImage ? (
                    <Button disabled={isAnalyzing} className="w-full h-16 rounded-xl text-lg font-black" onClick={() => fileInputRef.current?.click()}>
                      <ScanLine className="mr-2" />CHOOSE FILE
                    </Button>
                  ) : (
                    <Button disabled={isAnalyzing} className="w-full h-20 rounded-xl text-xl font-black shadow-2xl shadow-primary/30" onClick={startUploadAnalysis}>
                      {isAnalyzing ? <Loader2 className="animate-spin mr-2" /> : <Bot className="mr-3 h-6 w-6" />}
                      START CLINICAL ANALYSIS
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── LIVE AR TAB ── */}
        <TabsContent value="live">
          <Card className="border-primary/10 shadow-2xl overflow-hidden rounded-2xl">
            <CardContent className="p-0 relative">

              {/* ── Viewfinder area — height adapts to portrait or landscape capture ── */}
              <div
                className="relative bg-black flex items-center justify-center overflow-hidden"
                style={{
                  // During verify: match captured image orientation naturally
                  // Portrait capture → taller box; Landscape → wider box
                  // Clamp between 56vw (landscape min) and 90vw (portrait max)
                  height: isVerifyingScan && imgNaturalSize.w > 0
                    ? `clamp(56vw, ${Math.round((imgNaturalSize.h / imgNaturalSize.w) * 100)}vw, 90vw)`
                    : '56vw', // default 16:9-ish for live camera
                  maxHeight: '75vh',
                }}
              >

                {/* Live camera preview */}
                {!isVerifyingScan && !showLiveResults && (
                  <>
                    <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                    {/* Corner guide brackets */}
                    <div className="absolute inset-0 border-[20px] sm:border-[40px] border-black/50 pointer-events-none">
                      <div className="w-full h-full border-2 border-primary/20 rounded-lg relative overflow-hidden">
                        <div className="absolute inset-0 flex flex-col items-center justify-center opacity-20">
                          <Target className="h-16 w-16 text-primary" />
                          <p className="mt-2 text-[10px] font-black uppercase tracking-widest">Align OPG within frame</p>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* ── Verify stage: quad handles ── */}
                {isVerifyingScan && currentOriginalImage && (
                  <VerifyStage
                    imageUri={currentOriginalImage}
                    naturalW={imgNaturalSize.w}
                    naturalH={imgNaturalSize.h}
                    quad={quad}
                    onQuadChange={setQuad}
                  />
                )}

                {/* Results preview */}
                {showLiveResults && currentProcessedImage && (
                  <div className="relative w-full h-full bg-black flex items-center justify-center animate-in zoom-in-95 duration-500">
                    <div className="relative w-full aspect-video">
                      <Image src={currentProcessedImage} alt="AR Findings" fill className="object-contain" />
                    </div>
                  </div>
                )}

                {/* Flash */}
                {flash && <div className="absolute inset-0 bg-white z-[60] animate-out fade-out duration-300" />}

                {/* Loading overlays */}
                {(isAnalyzing || isProcessingLive) && (
                  <LoadingOverlay label={isProcessingLive ? 'Isolating OPG...' : 'Analyzing Radiograph'} />
                )}

                {/* Start camera prompt */}
                {!isLiveActive && !isVerifyingScan && !showLiveResults && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
                    <Button onClick={initCamera} size="lg" className="h-16 px-10 rounded-full font-black">
                      START CAMERA
                    </Button>
                  </div>
                )}
              </div>

              {/* ── Action buttons ── */}
              <div className="p-4 bg-background border-t">
                {isLiveActive && !isVerifyingScan && (
                  <>
                    <Button
                      onClick={handleCapture}
                      disabled={isProcessingLive || !isLiveActive}
                      size="lg"
                      className="w-full h-20 text-xl font-black rounded-2xl shadow-xl transition-all active:scale-95"
                    >
                      {isProcessingLive ? <Loader2 className="animate-spin mr-2" /> : <ScanLine className="mr-3 h-7 w-7" />}
                      CAPTURE & SCAN
                    </Button>
                    <p className="text-[10px] font-black uppercase tracking-widest text-center mt-3 text-muted-foreground opacity-60">
                      Align OPG within the corner brackets
                    </p>
                  </>
                )}

                {isVerifyingScan && (
                  <div className="space-y-3 animate-in slide-in-from-bottom-4">
                    <Button
                      onClick={startAnalysisFromVerified}
                      disabled={isAnalyzing}
                      size="lg"
                      className="w-full h-20 text-lg font-black rounded-2xl shadow-2xl bg-primary"
                    >
                      {isAnalyzing ? <Loader2 className="animate-spin mr-2" /> : <CheckCircle2 className="mr-3 h-6 w-6" />}
                      CONFIRM & ANALYZE
                    </Button>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={useFullFrameInstead} className="flex-1 h-12 rounded-xl font-black uppercase text-[10px]">
                        <Maximize2 className="mr-2 h-4 w-4" /> RESET QUAD
                      </Button>
                      <Button variant="outline" onClick={initCamera} className="flex-1 h-12 rounded-xl font-black uppercase text-[10px]">
                        <RefreshCcw className="mr-2 h-4 w-4" /> RETAKE SCAN
                      </Button>
                    </div>
                  </div>
                )}

                {showLiveResults && (
                  <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center justify-between gap-3 px-1">
                      <div className="flex flex-col">
                        <h4 className="text-xs font-black uppercase text-primary">Scanner Analysis Complete</h4>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold">{currentResults?.length || 0} Clinical Findings</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={initCamera} className="rounded-full h-10 px-4 font-black text-[10px] uppercase">
                        <RefreshCcw className="mr-2 h-3 w-3" /> NEW SCAN
                      </Button>
                    </div>
                    <Button onClick={() => setActiveTab('consult')} size="lg" className="w-full h-20 text-lg font-black rounded-2xl shadow-2xl bg-primary">
                      <Sparkles className="mr-3 h-6 w-6" />
                      START AI TUTORING DEEP-DIVE
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </Button>
                  </div>
                )}
              </div>

              <canvas ref={canvasRef} className="hidden" />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── AI CONSULT TAB ── */}
        <TabsContent value="consult">
          <div className="grid md:grid-cols-12 gap-4 items-start">
            <div className="md:col-span-7 space-y-4">
              <Card className="overflow-hidden border-primary/20 shadow-xl rounded-2xl">
                <CardContent className="p-0">
                  <div className="bg-primary/5 p-3 border-b flex items-center justify-between">
                    <h3 className="text-[10px] font-black uppercase text-primary tracking-widest flex items-center gap-2">
                      <Eye className="h-4 w-4" /> Clinical Review
                    </h3>
                    {hotspots && <Badge variant="outline" className="text-[9px] font-black">TAP FINDINGS</Badge>}
                  </div>
                  <div className="relative aspect-video bg-black">
                    {currentProcessedImage && (
                      <>
                        <Image src={currentProcessedImage} alt="Analyzed Radiograph" fill className="object-contain" />
                        {hotspots && (
                          <svg className="absolute inset-0 w-full h-full pointer-events-auto" viewBox="0 0 1 1" preserveAspectRatio="none">
                            {hotspots.map((h, i) => (
                              <rect
                                key={i}
                                x={h.box[0]} y={h.box[1]}
                                width={h.box[2] - h.box[0]} height={h.box[3] - h.box[1]}
                                className={cn(
                                  'fill-primary/0 stroke-2 cursor-pointer transition-all',
                                  selectedFindingIndex === i ? 'stroke-yellow-400 fill-yellow-400/30' : 'stroke-transparent hover:stroke-white/60'
                                )}
                                onClick={() => setSelectedFindingIndex(i)}
                              />
                            ))}
                          </svg>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {currentResults && (
                <div className="flex flex-wrap gap-2">
                  {currentResults.map((r, i) => (
                    <Badge
                      key={i}
                      onClick={() => setSelectedFindingIndex(i)}
                      variant={selectedFindingIndex === i ? 'default' : 'secondary'}
                      className={cn('px-4 py-2 text-[10px] font-black cursor-pointer shadow-md', selectedFindingIndex === i && 'border-2 border-yellow-400')}
                    >
                      {r.disease.toUpperCase()} ({r.tooth_numbers.join(', ')})
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="md:col-span-5 space-y-4">
              <Card className="bg-primary/5 border-primary/20 shadow-2xl rounded-2xl min-h-[400px]">
                <CardContent className="p-5">
                  <div className="flex items-center gap-3 mb-6 border-b border-primary/10 pb-4">
                    <div className="h-10 w-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary">
                      <Sparkles className="h-6 w-6" />
                    </div>
                    <h2 className="text-lg font-black uppercase">AI Tutor</h2>
                  </div>

                  {isAiRateLimited && (
                    <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl mb-6 flex gap-3 items-start">
                      <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-amber-900">AI is Busy</p>
                        <p className="text-[10px] text-amber-800 leading-tight">Gemini has reached its hourly quota. Clinical tutoring will resume shortly.</p>
                      </div>
                    </div>
                  )}

                  {!clinicalInsights && !isAiRateLimited ? (
                    <div className="space-y-4">
                      <Skeleton className="h-24 w-full rounded-xl" />
                      <Skeleton className="h-40 w-full rounded-xl" />
                    </div>
                  ) : clinicalInsights ? (
                    <div className="space-y-6">
                      <section className="bg-white p-5 rounded-2xl border border-primary/10 min-h-[180px]">
                        <h4 className="text-[10px] font-black uppercase text-primary/60 tracking-widest mb-4">
                          {selectedFindingIndex !== null ? 'Finding Insight' : 'Select a Finding'}
                        </h4>
                        {selectedFindingIndex !== null && selectedExplanation ? (
                          <div className="animate-in fade-in duration-300">
                            <h5 className="font-black text-sm mb-2 text-foreground flex items-center justify-between">
                              {selectedExplanation.condition.toUpperCase()}
                              <ChevronRight className="h-4 w-4 text-primary/40" />
                            </h5>
                            <p className="text-[12px] leading-relaxed text-foreground/70 mb-5">{selectedExplanation.significance}</p>
                            <div className="bg-primary/5 p-4 rounded-xl border border-primary/10">
                              <p className="text-[10px] font-black text-primary mb-2">MANAGEMENT</p>
                              <p className="text-[12px] italic text-primary/80">{selectedExplanation.considerations}</p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center text-center pt-8 opacity-20">
                            <Bot className="h-12 w-12 mb-3" />
                            <p className="text-[11px] font-black text-center">TAP A FINDING FOR CLINICAL INSIGHTS.</p>
                          </div>
                        )}
                      </section>

                      <section className="px-1">
                        <div className="flex items-center gap-2 mb-2">
                          <BookOpen className="h-4 w-4 text-primary/60" />
                          <h4 className="text-[9px] font-black uppercase text-primary/60">Overview</h4>
                        </div>
                        <p className="text-[11px] leading-relaxed text-foreground/60">{clinicalInsights.clinicalOverview}</p>
                      </section>

                      <div className="bg-primary text-primary-foreground p-5 rounded-2xl">
                        <div className="flex items-center gap-2 mb-3">
                          <GraduationCap className="h-5 w-5" />
                          <h4 className="text-[10px] font-black uppercase">Learning Tip</h4>
                        </div>
                        <p className="text-[12px] font-bold">{clinicalInsights.studentTakeaway}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center py-20 opacity-40">
                      <HelpCircle className="h-12 w-12 mb-4" />
                      <p className="text-sm font-bold uppercase">Tutoring Unavailable</p>
                      <p className="text-[10px]">AI resources are currently exhausted. Please try again in 1 minute.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <footer className="text-center py-10 opacity-20">
        <p className="text-[10px] uppercase font-black tracking-widest">DentalVision AR Systems</p>
      </footer>
    </div>
  );
}
