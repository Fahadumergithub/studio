'use server';

import { aiRadiographDetection, type AiRadiographDetectionInput, type AiRadiographDetectionOutput } from '@/ai/flows/ai-radiograph-detection-flow';
import { aiAnalysisSummary, type AiAnalysisSummaryInput, type AiAnalysisSummaryOutput } from '@/ai/flows/ai-analysis-summary-flow';
import { detectOpg, type OpgDetectorInput, type OpgDetectorOutput } from '@/ai/flows/opg-detector-flow';
import { radiographTutor, type RadiographTutorInput, type RadiographTutorOutput } from '@/ai/flows/radiograph-tutor-flow';
import { locateFindings, type LocateFindingsInput, type LocateFindingsOutput } from '@/ai/flows/locate-findings-flow';
import { z } from 'zod';

const runAnalysisSchema = z.object({
  radiographDataUri: z.string().startsWith('data:image/'),
});

type AnalysisResult = {
  success: true;
  data: AiRadiographDetectionOutput;
} | {
  success: false;
  error: string;
};

export async function runAnalysis(input: AiRadiographDetectionInput): Promise<AnalysisResult> {
  const validation = runAnalysisSchema.safeParse(input);

  if (!validation.success) {
    return { success: false, error: 'Invalid image data format.' };
  }

  const token = process.env.DENTAL_API_AUTH_TOKEN;
  if (!token) {
    console.error('CRITICAL: DENTAL_API_AUTH_TOKEN is not set in environment variables.');
    return { success: false, error: 'Server Configuration Error: The clinical analysis token is missing.' };
  }

  try {
    console.log('Initiating radiograph analysis flow...');
    const result = await aiRadiographDetection(validation.data);
    return { success: true, data: result };
  } catch (e: any) {
    console.error('Error during radiograph analysis:', e.message);
    return { success: false, error: e.message || 'An unexpected error occurred during clinical analysis.' };
  }
}

export async function runOpgDetection(input: OpgDetectorInput): Promise<OpgDetectorOutput> {
  try {
    return await detectOpg(input);
  } catch (e: any) {
    console.error('Error in OPG detection flow:', e.message);
    // If rate limited, return a fallback object
    if (e.message?.includes('429') || e.message?.includes('RESOURCE_EXHAUSTED')) {
      return { isOpg: false, confidence: 0 };
    }
    throw e;
  }
}

export async function getClinicalInsights(input: RadiographTutorInput): Promise<RadiographTutorOutput | null> {
  try {
    return await radiographTutor(input);
  } catch (e: any) {
    console.warn('Gemini Rate Limit or Quota Error in clinical insights:', e.message);
    // Return null instead of throwing to avoid breaking the client experience
    return null;
  }
}

export async function getFindingLocations(input: LocateFindingsInput): Promise<LocateFindingsOutput | null> {
  try {
    return await locateFindings(input);
  } catch (e: any) {
    console.warn('Gemini Rate Limit or Quota Error in finding locations:', e.message);
    // Return null instead of throwing
    return null;
  }
}

const ResultItemSchema = z.object({
    disease: z.string(),
    count: z.number(),
    tooth_numbers: z.array(z.string()),
});

const getSummarySchema = z.object({
  results: z.array(ResultItemSchema),
});

type SummaryResult = {
  success: true;
  data: AiAnalysisSummaryOutput;
} | {
  success: false;
  error: string;
};

export async function getAnalysisSummary(input: AiAnalysisSummaryInput): Promise<SummaryResult> {
  const validation = getSummarySchema.safeParse(input);
  if (!validation.success) {
    return { success: false, error: 'Invalid input for summary generation.' };
  }
  try {
    const result = await aiAnalysisSummary(validation.data);
    return { success: true, data: result };
  } catch (e: any) {
    console.error('Error during summary generation:', e.message);
    return { success: false, error: 'Failed to generate summary.' };
  }
}
