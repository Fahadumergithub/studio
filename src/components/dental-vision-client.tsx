'use client';

import { useState, useRef, useTransition, useEffect } from 'react';
import Image from 'next/image';
import { Upload, X, Bot, ScanLine, Eye, Camera, Video, VideoOff, Info, Loader2, Target, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { getAnalysisSummary, runAnalysis, runOpgDetection } from '@/app/actions';
import type { AiRadiographDetectionOutput } from '@/ai/flows/ai-radiograph-detection-flow';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

type AnalysisResults = AiRadiographDetectionOutput['results'];

export function DentalVisionClient() {
  // State for Upload workflow
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResults | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isAnalyzing, startAnalysisTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State for Live Analysis workflow
  const [isLiveAnalyzing, setIsLiveAnalyzing] = useState(false);
  const [isCheckingOpg, setIsCheckingOpg] = useState(false);
  const [processedWebcamImage, setProcessedWebcamImage] = useState<string | null>(null);
  const [liveResults, setLiveResults] = useState<AnalysisResults | null>(null);
  const [overlayStyle, setOverlayStyle] = useState<React.CSSProperties>({});
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [flash, setFlash] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    return () => {
      stopLiveAnalysis();
    };
  }, []);

  const initCamera = async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setHasCameraPermission(true);
      return true;
    } catch (error) {
      console.error("Camera access error:", error);
      setHasCameraPermission(false);
      toast({
        variant: 'destructive',
        title: 'Camera Access Denied',
        description: 'Please enable camera permissions in your browser settings.',
      });
      return false;
    }
  };

  const captureAndAnalyze = async (manual = false) => {
    if (!videoRef.current || !canvasRef.current) return false;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (video.readyState < 2 || video.videoWidth === 0 || video.paused) return false;

    if (manual) {
      setFlash(true);
      setTimeout(() => setFlash(false), 150);
    }

    // High resolution for detection accuracy
    const MAX_DIMENSION = 1280;
    let width = video.videoWidth;
    let height = video.videoHeight;

    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      if (width > height) {
        height = (MAX_DIMENSION / width) * height;
        width = MAX_DIMENSION;
      } else {
        width = (MAX_DIMENSION / height) * width;
        height = MAX_DIMENSION;
      }
    }

    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return false;

    context.drawImage(video, 0, 0, width, height);
    const rawDataUri = canvas.toDataURL('image/jpeg', 0.85);

    setIsCheckingOpg(true);
    try {
      const opgDetection = await runOpgDetection({ imageDataUri: rawDataUri });

      if (opgDetection.isOpg && opgDetection.boundingBox) {
        const box = opgDetection.boundingBox;
        
        const cropX = Math.floor(Math.max(0, box.x * width));
        const cropY = Math.floor(Math.max(0, box.y * height));
        const cropWidth = Math.floor(Math.min(width - cropX, box.width * width));
        const cropHeight = Math.floor(Math.min(height - cropY, box.height * height));

        if (cropWidth > 100 && cropHeight > 100) {
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = cropWidth;
          cropCanvas.height = cropHeight;
          const cropCtx = cropCanvas.getContext('2d');
          
          if (cropCtx) {
            cropCtx.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
            const croppedDataUri = cropCanvas.toDataURL('image/jpeg', 0.9);

            const result = await runAnalysis({ radiographDataUri: croppedDataUri });
            if (result.success) {
              setProcessedWebcamImage(result.data.processedImage);
              setLiveResults(result.data.results);
              setOverlayStyle({
                left: `${(cropX / width) * 100}%`,
                top: `${(cropY / height) * 100}%`,
                width: `${(cropWidth / width) * 100}%`,
                height: `${(cropHeight / height) * 100}%`,
                position: 'absolute'
              });
              setIsCheckingOpg(false);
              return true;
            }
          }
        }
      } else if (manual) {
        toast({
          title: "OPG Not Found",
          description: "Ensure the entire panoramic x-ray is visible and well-lit.",
        });
      }
    } catch (e) {
      console.error("Analysis failed:", e);
    } finally {
      setIsCheckingOpg(false);
    }
    return false;
  };

  const startLiveAnalysis = async () => {
    const success = await initCamera();
    if (!success) return;

    setIsLiveAnalyzing(true);
    setProcessedWebcamImage(null);
    setLiveResults(null);
    
    const loop = async () => {
      if (!isLiveAnalyzing) return;
      await captureAndAnalyze();
      loopRef.current = setTimeout(loop, 5000);
    };

    loop();
  };

  const stopLiveAnalysis = () => {
    setIsLiveAnalyzing(false);
    if (loopRef.current) {
      clearTimeout(loopRef.current);
      loopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setProcessedWebcamImage(null);
    setLiveResults(null);
  };

  const handleFileChange = (files: FileList | null) => {
    if (files && files[0]) {
      const file = files[0];
      if (!file.type.startsWith('image/')) {
        toast({
          variant: 'destructive',
          title: 'Invalid File Type',
          description: 'Please upload an image file.',
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        setOriginalImage(e.target?.result as string);
        setFileName(file.name);
        setProcessedImage(null);
        setAnalysisResults(null);
        setAnalysisSummary(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = () => {
    if (!originalImage) return;

    startAnalysisTransition(async () => {
      setProcessedImage(null);
      setAnalysisSummary(null);
      setAnalysisResults(null);

      const result = await runAnalysis({ radiographDataUri: originalImage });
      if (result.success) {
        setProcessedImage(result.data.processedImage);
        setAnalysisResults(result.data.results);

        if (result.data.results && result.data.results.length > 0) {
          const summaryResult = await getAnalysisSummary({ results: result.data.results });
          if (summaryResult.success) {
            setAnalysisSummary(summaryResult.data.summary);
          }
        } else {
          setAnalysisSummary('No findings detected.');
        }
      } else {
        toast({
          variant: 'destructive',
          title: 'Analysis Failed',
          description: result.error,
        });
      }
    });
  };

  const clearImage = () => {
    setOriginalImage(null);
    setProcessedImage(null);
    setAnalysisResults(null);
    setFileName(null);
    setAnalysisSummary(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4 sm:space-y-8 max-w-4xl mx-auto">
      <Tabs defaultValue="upload" className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="upload" onClick={stopLiveAnalysis} className="py-2.5">
            <Upload className="mr-2 h-4 w-4" />Upload
          </TabsTrigger>
          <TabsTrigger value="live" className="py-2.5">
            <Camera className="mr-2 h-4 w-4" />Live AR
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-0">
          <Card className="border-none sm:border shadow-md">
            <CardContent className="p-4 sm:p-6">
              <div className="grid md:grid-cols-2 gap-6 sm:gap-8 items-start">
                <div className="space-y-4">
                  <h2 className="text-xl sm:text-2xl font-semibold text-primary/90 flex items-center gap-2">
                    <ScanLine className="size-5 sm:size-6" />
                    1. Upload OPG
                  </h2>
                  {originalImage ? (
                    <div className="relative group overflow-hidden rounded-lg">
                      <Image
                        src={originalImage}
                        alt="Uploaded OPG"
                        width={600}
                        height={400}
                        className="object-contain w-full border bg-muted/20 max-h-[300px] sm:max-h-none"
                      />
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-2 right-2 rounded-full h-8 w-8 shadow-lg"
                        onClick={clearImage}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center justify-center p-6 sm:p-10 border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent/50 transition-colors aspect-video border-border"
                    >
                      <Upload className="size-10 sm:size-12 text-muted-foreground mb-3" />
                      <p className="text-muted-foreground text-center text-sm sm:text-base">
                        <span className="font-semibold text-primary">Tap to upload</span> OPG radiograph
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleFileChange(e.target.files)}
                      />
                    </div>
                  )}
                  <Button onClick={handleAnalyze} disabled={!originalImage || isAnalyzing} className="w-full h-12 text-base" size="lg">
                    {isAnalyzing ? 'Processing...' : 'Run AI Analysis'}
                  </Button>
                </div>

                <div className="space-y-4">
                  <h2 className="text-xl sm:text-2xl font-semibold text-primary/90 flex items-center gap-2">
                    <Bot className="size-5 sm:size-6" />
                    2. AI Findings
                  </h2>
                  <div className="aspect-video w-full rounded-lg border bg-muted/30 flex items-center justify-center p-2 sm:p-4 relative overflow-hidden min-h-[200px]">
                    {isAnalyzing ? (
                      <Skeleton className="w-full h-full" />
                    ) : processedImage ? (
                      <Image
                        src={processedImage}
                        alt="Analyzed OPG"
                        width={600}
                        height={400}
                        className="rounded-lg object-contain w-full max-h-[300px] sm:max-h-none"
                      />
                    ) : (
                      <div className="text-center text-muted-foreground p-4">
                        <Eye className="mx-auto size-10 sm:size-12 mb-3 opacity-40" />
                        <p className="text-sm">Analysis results will appear here.</p>
                      </div>
                    )}
                  </div>
                  {analysisSummary && (
                    <Card className="bg-muted/30 border-none shadow-none">
                      <CardContent className="p-3 sm:p-4">
                        <h3 className="text-xs font-bold mb-2 flex items-center gap-1 text-primary/70 uppercase tracking-widest">
                          <Info className="h-3 w-3" /> Summary
                        </h3>
                        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{analysisSummary}</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="live" className="mt-0">
          <Card className="border-none sm:border shadow-md">
            <CardContent className="p-3 sm:p-6">
               <div className="space-y-4 sm:space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl sm:text-2xl font-semibold text-primary/90 flex items-center gap-2">
                      <Camera className="size-5 sm:size-6" />
                      Live AR Session
                    </h2>
                    <div className="flex items-center gap-2">
                      <div className="text-[10px] text-muted-foreground bg-accent px-2 py-1 rounded-full flex items-center gap-1 uppercase font-bold tracking-tight">
                        {isCheckingOpg ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        {isCheckingOpg ? 'Analyzing...' : 'Ready'}
                      </div>
                    </div>
                  </div>
                  
                  <div className="relative w-full aspect-[4/3] sm:aspect-video bg-black rounded-xl border flex items-center justify-center overflow-hidden shadow-2xl">
                    <video 
                      ref={videoRef} 
                      className="w-full h-full object-cover sm:object-contain" 
                      autoPlay 
                      muted 
                      playsInline 
                    />
                    
                    {flash && <div className="absolute inset-0 bg-white z-50 animate-out fade-out duration-150" />}

                    {!processedWebcamImage && isLiveAnalyzing && (
                      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                        <div className="w-[90%] h-[70%] sm:w-[85%] sm:h-[75%] border-2 border-primary/40 rounded-2xl flex items-center justify-center bg-primary/5">
                          <div className="absolute top-1/2 left-0 right-0 h-px bg-primary/20" />
                          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-primary/20" />
                          <div className="absolute -top-4 text-primary text-[9px] uppercase font-black tracking-[0.2em] bg-background/90 px-3 py-1.5 rounded-full border shadow-sm">
                            Center OPG Frame
                          </div>
                        </div>
                      </div>
                    )}

                    {processedWebcamImage && (
                      <div className="z-10 pointer-events-none" style={overlayStyle}>
                        <Image
                          src={processedWebcamImage}
                          alt="AI Analysis Overlay"
                          fill
                          className="object-contain opacity-90 animate-in fade-in zoom-in-95 duration-500"
                        />
                      </div>
                    )}

                    {hasCameraPermission === false && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 text-white p-6 z-20">
                        <VideoOff className="size-10 mb-4 text-destructive"/>
                        <p className="text-lg font-semibold">Camera Access Required</p>
                        <p className="text-sm text-muted-foreground text-center mt-2">
                          Please enable camera permissions in your settings.
                        </p>
                        <Button variant="outline" className="mt-6 border-white/20 text-white hover:bg-white/10" onClick={() => initCamera()}>
                          Retry Permission
                        </Button>
                      </div>
                    )}

                    {isLiveAnalyzing && (
                      <div className="absolute top-3 left-3 sm:top-4 sm:left-4 flex items-center gap-2 bg-black/70 text-white py-1.5 px-3 rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-widest z-20 backdrop-blur-md border border-white/10 shadow-xl">
                        <div className={cn(
                          "w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shadow-[0_0_8px]",
                          processedWebcamImage ? "bg-green-500 shadow-green-500/50" : (isCheckingOpg ? "bg-blue-500 animate-pulse shadow-blue-500/50" : "bg-yellow-500 shadow-yellow-500/50")
                        )} />
                        {processedWebcamImage ? "Analysis Live" : (isCheckingOpg ? "Processing..." : "Scanning...")}
                      </div>
                    )}
                  </div>

                  <canvas ref={canvasRef} className="hidden" />

                  <div className="flex flex-col gap-3">
                    {!isLiveAnalyzing ? (
                      <Button 
                        onClick={startLiveAnalysis} 
                        className="w-full h-14 sm:h-16 shadow-lg text-base sm:text-lg font-bold rounded-xl" 
                        size="lg"
                      >
                        <Video className="mr-2 h-6 w-6"/>
                        Launch AR Clinical Session
                      </Button>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <Button 
                          onClick={() => captureAndAnalyze(true)} 
                          className="h-14 sm:h-16 bg-primary hover:bg-primary/90 text-sm sm:text-base font-bold shadow-lg rounded-xl" 
                          size="lg"
                          disabled={isCheckingOpg}
                        >
                          <Target className="mr-2 h-5 w-5"/>
                          Capture
                        </Button>
                        <Button 
                          onClick={stopLiveAnalysis} 
                          className="h-14 sm:h-16 text-sm sm:text-base font-bold shadow-md rounded-xl" 
                          size="lg" 
                          variant="destructive"
                        >
                          <VideoOff className="mr-2 h-5 w-5"/>
                          End Session
                        </Button>
                      </div>
                    )}
                  </div>

                  {liveResults && liveResults.length > 0 && (
                    <Card className="bg-primary/5 border-primary/20 animate-in slide-in-from-bottom-2 duration-300 shadow-sm">
                      <CardContent className="p-3 sm:p-4">
                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/70 mb-3 flex items-center gap-2">
                          <ListChecks className="h-4 w-4" /> Live Results
                        </h3>
                        <div className="flex flex-wrap gap-1.5 sm:gap-2">
                          {liveResults.map((finding, idx) => (
                            <Badge key={idx} variant="outline" className="bg-background/90 py-1 sm:py-1.5 px-2 sm:px-3 border-primary/20 flex items-center gap-1.5 shadow-sm text-[10px] sm:text-xs">
                              <span className="font-bold text-primary">{finding.disease}</span>
                              <span className="text-muted-foreground font-medium">{finding.count}x</span>
                              <span className="text-primary/50 font-mono">Teeth: {finding.tooth_numbers.join(', ')}</span>
                            </Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <div className="flex flex-col gap-1.5 items-center">
                    <p className="text-[9px] text-center text-muted-foreground uppercase tracking-[0.3em] font-black opacity-60">
                      Smart Radiograph Alignment
                    </p>
                    <p className="text-[9px] text-center text-muted-foreground/60 leading-relaxed max-w-xs px-4">
                      Position the panoramic X-ray within the scanning frame. AI automatically crops and analyzes findings.
                    </p>
                  </div>
               </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      
      <div className="text-center text-[9px] text-muted-foreground py-4 uppercase tracking-tighter opacity-40">
        <p>Experimental Prototype • Clinical Verification Required</p>
      </div>
    </div>
  );
}
