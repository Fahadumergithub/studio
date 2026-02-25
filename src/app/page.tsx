import { DentalVisionClient } from '@/components/dental-vision-client';

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto p-4 sm:p-8">
        <header className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold text-primary font-headline tracking-tight">
            DentalVision AR
          </h1>
          <p className="mt-2 text-lg text-muted-foreground">
            Upload a dental radiograph or use your camera for live AI analysis.
          </p>
        </header>
        <DentalVisionClient />
      </div>
    </main>
  );
}
