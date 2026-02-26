'use client';

import { useState, useRef, useTransition, useEffect } from 'react';
import Image from 'next/image';
import { Upload, X, Bot, ScanLine, Eye, Camera, VideoOff, Info, Loader2, Target, ListChecks, Zap, Sparkles, BookOpen, GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { getAnalysisSummary, runAnalysis, runOpgDetection, getClinicalInsights } from '@/app/actions';
import type { AiRadiographDetectionOutput } from '@/ai/flows/ai-radiograph-detection-flow';
import type { RadiographTutorOutput } from '@/ai/flows/radiograph-tutor-flow';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

type AnalysisResults = AiRadiographDetectionOutput['results'];

export function DentalVisionClient() {
  const [activeTab, setActiveTab] = useState('upload');
  
  // Shared state
  const [currentOriginalImage, setCurrentOriginalImage] = useState<string | null>(null);
  const [currentProcessedImage, setCurrentProcessedImage] = useState<string | null>(null);
  const [currentResults, setCurrentResults] = useState<AnalysisResults | null>(null);
  const [clinicalInsights, setClinicalInsights] = useState<RadiographTutorOutput | null>(null);
  
  // Upload workflow state
  const [isAnalyzing, startAnalysisTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live Analysis workflow state
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [isProcessingLive, setIsProcessingLive] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
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
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setHasCameraPermission(true);
      return true;
    } catch (e) {
      setHasCameraPermission(false);
      return false;
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

    const result = await runAnalysis({ radiographDataUri: dataUri });
    if (result.success) {
      setCurrentProcessedImage(result.data.processedImage);
      setCurrentResults(result.data.results);
      
      // Auto-fetch clinical insights
      const insights = await getClinicalInsights({
        originalImageDataUri: dataUri,
        detections: result.data.results
      });
      setClinicalInsights(insights);
      
      toast({ title: "Analysis Complete", description: "AI Clinical Consult is now available." });
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
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
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
      } else {
        toast({ title: "No OPG Detected", description: "Try to center the radiograph more clearly." });
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

  return (
    <div className="space-y-4 sm:space-y-8 max-w-4xl mx-auto pb-20">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-6">
          <TabsTrigger value="upload" onClick={stopLive}><Upload className="mr-2 h-4 w-4" />Upload</TabsTrigger>
          <TabsTrigger value="live" onClick={initCamera}><Camera className="mr-2 h-4 w-4" />Live AR</TabsTrigger>
          <TabsTrigger value="consult" disabled={!currentResults}><Sparkles className="mr-2 h-4 w-4" />AI Consult</TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-col items-center gap-6">
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full aspect-video border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  {currentOriginalImage && activeTab === 'upload' ? (
                    <div className="relative w-full h-full p-2">
                      <Image src={currentOriginalImage} alt="Uploaded" fill className="object-contain" />
                    </div>
                  ) : (
                    <>
                      <Upload className="h-10 w-10 text-muted-foreground mb-2" />
                      <p className="text-sm font-medium">Select OPG Radiograph</p>
                    </>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                <Button disabled={isAnalyzing} className="w-full h-12" onClick={() => fileInputRef.current?.click()}>
                  {isAnalyzing ? <Loader2 className="animate-spin mr-2" /> : <ScanLine className="mr-2" />}
                  Analyze Radiograph
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="live">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="relative aspect-video bg-black rounded-xl overflow-hidden border">
                <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                {flash && <div className="absolute inset-0 bg-white z-50 animate-out fade-out" />}
                <div className="absolute inset-0 border-2 border-primary/20 rounded-xl pointer-events-none">
                  <div className="absolute top-1/2 left-4 right-4 h-px bg-primary/10" />
                </div>
              </div>
              <canvas ref={canvasRef} className="hidden" />
              <Button onClick={handleCapture} disabled={isProcessingLive} size="lg" className="w-full h-16 text-lg font-bold">
                {isProcessingLive ? <Loader2 className="animate-spin mr-2" /> : <Target className="mr-2" />}
                Capture & Consult
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="consult">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <Card>
                <CardContent className="p-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-primary mb-4 flex items-center gap-2">
                    <Eye className="h-4 w-4" /> Analyzed Image
                  </h3>
                  <div className="relative aspect-[4/3] bg-muted rounded-lg overflow-hidden border">
                    {currentProcessedImage && <Image src={currentProcessedImage} alt="Analyzed" fill className="object-contain" />}
                  </div>
                </CardContent>
              </Card>

              {currentResults && (
                <Card>
                  <CardContent className="p-4">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-primary mb-4 flex items-center gap-2">
                      <ListChecks className="h-4 w-4" /> Detected Findings
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {currentResults.map((r, i) => (
                        <Badge key={i} variant="secondary" className="px-3 py-1.5 text-[10px] font-bold">
                          {r.disease.toUpperCase()} ({r.tooth_numbers.join(', ')})
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-4">
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-primary" /> Clinical Consult
                    </h2>
                    <Badge variant="outline" className="text-[9px] uppercase tracking-tighter">Powered by Gemini Flash</Badge>
                  </div>

                  {!clinicalInsights ? (
                    <div className="space-y-4">
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-40 w-full" />
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <section>
                        <h4 className="text-[10px] font-black uppercase text-primary/70 mb-2 flex items-center gap-1">
                          <BookOpen className="h-3 w-3" /> Overview
                        </h4>
                        <p className="text-sm leading-relaxed text-foreground/90">{clinicalInsights.clinicalOverview}</p>
                      </section>

                      <section className="space-y-4">
                        <h4 className="text-[10px] font-black uppercase text-primary/70 mb-2 flex items-center gap-1">
                          <Info className="h-3 w-3" /> Deep Dive
                        </h4>
                        {clinicalInsights.pathologyExplanation.map((p, i) => (
                          <div key={i} className="bg-background/50 p-3 rounded-lg border border-primary/10">
                            <h5 className="font-bold text-xs mb-1">{p.condition}</h5>
                            <p className="text-[11px] mb-2 text-muted-foreground">{p.significance}</p>
                            <div className="text-[10px] italic text-primary/80 bg-primary/5 p-1.5 rounded">
                              Note: {p.considerations}
                            </div>
                          </div>
                        ))}
                      </section>

                      <div className="bg-primary text-primary-foreground p-4 rounded-xl shadow-lg">
                        <h4 className="text-[10px] font-black uppercase mb-2 flex items-center gap-1">
                          <GraduationCap className="h-4 w-4" /> Student Takeaway
                        </h4>
                        <p className="text-sm font-medium">{clinicalInsights.studentTakeaway}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <footer className="text-center py-8 opacity-40">
        <p className="text-[10px] uppercase font-bold tracking-widest">DentalVision Clinical Prototype</p>
      </footer>
    </div>
  );
}
