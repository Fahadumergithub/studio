'use client';

import { useState, useRef, useTransition, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Upload, Bot, ScanLine, Eye, Camera, Info, Loader2, Target, ListChecks, Sparkles, BookOpen, GraduationCap, ZoomIn, HelpCircle } from 'lucide-react';
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

  // Live Analysis workflow state
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
      toast({ variant: 'destructive', title: "Camera Access Denied", description: "Please enable camera permissions." });
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
    setCurrentOriginalImage(dataUri);
    setCurrentProcessedImage(null);
    setCurrentResults(null);
    setClinicalInsights(null);
    setHotspots(null);
    setSelectedFindingIndex(null);

    const result = await runAnalysis({ radiographDataUri: dataUri });
    if (result.success) {
      setCurrentProcessedImage(result.data.processedImage);
      setCurrentResults(result.data.results);
      
      // Parallelize AI mapping and insights
      const [insights, locationData] = await Promise.all([
        getClinicalInsights({ originalImageDataUri: dataUri, detections: result.data.results }),
        getFindingLocations({ processedRadiographDataUri: result.data.processedImage, findings: result.data.results })
      ]);
      
      setClinicalInsights(insights);
      setHotspots(locationData.hotspots);
      
      toast({ title: "Analysis Complete", description: "Interactive Clinical Consult ready." });
    } else {
      toast({ variant: 'destructive', title: "Error", description: result.error });
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
    const rawUri = canvas.toDataURL('image/jpeg', 0.9);
    
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
        
        await processImage(cropCanvas.toDataURL('image/jpeg', 0.9));
        setActiveTab('consult');
        stopLive();
      } else {
        toast({ title: "No OPG Detected", description: "Center the radiograph and try again." });
      }
    } finally {
      setIsProcessingLive(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        startAnalysisTransition(async () => {
          await processImage(event.target?.result as string);
          setActiveTab('consult');
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
    <div className="space-y-4 sm:space-y-6 max-w-5xl mx-auto pb-10 px-2 sm:px-0">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-4 h-11">
          <TabsTrigger value="upload" onClick={stopLive} className="text-xs sm:text-sm"><Upload className="mr-2 h-4 w-4 hidden sm:block" />Upload</TabsTrigger>
          <TabsTrigger value="live" onClick={initCamera} className="text-xs sm:text-sm"><Camera className="mr-2 h-4 w-4 hidden sm:block" />Live AR</TabsTrigger>
          <TabsTrigger value="consult" disabled={!currentResults} className="text-xs sm:text-sm"><Sparkles className="mr-2 h-4 w-4 hidden sm:block" />AI Consult</TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          <Card className="border-primary/10 shadow-lg">
            <CardContent className="p-4 sm:p-8">
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="w-full aspect-[16/9] border-2 border-dashed border-primary/20 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-primary/5 transition-all group"
              >
                {currentOriginalImage && activeTab === 'upload' ? (
                  <div className="relative w-full h-full p-2">
                    <Image src={currentOriginalImage} alt="Uploaded" fill className="object-contain" />
                  </div>
                ) : (
                  <>
                    <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <Upload className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-sm font-semibold text-primary">Upload Panoramic Radiograph</p>
                    <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-widest font-bold">JPG, PNG, DICOM-converted</p>
                  </>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
              <Button disabled={isAnalyzing} className="w-full h-14 mt-6 rounded-xl text-lg font-bold shadow-md" onClick={() => fileInputRef.current?.click()}>
                {isAnalyzing ? <Loader2 className="animate-spin mr-2" /> : <ScanLine className="mr-2" />}
                Run Clinical Analysis
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="live">
          <Card className="border-primary/10 shadow-lg overflow-hidden">
            <CardContent className="p-0 space-y-0">
              <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
                <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                {flash && <div className="absolute inset-0 bg-white z-50 animate-out fade-out duration-300" />}
                
                {/* Visual Guide Overlay */}
                <div className="absolute inset-0 border-[30px] sm:border-[60px] border-black/40 pointer-events-none">
                  <div className="w-full h-full border-2 border-primary/40 rounded-xl relative">
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-primary/20" />
                    <div className="absolute top-0 bottom-0 left-1/2 w-px bg-primary/20" />
                  </div>
                </div>

                {!isLiveActive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
                    <Button onClick={initCamera} size="lg" className="h-14 px-8 rounded-full font-bold">
                      Enable Camera Stream
                    </Button>
                  </div>
                )}
              </div>
              <div className="p-4 bg-background">
                <Button onClick={handleCapture} disabled={isProcessingLive || !isLiveActive} size="lg" className="w-full h-16 text-lg font-bold rounded-xl shadow-xl">
                  {isProcessingLive ? <Loader2 className="animate-spin mr-2" /> : <Target className="mr-2" />}
                  {isProcessingLive ? 'Detecting OPG...' : 'Capture & Analyze'}
                </Button>
                <p className="text-center text-[10px] text-muted-foreground mt-3 uppercase tracking-tighter font-bold">Center the horseshoe arch for best results</p>
              </div>
              <canvas ref={canvasRef} className="hidden" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="consult">
          <div className="grid md:grid-cols-12 gap-6 items-start">
            {/* Left: Interactive Image & Findings */}
            <div className="md:col-span-7 space-y-4">
              <Card className="overflow-hidden border-primary/10 shadow-md">
                <CardContent className="p-0">
                  <div className="bg-muted/30 p-2 border-b flex items-center justify-between">
                    <h3 className="text-[10px] font-black uppercase text-primary/70 flex items-center gap-1">
                      <Eye className="h-3.5 w-3.5" /> Interactive Radiograph
                    </h3>
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground bg-white px-2 py-0.5 rounded-full border">
                      <ZoomIn className="h-2.5 w-2.5" /> Tap any finding
                    </div>
                  </div>
                  <div className="relative aspect-[16/10] bg-black">
                    {currentProcessedImage && (
                      <>
                        <Image src={currentProcessedImage} alt="Analyzed" fill className="object-contain" />
                        {/* Interactive SVG Overlay */}
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
                                  selectedFindingIndex === i ? "stroke-yellow-400 fill-yellow-400/20" : "stroke-transparent hover:stroke-white/50"
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
                <Card className="border-primary/10 shadow-sm">
                  <CardContent className="p-4">
                    <h3 className="text-[10px] font-black uppercase text-primary/70 mb-3 flex items-center gap-1">
                      <ListChecks className="h-3.5 w-3.5" /> Clinical Findings
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {currentResults.map((r, i) => (
                        <Badge 
                          key={i} 
                          onClick={() => setSelectedFindingIndex(i)}
                          variant={selectedFindingIndex === i ? "default" : "secondary"}
                          className={cn(
                            "px-3 py-1.5 text-[9px] font-black cursor-pointer transition-all shadow-sm border",
                            selectedFindingIndex === i ? "scale-105" : "hover:bg-muted/50"
                          )}
                        >
                          {r.disease.toUpperCase()} ({r.tooth_numbers.join(', ')})
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Right: Modular Clinical Insights */}
            <div className="md:col-span-5 space-y-4 sticky top-6">
              <Card className="bg-primary/5 border-primary/20 shadow-xl min-h-[400px]">
                <CardContent className="p-5 sm:p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 bg-primary/10 rounded-lg flex items-center justify-center">
                        <Sparkles className="h-5 w-5 text-primary" />
                      </div>
                      <h2 className="text-lg font-black tracking-tight">Clinical Tutor</h2>
                    </div>
                    <Badge variant="outline" className="text-[8px] px-1.5 font-bold border-primary/20 text-primary uppercase">Gemini 2.5</Badge>
                  </div>

                  {!clinicalInsights ? (
                    <div className="space-y-4">
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-40 w-full" />
                      <Skeleton className="h-24 w-full" />
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* Interactive Deep Dive */}
                      <section className="bg-white/50 p-4 rounded-xl border border-primary/10 min-h-[220px]">
                        <div className="flex items-center gap-1.5 mb-3">
                          <HelpCircle className="h-3.5 w-3.5 text-primary" />
                          <h4 className="text-[10px] font-black uppercase text-primary/70 tracking-widest">
                            {selectedFindingIndex !== null ? 'Selected Pathology' : 'Tap a Finding to Learn'}
                          </h4>
                        </div>
                        
                        {selectedFindingIndex !== null && selectedExplanation ? (
                          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <h5 className="font-bold text-sm mb-1 text-foreground">{selectedExplanation.condition}</h5>
                            <p className="text-[11px] leading-relaxed text-foreground/80 mb-3">{selectedExplanation.significance}</p>
                            <div className="bg-primary/10 p-3 rounded-lg">
                              <p className="text-[10px] font-bold text-primary flex items-center gap-1 mb-1">
                                <Info className="h-3 w-3" /> CLINICAL MANAGEMENT
                              </p>
                              <p className="text-[11px] italic text-primary/90 leading-snug">{selectedExplanation.considerations}</p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center text-center pt-10 opacity-40">
                            <Bot className="h-10 w-10 mb-2" />
                            <p className="text-[11px] font-medium max-w-[200px]">Tap a tooth box or finding badge to see specialized clinical insights.</p>
                          </div>
                        )}
                      </section>

                      {/* General Overview - Compact */}
                      <section>
                        <div className="flex items-center gap-1.5 mb-2">
                          <BookOpen className="h-3 w-3 text-primary/60" />
                          <h4 className="text-[9px] font-black uppercase text-primary/60 tracking-wider">Clinical Status</h4>
                        </div>
                        <p className="text-[11px] leading-relaxed text-foreground/70">{clinicalInsights.clinicalOverview}</p>
                      </section>

                      {/* Pro-Tip - Highlighted */}
                      <div className="bg-primary text-primary-foreground p-4 rounded-2xl shadow-lg border-2 border-white/20">
                        <div className="flex items-center gap-1.5 mb-2">
                          <GraduationCap className="h-4 w-4" />
                          <h4 className="text-[10px] font-black uppercase tracking-widest opacity-80">Student Takeaway</h4>
                        </div>
                        <p className="text-xs font-semibold leading-relaxed">{clinicalInsights.studentTakeaway}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <footer className="text-center py-6 sm:py-10 opacity-30">
        <div className="h-px bg-foreground/10 mb-4" />
        <p className="text-[9px] uppercase font-black tracking-[0.2em]">DentalVision AR Clinical Support</p>
      </footer>
    </div>
  );
}
