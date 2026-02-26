# DentalVision AR

DentalVision AR is a mobile-first, AI-powered diagnostic and educational tool for dental professionals and students. It combines specialized computer vision with large language models to provide real-time analysis and clinical tutoring for dental panoramic radiographs (OPGs).

## Key Features

### 1. Intelligent Capture & Isolation
- **Live AR Scanning**: A specialized camera interface with visual guides designed for capturing radiographs from monitors or lightboxes.
- **Auto-OPG Detection**: Uses Genkit-powered AI to identify the dental arch and automatically crop the image for optimal analysis.
- **Silent Fallback**: Resilient capture logic that proceeds with full-frame analysis if isolation fails, ensuring zero friction.

### 2. Clinical Radiograph Analysis
- **Pathology Detection**: Integration with a specialized dental inference engine to detect Decay, Fillings, Root Canal Treatments, and more.
- **Tooth Identification**: Automatically maps findings to specific tooth numbers using FDI notation.

### 3. Interactive Clinical Tutor (Inspection Mode)
- **Interactive Hotspots**: The analyzed radiograph features tapable regions that correspond to detected findings.
- **Pathology Deep Dives**: Powered by Gemini 2.5 Flash, the app provides targeted educational insights, management considerations, and student takeaways for specific findings.
- **Mobile Ergonomics**: A modular UI allows students to tap on individual teeth or finding badges to get bite-sized clinical context without scrolling through long reports.

### 4. Robust AI Performance
- **Rate-Limit Resilience**: Graceful degradation logic handles Gemini API quota limits (429 errors) by providing helpful cooling-down messages while maintaining core dental analysis functionality.
- **Payload Optimization**: Automatic client-side image compression ensures fast uploads and reliable communication with backend services.

## Tech Stack
- **Framework**: Next.js 15 (App Router)
- **AI Engine**: Genkit 1.x with Google Gemini 2.5 Flash
- **UI Components**: Radix UI, Shadcn/UI, Lucide Icons
- **Styling**: Tailwind CSS
- **Database/Auth**: Prepared for Firebase Integration

## Getting Started
1. Ensure your `DENTAL_API_AUTH_TOKEN` is set in your environment variables.
2. Navigate to the **Live AR** tab to capture a radiograph or use the **Upload** tab for existing files.
3. Review findings in the **AI Consult** tab for interactive learning.
