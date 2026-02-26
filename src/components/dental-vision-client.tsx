'use client';

import { useState, useRef, useTransition, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Upload, Bot, ScanLine, Eye, Camera, Info, Loader2, Target, ListChecks, Sparkles, BookOpen, GraduationCap, ZoomIn, HelpCircle, ChevronRight } from 'lucide-react';
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
  
  // Shared state
  const [currentOriginalImage, setCurrentOriginalImage] = useState<string | null>(null);
  const [currentProcessedImage, setCurrentProcessedImage] = useState<string | null>(null);
  const [currentResults, setCurrentResults] = useState<AnalysisResults | null>(null);
  const [clinicalInsights, setClinicalInsights] = useState<RadiographTutorOutput | null>(null);
  const [hotspots, setHotspots] = useState<Hotspots | null>(null);
  const [selectedFindingIndex, setSelectedFindingIndex] = useState<number | null>(null);
  
  // Workflow state
  const [isAnalyzing, startAnalysisTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live AR state
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
    // Reset clinical data
    setCurrentProcessedImage(null);
    setCurrentResults(null);
    setClinicalInsights(null);
    setHotspots(null);
    setSelectedFindingIndex(null);

    try {
      const result = await runAnalysis({ radiographDataUri: dataUri });
      if (result.success) {
        setCurrentProcessedImage(result.data.processedImage);
        setCurrentResults(result.data.results);
        
        // Parallelize location mapping and AI tutor insights
        const [insights, locationData] = await Promise.all([
          getClinicalInsights({ originalImageDataUri: dataUri, detections: result.data.results }),
          getFindingLocations({ processedRadiographDataUri: result.data.processedImage, findings: result.data.results })
        ]);
        
        setClinicalInsights(insights);
        setHotspots(locationData.hotspots);
        
        setActiveTab('consult');
        toast({ title: "Clinical Analysis Complete", description: "Interactive hotspots and AI tutor are now active." });
      } else {
        toast({ variant: 'destructive', title: "Analysis Failed", description: result.error });
      }
    } catch (e) {
      toast({ variant: 'destructive', title: "System Error", description: "A communication error occurred with the clinical server." });
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
        await processImage(croppedUri);
        stopLive();
      } else {
        toast({ title: "No OPG Identified", description: "Ensure the radiograph fills the frame and try again." });
      }
    } catch (err) {
      toast({ variant: 'destructive', title: "Detection Error", description: "Failed to process the captured frame." });
    } finally {
      setIsProcessingLive(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUri = event.target?.result as string;
        setCurrentOriginalImage(dataUri);
        startAnalysisTransition(async () => {
          await processImage(dataUri);
        });
      };
      reader.readAsDataURL(file);
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
          <TabsTrigger value="upload" onClick={stopLive} className="text-[11px] sm:text-sm font-bold"><Upload className="mr-2 h-4 w-4 hidden sm:block" />UPLOAD</TabsTrigger>
          <TabsTrigger value="live" onClick={initCamera} className="text-[11px] sm:text-sm font-bold"><Camera className="mr-2 h-4 w-4 hidden sm:block" />LIVE AR</TabsTrigger>
          <TabsTrigger value="consult" disabled={!currentResults} className="text-[11px] sm:text-sm font-bold"><Sparkles className="mr-2 h-4 w-4 hidden sm:block" />CONSULT</TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          <Card className="border-primary/10 shadow-xl rounded-2xl overflow-hidden">
            <CardContent className="p-4 sm:p-8">
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="w-full aspect-video sm:aspect-[16/7] border-2 border-dashed border-primary/20 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-primary/5 transition-all group overflow-hidden relative"
              >
                {currentOriginalImage && !isAnalyzing ? (
                  <Image src={currentOriginalImage} alt="Uploaded OPG" fill className="object-contain p-2" />
                ) : (
                  <>
                    <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <Upload className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-sm font-bold text-primary">SELECT PANORAMIC X-RAY</p>
                    <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-widest font-black opacity-60">JPG, PNG, DICOM</p>
                  </>
                )}
                {isAnalyzing && (
                  <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                    <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
                    <p className="text-xs font-black uppercase tracking-widest text-primary">Analyzing Radiograph...</p>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
              <Button disabled={isAnalyzing} className="w-full h-16 mt-6 rounded-xl text-lg font-black shadow-lg shadow-primary/20" onClick={() => fileInputRef.current?.click()}>
                {isAnalyzing ? <Loader2 className="animate-spin mr-2" /> : <ScanLine className="mr-2" />}
                RUN CLINICAL ANALYSIS
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="live">
          <Card className="border-primary/10 shadow-2xl overflow-hidden rounded-2xl">
            <CardContent className="p-0">
              <div className="relative aspect-[4/3] sm:aspect-video bg-black flex items-center justify-center overflow-hidden">
                <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                {flash && <div className="absolute inset-0 bg-white z-50 animate-out fade-out duration-300" />}
                
                {/* Visual Scanning Guide */}
                <div className="absolute inset-0 border-[40px] border-black/50 pointer-events-none">
                  <div className="w-full h-full border-2 border-primary/50 rounded-xl relative shadow-[0_0_100px_rgba(0,0,0,0.5)_inset]">
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-primary/30" />
                    <div className="absolute top-0 bottom-0 left-1/2 w-px bg-primary/30" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-2/3 h-2/3 border border-primary/20 rounded-[50%] opacity-20" />
                    </div>
                  </div>
                </div>

                {!isLiveActive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
                    <Button onClick={initCamera} size="lg" className="h-16 px-10 rounded-full font-black text-lg shadow-2xl">
                      ENABLE CAMERA STREAM
                    </Button>
                  </div>
                )}
                
                {isProcessingLive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-40">
                    <Loader2 className="h-12 w-12 text-white animate-spin mb-4" />
                    <p className="text-white text-xs font-black uppercase tracking-[0.2em]">Detecting OPG Radiograph...</p>
                  </div>
                )}
              </div>
              <div className="p-4 bg-background">
                <Button onClick={handleCapture} disabled={isProcessingLive || !isLiveActive} size="lg" className="w-full h-20 text-xl font-black rounded-2xl shadow-xl active:scale-95 transition-transform">
                  {isProcessingLive ? <Loader2 className="animate-spin mr-2" /> : <Target className="mr-3 h-6 w-6" />}
                  CAPTURE & ANALYZE
                </Button>
                <p className="text-center text-[10px] text-muted-foreground mt-4 uppercase tracking-tighter font-black opacity-60">CENTER THE PANORAMIC JAW FOR BEST RESULTS</p>
              </div>
              <canvas ref={canvasRef} className="hidden" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="consult">
          <div className="grid md:grid-cols-12 gap-4 items-start">
            {/* Left: Mobile-Focused Interactive Image */}
            <div className="md:col-span-7 space-y-4">
              <Card className="overflow-hidden border-primary/20 shadow-xl rounded-2xl">
                <CardContent className="p-0">
                  <div className="bg-primary/5 p-3 border-b flex items-center justify-between">
                    <h3 className="text-[10px] font-black uppercase text-primary tracking-widest flex items-center gap-2">
                      <Eye className="h-4 w-4" /> INTERACTIVE RADIOGRAPH
                    </h3>
                    <Badge variant="outline" className="text-[9px] font-black bg-white/50">TAP TO IDENTIFY</Badge>
                  </div>
                  <div className="relative aspect-[16/10] bg-black">
                    {currentProcessedImage && (
                      <>
                        <Image src={currentProcessedImage} alt="Analyzed Radiograph" fill className="object-contain" />
                        {/* Interactive SVG Overlays */}
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
                                  selectedFindingIndex === i ? "stroke-yellow-400 fill-yellow-400/30" : "stroke-transparent hover:stroke-white/60 hover:fill-white/10"
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
                <div className="flex flex-wrap gap-2 p-1">
                  {currentResults.map((r, i) => (
                    <Badge 
                      key={i} 
                      onClick={() => setSelectedFindingIndex(i)}
                      variant={selectedFindingIndex === i ? "default" : "secondary"}
                      className={cn(
                        "px-4 py-2 text-[10px] font-black cursor-pointer transition-all shadow-md border-2",
                        selectedFindingIndex === i ? "scale-105 border-yellow-400" : "hover:bg-muted/50 border-transparent"
                      )}
                    >
                      {r.disease.toUpperCase()} ({r.tooth_numbers.join(', ')})
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Modular Clinical Insights */}
            <div className="md:col-span-5 space-y-4">
              <Card className="bg-primary/5 border-primary/20 shadow-2xl rounded-2xl min-h-[350px]">
                <CardContent className="p-5 sm:p-6">
                  <div className="flex items-center justify-between mb-6 border-b border-primary/10 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary">
                        <Sparkles className="h-6 w-6" />
                      </div>
                      <h2 className="text-lg font-black tracking-tight leading-none uppercase">Clinical Tutor</h2>
                    </div>
                    <Badge variant="outline" className="text-[8px] font-bold border-primary/30">V2.5 FLASH</Badge>
                  </div>

                  {!clinicalInsights ? (
                    <div className="space-y-4">
                      <Skeleton className="h-24 w-full rounded-xl" />
                      <Skeleton className="h-40 w-full rounded-xl" />
                      <Skeleton className="h-20 w-full rounded-xl" />
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* Deep Dive Panel */}
                      <section className="bg-white p-5 rounded-2xl border-2 border-primary/10 shadow-sm min-h-[180px]">
                        <div className="flex items-center gap-2 mb-4">
                          <HelpCircle className="h-4 w-4 text-primary" />
                          <h4 className="text-[10px] font-black uppercase text-primary/60 tracking-[0.2em]">
                            {selectedFindingIndex !== null ? 'Selected Finding' : 'Select a Finding to Inspect'}
                          </h4>
                        </div>
                        
                        {selectedFindingIndex !== null && selectedExplanation ? (
                          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <h5 className="font-black text-sm mb-2 text-foreground flex items-center justify-between">
                              {selectedExplanation.condition.toUpperCase()}
                              <ChevronRight className="h-4 w-4 text-primary/40" />
                            </h5>
                            <p className="text-[12px] leading-relaxed text-foreground/70 mb-5">{selectedExplanation.significance}</p>
                            <div className="bg-primary/5 p-4 rounded-xl border border-primary/10">
                              <p className="text-[10px] font-black text-primary flex items-center gap-2 mb-2 tracking-widest">
                                <Info className="h-3 w-3" /> CLINICAL MANAGEMENT
                              </p>
                              <p className="text-[12px] italic text-primary/80 font-medium leading-snug">{selectedExplanation.considerations}</p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center text-center pt-8 opacity-20">
                            <Bot className="h-12 w-12 mb-3" />
                            <p className="text-[11px] font-black max-w-[180px] leading-tight">TAP A HOTSPOT OR BADGE FOR MODULAR CLINICAL INSIGHTS.</p>
                          </div>
                        )}
                      </section>

                      {/* General Overview */}
                      <section className="px-1">
                        <div className="flex items-center gap-2 mb-2">
                          <BookOpen className="h-4 w-4 text-primary/60" />
                          <h4 className="text-[9px] font-black uppercase text-primary/60 tracking-widest">Clinical Overview</h4>
                        </div>
                        <p className="text-[11px] leading-relaxed text-foreground/60">{clinicalInsights.clinicalOverview}</p>
                      </section>

                      {/* Student Pro-Tip */}
                      <div className="bg-primary text-primary-foreground p-5 rounded-2xl shadow-lg border-2 border-white/10">
                        <div className="flex items-center gap-2 mb-3">
                          <GraduationCap className="h-5 w-5" />
                          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] opacity-70">Learning Takeaway</h4>
                        </div>
                        <p className="text-[12px] font-bold leading-relaxed">{clinicalInsights.studentTakeaway}</p>
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
        <div className="h-px bg-foreground/10 mb-6" />
        <p className="text-[10px] uppercase font-black tracking-[0.4em]">DentalVision AR Systems</p>
      </footer>
    </div>
  );
}
