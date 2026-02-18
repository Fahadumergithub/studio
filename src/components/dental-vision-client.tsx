'use client';

import { useState, useRef, useTransition } from 'react';
import Image from 'next/image';
import { Upload, X, Bot, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { getAnalysisSummary, runAnalysis } from '@/app/actions';
import { cn } from '@/lib/utils';

export function DentalVisionClient() {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

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
        setOriginalImage(e.target?.result as string);
        setFileName(file.name);
        setProcessedImage(null);
        setAnalysisSummary(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = () => {
    if (!originalImage) return;

    startTransition(async () => {
      setProcessedImage(null);
      setAnalysisSummary(null);
      const result = await runAnalysis({ radiographDataUri: originalImage });
      if (result.success) {
        setProcessedImage(result.data.processedRadiographDataUri);
        if (result.data.detections && result.data.detections.length > 0) {
          const summaryResult = await getAnalysisSummary({ detections: result.data.detections });
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
              <Button onClick={handleAnalyze} disabled={!originalImage || isPending} className="w-full" size="lg">
                {isPending ? 'Analyzing...' : 'Analyze Radiograph'}
              </Button>
            </div>

            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-primary/90 flex items-center gap-2">
                <Bot className="size-6" />
                2. AI Analysis
              </h2>
              <div className="aspect-video w-full rounded-lg border bg-muted/30 flex items-center justify-center p-4">
                {isPending ? (
                  <div className="w-full h-full flex flex-col items-center justify-center space-y-4">
                    <Skeleton className="w-full h-full" />
                    <p className="text-muted-foreground animate-pulse">AI is processing the image...</p>
                  </div>
                ) : processedImage ? (
                  <Image
                    src={processedImage}
                    alt="Processed Radiograph"
                    width={600}
                    height={400}
                    className="rounded-lg object-contain w-full"
                  />
                ) : (
                  <div className="text-center text-muted-foreground p-4">
                    <Bot className="mx-auto size-12 mb-4" />
                    <p className="font-medium">Analysis results will appear here.</p>
                    <p className="text-sm mt-2">
                      The AI-detected issues and simulated AR overlay will be displayed once you upload and analyze a radiograph.
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
                    <CardContent className="p-4">
                        {isPending && !analysisSummary ? (
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
      <div className="text-center text-xs text-muted-foreground">
        <p>This is a prototype for demonstration purposes. AI analysis may not be 100% accurate.</p>
        <p>The "AR Experience" is simulated by overlaying analysis on the image.</p>
      </div>
    </div>
  );
}
