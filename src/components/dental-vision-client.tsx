'use client';

import { useState, useRef, useTransition, useEffect } from 'react';
import Image from 'next/image';
import { Upload, X, Bot, ScanLine, Eye, Camera, Video, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { getAnalysisSummary, runAnalysis } from '@/app/actions';
import type { AiRadiographDetectionOutput } from '@/ai/flows/ai-radiograph-detection-flow';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';


type AnalysisResults = AiRadiographDetectionOutput['results'];

export function DentalVisionClient() {
  // State for Upload workflow
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResults | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isAnalyzing, startAnalysisTransition] = useTransition();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State for Live Analysis workflow
  const [isLiveAnalyzing, setIsLiveAnalyzing] = useState(false);
  const [processedWebcamImage, setProcessedWebcamImage] = useState<string | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { toast } = useToast();

  // Effect to get camera permission and stream
  useEffect(() => {
    async function getCameraPermission() {
      try {
        // First, try for the environment-facing camera (ideal for radiographs)
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: { ideal: 'environment' } } 
        });
        
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setHasCameraPermission(true);
      } catch (error) {
        console.warn("Could not get environment camera, trying default camera.", error);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
          setHasCameraPermission(true);
        } catch (finalError) {
          console.error('Error accessing camera:', finalError);
          setHasCameraPermission(false);
          toast({
            variant: 'destructive',
            title: 'Camera Access Denied',
            description: 'Please enable camera permissions in your browser settings to use the live analysis feature.',
          });
        }
      }
    }

    if (hasCameraPermission === null) {
      getCameraPermission();
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [hasCameraPermission, toast]);


  const startLiveAnalysis = () => {
    setIsLiveAnalyzing(true);
    setProcessedWebcamImage(null);
    
    intervalRef.current = setInterval(async () => {
      if (videoRef.current && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        
        // Ensure video is ready and has dimensions to avoid "Invalid input data" errors
        if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
            return; 
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUri = canvas.toDataURL('image/jpeg', 0.8);

          const result = await runAnalysis({ radiographDataUri: dataUri });
          if (result.success) {
            setProcessedWebcamImage(result.data.processedImage);
          } else {
            console.error("Live analysis frame failed:", result.error);
          }
        }
      }
    }, 2500); // Analyzed every 2.5 seconds to balance responsiveness and API load
  };

  const stopLiveAnalysis = () => {
    setIsLiveAnalyzing(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
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
          description: 'Please upload an image file (JPEG, PNG, etc.).',
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        clearImage();
        setOriginalImage(e.target?.result as string);
        setFileName(file.name);
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
          } else {
            setAnalysisSummary(`Could not generate summary: ${summaryResult.error}`);
          }
        } else {
          setAnalysisSummary('No specific items were detected in the analysis.');
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

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileChange(e.dataTransfer.files);
  };
  
  return (
    <div className="space-y-8">
      <Tabs defaultValue="upload" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="upload"><Upload className="mr-2" />Upload Radiograph</TabsTrigger>
          <TabsTrigger value="live"><Camera className="mr-2" />Live Analysis</TabsTrigger>
        </TabsList>
        <TabsContent value="upload">
          <Card>
            <CardContent className="p-6">
              <div className="grid md:grid-cols-2 gap-8 items-start">
                <div className="space-y-4">
                  <h2 className="text-2xl font-semibold text-primary/90 flex items-center gap-2">
                    <ScanLine className="size-6" />
                    1. Upload Radiograph
                  </h2>
                  {originalImage ? (
                    <div className="relative group">
                      <Image
                        src={originalImage}
                        alt="Uploaded Radiograph"
                        width={600}
                        height={400}
                        className="rounded-lg object-contain w-full border bg-muted/20"
                      />
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity rounded-full h-8 w-8"
                        onClick={clearImage}
                        aria-label="Remove image"
                      >
                        <X className="size-4" />
                      </Button>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-2 rounded-b-lg truncate">
                        {fileName}
                      </div>
                    </div>
                  ) : (
                    <div
                      onDragOver={onDragOver}
                      onDragLeave={onDragLeave}
                      onDrop={onDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        'flex flex-col items-center justify-center p-10 border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent/50 transition-colors aspect-video',
                        isDragging ? 'border-primary bg-accent' : 'border-border'
                      )}
                    >
                      <Upload className="size-12 text-muted-foreground mb-4" />
                      <p className="text-muted-foreground text-center">
                        <span className="font-semibold text-primary">Click to upload</span> or drag and drop
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        PNG, JPG, or other image formats
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
                  <div className="flex gap-2">
                    <Button onClick={handleAnalyze} disabled={!originalImage || isAnalyzing} className="w-full" size="lg">
                      {isAnalyzing ? 'Analyzing...' : 'Run Analysis'}
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  <h2 className="text-2xl font-semibold text-primary/90 flex items-center gap-2">
                    <Bot className="size-6" />
                    2. Analysis Results
                  </h2>
                  <div className="aspect-video w-full rounded-lg border bg-muted/30 flex items-center justify-center p-4 relative">
                    {isAnalyzing ? (
                      <div className="w-full h-full flex flex-col items-center justify-center space-y-4">
                        <Skeleton className="w-full h-full" />
                        <p className="text-muted-foreground animate-pulse">AI is processing the image...</p>
                      </div>
                    ) : processedImage ? (
                      <Image
                        src={processedImage}
                        alt="Analyzed Radiograph"
                        width={600}
                        height={400}
                        className="rounded-lg object-contain w-full"
                      />
                    ) : (
                      <div className="text-center text-muted-foreground p-4">
                        <Eye className="mx-auto size-12 mb-4" />
                        <p className="font-medium">Analysis preview will appear here.</p>
                        <p className="text-sm mt-2">
                          Upload and analyze a radiograph to see the results.
                        </p>
                      </div>
                    )}
                  </div>
                    <div className="space-y-4 pt-4">
                      <h3 className="text-xl font-semibold text-primary/80 flex items-center gap-2">
                        <Bot className="size-5" />
                        Analysis Summary
                      </h3>
                      <Card className="bg-muted/30">
                        <CardContent className="p-4 min-h-[120px]">
                            {isAnalyzing && !analysisSummary ? (
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-3/4" />
                                    <Skeleton className="h-4 w-full" />
                                    <Skeleton className="h-4 w-1/2" />
                                </div>
                            ) : analysisSummary ? (
                                <p className="text-sm text-foreground whitespace-pre-wrap">{analysisSummary}</p>
                            ) : (
                                <p className="text-sm text-muted-foreground">The AI-generated summary of findings will appear here once an analysis is complete.</p>
                            )}
                        </CardContent>
                      </Card>
                    </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="live">
          <Card>
            <CardContent className="p-6">
               <div className="space-y-4">
                  <h2 className="text-2xl font-semibold text-primary/90 flex items-center gap-2">
                    <Camera className="size-6" />
                    Live AR Analysis
                  </h2>
                  <div className="relative w-full aspect-video bg-black rounded-lg border flex items-center justify-center overflow-hidden">
                    <video 
                      ref={videoRef} 
                      className="w-full h-full object-contain" 
                      autoPlay 
                      muted 
                      playsInline 
                    />
                    {processedWebcamImage && (
                      <div className="absolute inset-0 z-10 pointer-events-none">
                        <Image
                          src={processedWebcamImage}
                          alt="Processed webcam overlay"
                          fill
                          className="object-contain opacity-70 transition-opacity duration-300"
                        />
                      </div>
                    )}
                    {hasCameraPermission === false && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white p-4 z-20">
                        <VideoOff className="size-12 mb-4 text-destructive"/>
                        <p className="text-lg font-semibold">Camera Access Denied</p>
                        <p className="text-sm text-center mt-2">Please enable camera permissions in your browser settings to use this feature.</p>
                      </div>
                    )}
                     {isLiveAnalyzing && (
                        <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-black/60 text-white py-1.5 px-3 rounded-full text-sm z-20 backdrop-blur-sm">
                            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></div>
                            Analyzing Live...
                        </div>
                    )}
                  </div>
                  <canvas ref={canvasRef} className="hidden" />
                  <div className="flex gap-2">
                     {!isLiveAnalyzing ? (
                        <Button onClick={startLiveAnalysis} disabled={hasCameraPermission !== true} className="w-full" size="lg">
                            <Video className="mr-2"/>
                            Start Live Analysis
                        </Button>
                    ) : (
                        <Button onClick={stopLiveAnalysis} className="w-full" size="lg" variant="destructive">
                            <VideoOff className="mr-2"/>
                            Stop Analysis
                        </Button>
                    )}
                  </div>
               </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <div className="text-center text-xs text-muted-foreground">
        <p>This is a prototype for demonstration purposes. AI analysis may not be 100% accurate.</p>
      </div>
    </div>
  );
}
