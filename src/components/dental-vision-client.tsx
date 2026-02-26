'use client';

import { useState, useRef, useTransition, useEffect } from 'react';
import Image from 'next/image';
import { Upload, X, Bot, ScanLine, Eye, Camera, Video, VideoOff, Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { getAnalysisSummary, runAnalysis, runOpgDetection } from '@/app/actions';
import type { AiRadiographDetectionOutput } from '@/ai/flows/ai-radiograph-detection-flow';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  const [overlayStyle, setOverlayStyle] = useState<React.CSSProperties>({});
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { toast } = useToast();

  // Clean up on unmount
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
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Force play
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

  const startLiveAnalysis = async () => {
    const success = await initCamera();
    if (!success) return;

    setIsLiveAnalyzing(true);
    setProcessedWebcamImage(null);
    
    intervalRef.current = setInterval(async () => {
      if (videoRef.current && canvasRef.current && isLiveAnalyzing) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        
        // Ensure video is playing and has data
        if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0 || video.paused) {
          return; 
        }

        const MAX_DIMENSION = 1024;
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
        
        if (context) {
          try {
            context.drawImage(video, 0, 0, width, height);
            const rawDataUri = canvas.toDataURL('image/jpeg', 0.7);

            setIsCheckingOpg(true);
            // 1. Detect if OPG exists in the frame and get its box
            const opgDetection = await runOpgDetection({ imageDataUri: rawDataUri });
            setIsCheckingOpg(false);

            console.log("OPG Detection Result:", opgDetection);

            if (opgDetection.isOpg && opgDetection.boundingBox) {
              const box = opgDetection.boundingBox;
              
              // 2. Crop the image to just the OPG
              // Ensure coordinates are within valid range
              const cropX = Math.max(0, box.x * width);
              const cropY = Math.max(0, box.y * height);
              const cropWidth = Math.min(width - cropX, box.width * width);
              const cropHeight = Math.min(height - cropY, box.height * height);

              if (cropWidth > 50 && cropHeight > 50) {
                const cropCanvas = document.createElement('canvas');
                cropCanvas.width = cropWidth;
                cropCanvas.height = cropHeight;
                const cropCtx = cropCanvas.getContext('2d');
                
                if (cropCtx) {
                  cropCtx.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
                  const croppedDataUri = cropCanvas.toDataURL('image/jpeg', 0.8);

                  // 3. Run dental analysis on the cropped image
                  const result = await runAnalysis({ radiographDataUri: croppedDataUri });
                  if (result.success) {
                    setProcessedWebcamImage(result.data.processedImage);
                    
                    // 4. Map the overlay to the correct position on the video
                    setOverlayStyle({
                      left: `${(cropX / width) * 100}%`,
                      top: `${(cropY / height) * 100}%`,
                      width: `${(cropWidth / width) * 100}%`,
                      height: `${(cropHeight / height) * 100}%`,
                      position: 'absolute'
                    });
                  }
                }
              }
            } else {
              // If OPG is not detected clearly, clear the overlay
              setProcessedWebcamImage(null);
            }
          } catch (e) {
            console.error("Analysis pipeline failed:", e);
            setIsCheckingOpg(false);
          }
        }
      }
    }, 4000); // 4 second cycle for stability and to prevent rate limiting
  };

  const stopLiveAnalysis = () => {
    setIsLiveAnalyzing(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setProcessedWebcamImage(null);
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
    <div className="space-y-8">
      <Tabs defaultValue="upload" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="upload" onClick={stopLiveAnalysis}>
            <Upload className="mr-2 h-4 w-4" />Upload
          </TabsTrigger>
          <TabsTrigger value="live">
            <Camera className="mr-2 h-4 w-4" />Live AR
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          <Card>
            <CardContent className="p-6">
              <div className="grid md:grid-cols-2 gap-8 items-start">
                <div className="space-y-4">
                  <h2 className="text-2xl font-semibold text-primary/90 flex items-center gap-2">
                    <ScanLine className="size-6" />
                    1. Upload OPG
                  </h2>
                  {originalImage ? (
                    <div className="relative group">
                      <Image
                        src={originalImage}
                        alt="Uploaded OPG"
                        width={600}
                        height={400}
                        className="rounded-lg object-contain w-full border bg-muted/20"
                      />
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity rounded-full h-8 w-8"
                        onClick={clearImage}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center justify-center p-10 border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent/50 transition-colors aspect-video border-border"
                    >
                      <Upload className="size-12 text-muted-foreground mb-4" />
                      <p className="text-muted-foreground text-center">
                        <span className="font-semibold text-primary">Click to upload</span> OPG radiograph
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
                  <Button onClick={handleAnalyze} disabled={!originalImage || isAnalyzing} className="w-full" size="lg">
                    {isAnalyzing ? 'Processing...' : 'Run AI Analysis'}
                  </Button>
                </div>

                <div className="space-y-4">
                  <h2 className="text-2xl font-semibold text-primary/90 flex items-center gap-2">
                    <Bot className="size-6" />
                    2. AI Findings
                  </h2>
                  <div className="aspect-video w-full rounded-lg border bg-muted/30 flex items-center justify-center p-4 relative overflow-hidden">
                    {isAnalyzing ? (
                      <Skeleton className="w-full h-full" />
                    ) : processedImage ? (
                      <Image
                        src={processedImage}
                        alt="Analyzed OPG"
                        width={600}
                        height={400}
                        className="rounded-lg object-contain w-full"
                      />
                    ) : (
                      <div className="text-center text-muted-foreground p-4">
                        <Eye className="mx-auto size-12 mb-4" />
                        <p>Analysis results will appear here.</p>
                      </div>
                    )}
                  </div>
                  {analysisSummary && (
                    <Card className="bg-muted/30">
                      <CardContent className="p-4">
                        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1">
                          <Info className="h-4 w-4" /> Summary
                        </h3>
                        <p className="text-sm text-foreground whitespace-pre-wrap">{analysisSummary}</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="live">
          <Card>
            <CardContent className="p-6">
               <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-semibold text-primary/90 flex items-center gap-2">
                      <Camera className="size-6" />
                      Intelligent Live AR
                    </h2>
                    <div className="text-xs text-muted-foreground bg-accent px-2 py-1 rounded-full flex items-center gap-1 min-w-[120px] justify-center">
                      {isCheckingOpg ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {isCheckingOpg ? 'Scanning...' : 'OPG Auto-Detection'}
                    </div>
                  </div>
                  
                  <div className="relative w-full aspect-video bg-black rounded-lg border flex items-center justify-center overflow-hidden">
                    {/* VIDEO FEED */}
                    <video 
                      ref={videoRef} 
                      className="w-full h-full object-contain" 
                      autoPlay 
                      muted 
                      playsInline 
                    />
                    
                    {/* OPG Alignment Guide Overlay (Only when no analysis is active) */}
                    {!processedWebcamImage && (
                      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                        <div className="w-[85%] h-[70%] border-2 border-primary/40 rounded-xl flex items-center justify-center">
                          <div className="absolute top-1/2 left-0 right-0 h-px bg-primary/20" />
                          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-primary/20" />
                          <div className="absolute -top-6 text-primary/60 text-[10px] uppercase font-bold tracking-widest bg-black/40 px-2 py-1 rounded-sm">
                            Center OPG X-Ray Here
                          </div>
                        </div>
                      </div>
                    )}

                    {/* AI ANALYSIS OVERLAY */}
                    {processedWebcamImage && (
                      <div className="z-10 pointer-events-none" style={overlayStyle}>
                        <Image
                          src={processedWebcamImage}
                          alt="AI Analysis Overlay"
                          fill
                          className="object-contain opacity-85 animate-in fade-in zoom-in-95 duration-500"
                        />
                      </div>
                    )}

                    {/* PERMISSION ERROR OVERLAY */}
                    {hasCameraPermission === false && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 text-white p-4 z-20">
                        <VideoOff className="size-12 mb-4 text-destructive"/>
                        <p className="text-lg font-semibold">Camera Access Required</p>
                        <p className="text-sm text-muted-foreground text-center max-w-[250px] mt-2">
                          Please enable camera permissions in your browser settings to use live AR features.
                        </p>
                        <Button variant="outline" className="mt-6" onClick={() => initCamera()}>
                          Retry Permission
                        </Button>
                      </div>
                    )}

                    {/* STATUS INDICATOR */}
                    {isLiveAnalyzing && (
                      <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 text-white py-1.5 px-3 rounded-full text-xs z-20 backdrop-blur-md border border-white/10 shadow-lg">
                        <div className={cn(
                          "w-2.5 h-2.5 rounded-full shadow-[0_0_8px]",
                          processedWebcamImage ? "bg-green-500 shadow-green-500/50" : "bg-yellow-500 shadow-yellow-500/50 animate-pulse"
                        )} />
                        {processedWebcamImage ? "Clinical Data Overlay Active" : (isCheckingOpg ? "Analyzing Frame..." : "Aligning OPG...")}
                      </div>
                    )}
                  </div>

                  <canvas ref={canvasRef} className="hidden" />

                  <div className="flex flex-col gap-3">
                    {!isLiveAnalyzing ? (
                      <Button 
                        onClick={startLiveAnalysis} 
                        className="w-full h-12 shadow-md hover:shadow-lg transition-all" 
                        size="lg"
                      >
                        <Video className="mr-2 h-5 w-5"/>
                        Start AR Session
                      </Button>
                    ) : (
                      <Button 
                        onClick={stopLiveAnalysis} 
                        className="w-full h-12" 
                        size="lg" 
                        variant="destructive"
                      >
                        <VideoOff className="mr-2 h-5 w-5"/>
                        End Session
                      </Button>
                    )}
                    <div className="flex flex-col gap-1 items-center">
                      <p className="text-[10px] text-center text-muted-foreground uppercase tracking-widest font-bold">
                        Intelligent Filtering
                      </p>
                      <p className="text-[10px] text-center text-muted-foreground/60">
                        Privacy First: Frames are analyzed only when a panoramic radiograph is centered.
                      </p>
                    </div>
                  </div>
               </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      
      <div className="text-center text-[10px] text-muted-foreground pb-8 uppercase tracking-tighter opacity-50">
        <p>Experimental Prototype • Clinical Verification Required • Not for Diagnostics</p>
      </div>
    </div>
  );
}
