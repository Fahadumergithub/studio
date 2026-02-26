'use client';

import { useState, useRef, useTransition, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Upload, Bot, ScanLine, Eye, Camera, Info, Loader2, Target, Sparkles, BookOpen, GraduationCap, ChevronRight, XCircle, HelpCircle } from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState('upload');
  
  const [currentOriginalImage, setCurrentOriginalImage] = useState<string | null>(null);
  const [currentProcessedImage, setCurrentProcessedImage] = useState<string | null>(null);
  const [currentResults, setCurrentResults] = useState<AnalysisResults | null>(null);
  const [clinicalInsights, setClinicalInsights] = useState<RadiographTutorOutput | null>(null);
  const [hotspots, setHotspots] = useState<Hotspots | null>(null);
  const [selectedFindingIndex, setSelectedFindingIndex] = useState<number | null>(null);
  
  const [isAnalyzing, startAnalysisTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isLiveActive, setIsLiveActive] = useState(false);
  const [isProcessingLive, setIsProcessingLive] = useState(false);
  const [flash, setFlash] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    return () => stopLive();
  }, []);

  const compressImage = (dataUri: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1200;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
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
        video: { facingMode: 'environment', width: { ideal: 1280 } }
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setIsLiveActive(true);
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

  const processImage = async (dataUri: string) => {
    setCurrentProcessedImage(null);
    setCurrentResults(null);
    setClinicalInsights(null);
    setHotspots(null);
    setSelectedFindingIndex(null);

    try {
      const compressedUri = await compressImage(dataUri);
      const result = await runAnalysis({ radiographDataUri: compressedUri });
      
      if (result.success) {
        setCurrentProcessedImage(result.data.processedImage);
        setCurrentResults(result.data.results);
        
        try {
          const [insights, locationData] = await Promise.all([
            getClinicalInsights({ originalImageDataUri: compressedUri, detections: result.data.results }),
            getFindingLocations({ processedRadiographDataUri: result.data.processedImage, findings: result.data.results })
          ]);
          setClinicalInsights(insights);
          setHotspots(locationData.hotspots);
        } catch (genAiError) {
          console.error('GenAI assistance failed:', genAiError);
          toast({ title: "Clinical Support Offline", description: "Analysis succeeded, but AI tutoring is currently unavailable." });
        }
        
        setActiveTab('consult');
        toast({ title: "Clinical Analysis Complete", description: "Review findings and hotspots in the Consult tab." });
      } else {
        toast({ variant: 'destructive', title: "Analysis Failed", description: result.error });
      }
    } catch (e: any) {
      console.error('System communication error:', e);
      toast({ 
        variant: 'destructive', 
        title: "System Error", 
        description: e.message || "A communication error occurred with the clinical server. Please check your network." 
      });
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
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const rawUri = canvas.toDataURL('image/jpeg', 0.85);
    
    setIsProcessingLive(true);
    try {
      const opg = await runOpgDetection({ imageDataUri: rawUri });
      if (opg.isOpg && opg.boundingBox) {
        const box = opg.boundingBox;
        const cropX = box.x * canvas.width;
        const cropY = box.y * canvas.height;
        const cropW = box.width * canvas.width;
        const cropH = box.height * canvas.height;
        
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropW;
        cropCanvas.height = cropH;
        cropCanvas.getContext('2d')?.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        
        const croppedUri = cropCanvas.toDataURL('image/jpeg', 0.9);
        setCurrentOriginalImage(croppedUri);
        
        startAnalysisTransition(async () => {
          await processImage(croppedUri);
        });
        stopLive();
      } else {
        toast({ title: "No OPG Identified", description: "Center the radiograph and ensure it is clearly visible." });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: "Detection Error", description: err.message || "Failed to identify the radiograph." });
    } finally {
      setIsProcessingLive(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast({ variant: 'destructive', title: "File Too Large", description: "Please upload an image smaller than 10MB." });
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
        await processImage(currentOriginalImage);
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

              {isAnalyzing && (
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
              )}

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
            <CardContent className="p-0">
              <div className="relative aspect-[4/3] sm:aspect-video bg-black flex items-center justify-center overflow-hidden">
                <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                {flash && <div className="absolute inset-0 bg-white z-50 animate-out fade-out duration-300" />}
                
                <div className="absolute inset-0 border-[40px] border-black/50 pointer-events-none">
                  <div className="w-full h-full border-2 border-primary/50 rounded-xl relative">
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-primary/30" />
                    <div className="absolute top-0 bottom-0 left-1/2 w-px bg-primary/30" />
                  </div>
                </div>

                {!isLiveActive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
                    <Button onClick={initCamera} size="lg" className="h-16 px-10 rounded-full font-black">
                      START CAMERA
                    </Button>
                  </div>
                )}
                
                {isProcessingLive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-40">
                    <Loader2 className="h-12 w-12 text-white animate-spin mb-4" />
                    <p className="text-white text-xs font-black uppercase tracking-widest">Identifying X-Ray...</p>
                  </div>
                )}
              </div>
              <div className="p-4 bg-background">
                <Button onClick={handleCapture} disabled={isProcessingLive || !isLiveActive || isAnalyzing} size="lg" className="w-full h-20 text-xl font-black rounded-2xl shadow-xl">
                  {isProcessingLive || isAnalyzing ? <Loader2 className="animate-spin mr-2" /> : <Target className="mr-3 h-6 w-6" />}
                  CAPTURE & ANALYZE
                </Button>
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
                    <Badge variant="outline" className="text-[9px] font-black">TAP HOTSPOTS</Badge>
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

                  {!clinicalInsights ? (
                    <div className="space-y-4">
                      <Skeleton className="h-24 w-full rounded-xl" />
                      <Skeleton className="h-40 w-full rounded-xl" />
                    </div>
                  ) : (
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
                            <p className="text-[11px] font-black">TAP A FINDING FOR CLINICAL INSIGHTS.</p>
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
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <footer className="text-center py-10 opacity-20">
        <p className="text-[10px] uppercase font-black tracking-widest">DentalVision Clinical Systems</p>
      </footer>
    </div>
  );
}
