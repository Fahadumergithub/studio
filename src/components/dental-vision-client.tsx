'use client';

import { useState, useRef, useTransition, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Upload, Bot, ScanLine, Eye, Camera, Info, Loader2, Target, Sparkles, BookOpen, GraduationCap, ChevronRight, XCircle, HelpCircle, AlertTriangle, RefreshCcw, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { runAnalysis, runOpgDetection, getClinicalInsights, getFindingLocations } from '@/app/actions';
import type { AiRadiographDetectionOutput } from '@/ai/flows/ai-radiograph-detection-flow';
import type { RadiographTutorOutput } from '@/ai/flows/radiograph-tutor-flow';
import type { LocateFindingsOutput } from '@/ai/flows/locate-findings-flow';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

type AnalysisResults = AiRadiographDetectionOutput['results'];
type Hotspots = LocateFindingsOutput['hotspots'];

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

  const [isLiveActive, setIsLiveActive] = useState(false);
  const [isProcessingLive, setIsProcessingLive] = useState(false);
  const [showLiveResults, setShowLiveResults] = useState(false);
  const [flash, setFlash] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
    return () => stopLive();
  }, []);

  const compressImage = (dataUri: string, maxDim: number = 1200): Promise<string> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDim) {
            height *= maxDim / width;
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width *= maxDim / height;
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = dataUri;
    });
  };

  const initCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 } }
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setIsLiveActive(true);
      setShowLiveResults(false);
      setCurrentProcessedImage(null);
    } catch (e) {
      toast({ variant: 'destructive', title: "Camera Access Denied", description: "Please allow camera access to use Live AR." });
    }
  };

  const stopLive = () => {
    setIsLiveActive(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const processImage = async (dataUri: string, autoNav: boolean = true, originalFallbackUri?: string) => {
    setCurrentProcessedImage(null);
    setCurrentResults(null);
    setClinicalInsights(null);
    setHotspots(null);
    setSelectedFindingIndex(null);
    setIsAiRateLimited(false);

    try {
      const compressedUri = await compressImage(dataUri, 1200);
      let result = await runAnalysis({ radiographDataUri: compressedUri });
      
      // Zero-Failure Fallback: If crop results in a server error (like 'argmin'), try the original full frame
      if (!result.success && originalFallbackUri) {
        console.warn('Analysis of isolated frame failed, retrying with full frame fallback...');
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
          
          if (!insights || !locationData) {
             setIsAiRateLimited(true);
          } else {
            setClinicalInsights(insights);
            setHotspots(locationData.hotspots);
          }
        } catch (genAiError) {
          setIsAiRateLimited(true);
        }
        
        if (autoNav) {
          setActiveTab('consult');
        } else {
          setShowLiveResults(true);
        }
        
        toast({ title: "Analysis Complete", description: "Clinical findings have been mapped." });
      } else {
        const errorMsg = result.error.toLowerCase().includes('argmin')
          ? "AI could not identify the dental arch. Please center the OPG and ensure it is well-lit."
          : result.error;
        toast({ variant: 'destructive', title: "Analysis Failed", description: errorMsg });
      }
    } catch (e: any) {
      const errorMsg = e.message?.toLowerCase().includes('failed') 
        ? "Connection timeout. Please ensure you have a stable network." 
        : (e.message || "A communication error occurred.");
      toast({ variant: 'destructive', title: "System Error", description: errorMsg });
    }
  };

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    setFlash(true);
    setTimeout(() => setFlash(false), 150);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    
    const rawUri = canvas.toDataURL('image/jpeg', 0.95);
    
    setIsProcessingLive(true);
    try {
      const compressedForDetection = await compressImage(rawUri, 600);
      
      let finalUri = rawUri;
      try {
        const opg = await runOpgDetection({ imageDataUri: compressedForDetection });
        if (opg.isOpg && opg.boundingBox) {
          const { x, y, width, height } = opg.boundingBox;
          
          // Refined Sanitization: Ensure crop is substantial and valid
          const sx = Math.max(0, Math.min(1, x));
          const sy = Math.max(0, Math.min(1, y));
          const sw = Math.max(0.1, Math.min(1 - sx, width));
          const sh = Math.max(0.1, Math.min(1 - sy, height));
          
          const cropX = sx * canvas.width;
          const cropY = sy * canvas.height;
          const cropW = sw * canvas.width;
          const cropH = sh * canvas.height;
          
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = cropW;
          cropCanvas.height = cropH;
          cropCanvas.getContext('2d')?.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
          finalUri = cropCanvas.toDataURL('image/jpeg', 0.95);
        }
      } catch (opgError) {
        console.warn('Isolation failed, falling back to full frame:', opgError);
      }

      const clinicalReadyUri = await compressImage(finalUri, 1200);
      setCurrentOriginalImage(clinicalReadyUri);
      
      startAnalysisTransition(async () => {
        await processImage(clinicalReadyUri, false, rawUri);
      });
      
      stopLive();
    } catch (err: any) {
      console.error('Capture lifecycle error:', err);
      toast({ variant: 'destructive', title: "Capture Error", description: "Connection interrupted or frame too large." });
    } finally {
      setIsProcessingLive(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast({ variant: 'destructive', title: "File Too Large", description: "Max file size is 10MB." });
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
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
    if (currentOriginalImage) {
      startAnalysisTransition(async () => {
        await processImage(currentOriginalImage, true);
      });
    }
  };

  const selectedExplanation = useMemo(() => {
    if (!clinicalInsights || selectedFindingIndex === null || !currentResults) return null;
    const disease = currentResults[selectedFindingIndex].disease.toLowerCase();
    return clinicalInsights.pathologyExplanation.find(p => 
      p.condition.toLowerCase().includes(disease) || disease.includes(p.condition.toLowerCase())
    );
  }, [clinicalInsights, selectedFindingIndex, currentResults]);

  if (!isMounted) return null;

  const LoadingOverlay = () => (
    <div className="absolute inset-0 bg-background/90 backdrop-blur-md flex flex-col items-center justify-center z-50 animate-in fade-in duration-300">
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
        <div className="relative h-24 w-24 bg-primary/10 rounded-full flex items-center justify-center border-4 border-primary/20">
          <Sparkles className="h-10 w-10 text-primary animate-pulse" />
        </div>
      </div>
      <div className="text-center space-y-2">
        <h3 className="text-xl font-black text-primary tracking-tighter uppercase">Analyzing Radiograph</h3>
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
          <TabsTrigger value="upload" onClick={stopLive} className="text-[11px] sm:text-sm font-bold uppercase"><Upload className="mr-2 h-4 w-4 hidden sm:block" />Upload</TabsTrigger>
          <TabsTrigger value="live" onClick={initCamera} className="text-[11px] sm:text-sm font-bold uppercase"><Camera className="mr-2 h-4 w-4 hidden sm:block" />Live AR</TabsTrigger>
          <TabsTrigger value="consult" disabled={!currentResults} className="text-[11px] sm:text-sm font-bold uppercase"><Sparkles className="mr-2 h-4 w-4 hidden sm:block" />AI Consult</TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          <Card className="border-primary/10 shadow-xl rounded-2xl overflow-hidden relative">
            <CardContent className="p-4 sm:p-8">
              <div 
                onClick={() => !currentOriginalImage && !isAnalyzing && fileInputRef.current?.click()}
                className={cn(
                  "w-full aspect-video sm:aspect-[16/7] border-2 border-dashed rounded-2xl flex flex-col items-center justify-center transition-all group overflow-hidden relative",
                  currentOriginalImage ? "border-primary/40 bg-primary/5 cursor-default" : "border-primary/20 cursor-pointer hover:bg-primary/5"
                )}
              >
                {currentOriginalImage ? (
                  <>
                    <Image src={currentOriginalImage} alt="Uploaded OPG" fill className="object-contain p-2" />
                    {!isAnalyzing && (
                      <button 
                        onClick={clearUpload}
                        className="absolute top-4 right-4 h-10 w-10 bg-background/80 backdrop-blur shadow-md rounded-full flex items-center justify-center hover:bg-destructive hover:text-white transition-colors z-20"
                      >
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
                      <ScanLine className="mr-2" />
                      CHOOSE FILE
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <Button 
                        disabled={isAnalyzing} 
                        className="w-full h-20 rounded-xl text-xl font-black shadow-2xl shadow-primary/30" 
                        onClick={startUploadAnalysis}
                      >
                        {isAnalyzing ? <Loader2 className="animate-spin mr-2" /> : <Bot className="mr-3 h-6 w-6" />}
                        START CLINICAL ANALYSIS
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="live">
          <Card className="border-primary/10 shadow-2xl overflow-hidden rounded-2xl">
            <CardContent className="p-0 relative">
              <div className="relative aspect-[4/3] sm:aspect-video bg-black flex items-center justify-center overflow-hidden">
                {!showLiveResults ? (
                  <>
                    <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                    <div className="absolute inset-0 border-[30px] border-black/40 pointer-events-none">
                      <div className="w-full h-full border-2 border-primary/40 rounded-lg relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-sm" />
                        <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-sm" />
                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-sm" />
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-sm" />
                      </div>
                    </div>
                  </>
                ) : (
                  currentProcessedImage && (
                    <div className="relative w-full h-full animate-in zoom-in-95 duration-500 bg-black flex items-center justify-center">
                      <div className="relative w-full aspect-video">
                        <Image src={currentProcessedImage} alt="AR Findings" fill className="object-contain" />
                      </div>
                    </div>
                  )
                )}
                
                {flash && <div className="absolute inset-0 bg-white z-[60] animate-out fade-out duration-300" />}
                
                {(isAnalyzing || isProcessingLive) && <LoadingOverlay />}

                {!isLiveActive && !showLiveResults && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
                    <Button onClick={initCamera} size="lg" className="h-16 px-10 rounded-full font-black">
                      START CAMERA
                    </Button>
                  </div>
                )}
              </div>

              <div className="p-4 bg-background border-t">
                {!showLiveResults ? (
                  <>
                    <Button onClick={handleCapture} disabled={isProcessingLive || !isLiveActive || isAnalyzing} size="lg" className="w-full h-20 text-xl font-black rounded-2xl shadow-xl transition-all active:scale-95">
                      {isProcessingLive || isAnalyzing ? <Loader2 className="animate-spin mr-2" /> : <Target className="mr-3 h-7 w-7" />}
                      CAPTURE & ANALYZE
                    </Button>
                    <div className="flex items-center justify-center gap-2 mt-4 text-muted-foreground opacity-60">
                      <Info className="h-3 w-3" />
                      <p className="text-[10px] font-black uppercase tracking-widest text-center">Isolate clinical frame for precision</p>
                    </div>
                  </>
                ) : (
                  <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col">
                        <h4 className="text-xs font-black uppercase text-primary">In-Situ Analysis Complete</h4>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold">{currentResults?.length || 0} Findings Identified</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => { setShowLiveResults(false); initCamera(); }} className="rounded-full h-10 px-4 font-black text-[10px] uppercase">
                        <RefreshCcw className="mr-2 h-3 w-3" /> RETAKE
                      </Button>
                    </div>
                    
                    <Button 
                      onClick={() => {
                        setActiveTab('consult');
                      }} 
                      size="lg" 
                      className="w-full h-20 text-lg font-black rounded-2xl shadow-2xl bg-primary hover:bg-primary/90"
                    >
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
                  <div className="relative aspect-[16/10] bg-black">
                    {currentProcessedImage && (
                      <>
                        <Image src={currentProcessedImage} alt="Analyzed Radiograph" fill className="object-contain" />
                        {hotspots && (
                          <svg className="absolute inset-0 w-full h-full pointer-events-auto" viewBox="0 0 1 1" preserveAspectRatio="none">
                            {hotspots.map((h, i) => (
                              <rect
                                key={i}
                                x={h.box[0]}
                                y={h.box[1]}
                                width={h.box[2] - h.box[0]}
                                height={h.box[3] - h.box[1]}
                                className={cn(
                                  "fill-primary/0 stroke-2 cursor-pointer transition-all",
                                  selectedFindingIndex === i ? "stroke-yellow-400 fill-yellow-400/30" : "stroke-transparent hover:stroke-white/60"
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
                      variant={selectedFindingIndex === i ? "default" : "secondary"}
                      className={cn(
                        "px-4 py-2 text-[10px] font-black cursor-pointer shadow-md",
                        selectedFindingIndex === i && "border-2 border-yellow-400"
                      )}
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
