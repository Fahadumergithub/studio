'use client';

import { useState, useRef, useTransition, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Upload, Bot, ScanLine, Eye, Camera, Info, Loader2, Target, Sparkles, XCircle, RefreshCcw, CheckCircle2, Maximize2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { runAnalysis } from '@/app/actions';
import type { AiRadiographDetectionOutput } from '@/ai/flows/ai-radiograph-detection-flow';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

type AnalysisResults = AiRadiographDetectionOutput['results'];

// ─── Quad types ───────────────────────────────────────────────────────────────
interface QuadPoint { x: number; y: number; } // 0–1 normalized to canvas dims
type Quad = [QuadPoint, QuadPoint, QuadPoint, QuadPoint]; // TL TR BR BL

// ─── Coordinate helpers ───────────────────────────────────────────────────────

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
  const pad = 0.02;

  function findBBox(targetDark: boolean): { minX:number; maxX:number; minY:number; maxY:number; count:number } {
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
    const aspect = (b.maxX - b.minX) / Math.max(1, b.maxY - b.minY);
    const aspectScore = aspect > 1.0 ? 1.0 : 0.5;
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
      <img src={imageUri} alt="Captured" className="w-full h-full object-contain" draggable={false} />

      {cw > 0 && (
        <svg className="absolute inset-0 pointer-events-none" width={cw} height={ch} viewBox={`0 0 ${cw} ${ch}`}>
          <defs>
            <mask id="qmask">
              <rect width={cw} height={ch} fill="white" />
              <polygon points={polyPoints} fill="black" />
            </mask>
          </defs>
          <rect width={cw} height={ch} fill="rgba(0,0,0,0.60)" mask="url(#qmask)" />
          <polygon points={polyPoints} fill="none" stroke="#14b8a6" strokeWidth="2.5" strokeLinejoin="round" />
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

  const [isAnalyzing, startAnalysisTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live state
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
        resolve(canvas.toDataURL('image/jpeg', 0.92));
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
      setCurrentResults(null);
      setImgNaturalSize({ w: 0, h: 0 });
    } catch {
      toast({ variant: 'destructive', title: 'Camera Access Denied', description: 'Please allow camera access to use Live View Shoot.' });
    }
  };

  const stopLive = () => {
    setIsLiveActive(false);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const processImage = async (dataUri: string, originalFallbackUri?: string) => {
    setCurrentProcessedImage(null);
    setCurrentResults(null);

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
        toast({ title: 'Analysis Complete', description: 'Clinical findings have been mapped.' });
      } else {
        const errorMsg = result.error.toLowerCase().includes('argmin')
          ? 'AI could not identify the dental arch. Please center the OPG and ensure it is well-lit.'
          : result.error;
        toast({ variant: 'destructive', title: 'Analysis Failed', description: errorMsg });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'System Error', description: e.message || 'A communication error occurred.' });
    }
  };

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 150);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d')!.drawImage(video, 0, 0);

    const rawUri = canvas.toDataURL('image/jpeg', 0.95);
    setCurrentOriginalImage(rawUri);
    setImgNaturalSize({ w: canvas.width, h: canvas.height });

    const detected = autoDetectOPG(canvas);
    setQuad(detected);

    setIsProcessingLive(false);
    setIsVerifyingScan(true);
    stopLive();
  };

  const startAnalysisFromVerified = () => {
    if (!currentOriginalImage || !canvasRef.current) return;

    startAnalysisTransition(async () => {
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
      await processImage(warped, currentOriginalImage || undefined);
      setIsVerifyingScan(false);
      setShowLiveResults(true);
    });
  };

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
      startAnalysisTransition(async () => { await processImage(currentOriginalImage); });
  };

  if (!isMounted) return null;

  const LoadingOverlay = ({ label = 'Analyzing Radiograph' }: { label?: string }) => (
    <div className="absolute inset-0 bg-background/90 backdrop-blur-md flex flex-col items-center justify-center z-50 animate-in fade-in duration-300">
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
        <div className="relative h-24 w-24 bg-primary/10 rounded-full flex items-center justify-center border-4 border-primary/20">
          <Bot className="h-10 w-10 text-primary animate-pulse" />
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
        <TabsList className="grid w-full grid-cols-2 mb-4 h-11 bg-muted/50 rounded-lg p-1">
          <TabsTrigger value="upload" onClick={stopLive} className="text-[11px] sm:text-sm font-bold uppercase">
            <Upload className="mr-2 h-4 w-4 hidden sm:block" />Upload OPG
          </TabsTrigger>
          <TabsTrigger value="live" onClick={initCamera} className="text-[11px] sm:text-sm font-bold uppercase">
            <Camera className="mr-2 h-4 w-4 hidden sm:block" />Live View Shoot
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          <Card className="border-primary/10 shadow-xl rounded-2xl overflow-hidden relative">
            <CardContent className="p-4 sm:p-8">
              <div
                onClick={() => !currentOriginalImage && !isAnalyzing && fileInputRef.current?.click()}
                className={cn(
                  'w-full aspect-video sm:aspect-[16/7] border-2 border-dashed rounded-2xl flex flex-col items-center justify-center transition-all group overflow-hidden relative',
                  currentOriginalImage || currentProcessedImage ? 'border-primary/40 bg-primary/5 cursor-default' : 'border-primary/20 cursor-pointer hover:bg-primary/5'
                )}
              >
                {currentProcessedImage ? (
                  <Image src={currentProcessedImage} alt="Analyzed OPG" fill className="object-contain p-2" />
                ) : currentOriginalImage ? (
                  <Image src={currentOriginalImage} alt="Uploaded OPG" fill className="object-contain p-2" />
                ) : (
                  <>
                    <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <Upload className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-sm font-bold text-primary uppercase tracking-wider">Select Panoramic X-Ray</p>
                    <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-widest font-black opacity-60">JPG or PNG preferred</p>
                  </>
                )}

                {(currentOriginalImage || currentProcessedImage) && !isAnalyzing && (
                  <button onClick={clearUpload} className="absolute top-4 right-4 h-10 w-10 bg-background/80 backdrop-blur shadow-md rounded-full flex items-center justify-center hover:bg-destructive hover:text-white transition-colors z-20">
                    <XCircle className="h-6 w-6" />
                  </button>
                )}
              </div>

              {isAnalyzing && <LoadingOverlay />}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />

              {!currentResults ? (
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
              ) : (
                <div className="mt-8 space-y-6 animate-in slide-in-from-bottom-4">
                  <div className="flex items-center gap-3 border-b pb-4">
                    <Bot className="h-6 w-6 text-primary" />
                    <h3 className="text-lg font-black uppercase tracking-tight">Clinical Findings</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {currentResults.map((r, i) => (
                      <Badge key={i} variant="secondary" className="px-4 py-2 text-[10px] font-black uppercase border-primary/20 bg-primary/5">
                        <span className="text-primary mr-1">{r.disease}:</span> {r.tooth_numbers.join(', ')}
                      </Badge>
                    ))}
                  </div>
                  <Button variant="outline" className="w-full h-14 rounded-xl font-black uppercase text-xs" onClick={clearUpload}>
                    <RefreshCcw className="mr-2 h-4 w-4" /> Start New Analysis
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="live">
          <Card className="border-primary/10 shadow-2xl overflow-hidden rounded-2xl">
            <CardContent className="p-0 relative">
              <div
                className="relative bg-black flex items-center justify-center overflow-hidden"
                style={{
                  height: isVerifyingScan && imgNaturalSize.w > 0
                    ? `clamp(56vw, ${Math.round((imgNaturalSize.h / imgNaturalSize.w) * 100)}vw, 90vw)`
                    : '56vw',
                  maxHeight: '75vh',
                }}
              >
                {!isVerifyingScan && !showLiveResults && (
                  <>
                    <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
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

                {isVerifyingScan && currentOriginalImage && (
                  <VerifyStage
                    imageUri={currentOriginalImage}
                    naturalW={imgNaturalSize.w}
                    naturalH={imgNaturalSize.h}
                    quad={quad}
                    onQuadChange={setQuad}
                  />
                )}

                {showLiveResults && currentProcessedImage && (
                  <div className="relative w-full h-full bg-black flex items-center justify-center animate-in zoom-in-95 duration-500">
                    <div className="relative w-full aspect-video">
                      <Image src={currentProcessedImage} alt="AR Findings" fill className="object-contain" />
                    </div>
                  </div>
                )}

                {flash && <div className="absolute inset-0 bg-white z-[60] animate-out fade-out duration-300" />}
                {(isAnalyzing || isProcessingLive) && (
                  <LoadingOverlay label={isProcessingLive ? 'Isolating OPG...' : 'Analyzing Radiograph'} />
                )}

                {!isLiveActive && !isVerifyingScan && !showLiveResults && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
                    <Button onClick={initCamera} size="lg" className="h-16 px-10 rounded-full font-black">
                      START CAMERA
                    </Button>
                  </div>
                )}
              </div>

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
                      {isAnalyzing ? <Loader2 className="animate-spin mr-2" /> : <Bot className="mr-3 h-6 w-6" />}
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
                  <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
                    <div className="flex flex-col gap-1 px-1">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-black uppercase text-primary">Analysis Complete</h4>
                        <Badge variant="outline" className="text-[9px] font-black">{currentResults?.length || 0} Findings</Badge>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-3">
                        {currentResults?.map((r, i) => (
                          <Badge key={i} variant="secondary" className="px-3 py-1 text-[9px] font-black uppercase bg-primary/5">
                            {r.disease}: {r.tooth_numbers.join(', ')}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Button onClick={initCamera} size="lg" className="w-full h-16 text-sm font-black rounded-2xl shadow-xl">
                      <RefreshCcw className="mr-3 h-5 w-5" /> START NEW SCAN
                    </Button>
                  </div>
                )}
              </div>

              <canvas ref={canvasRef} className="hidden" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <footer className="text-center py-10 opacity-20">
        <p className="text-[10px] uppercase font-black tracking-widest">DentalVision Clinical Systems</p>
      </footer>
    </div>
  );
}
