'use server';

import { aiRadiographDetection, type AiRadiographDetectionInput, type AiRadiographDetectionOutput } from '@/ai/flows/ai-radiograph-detection-flow';
import { aiAnalysisSummary, type AiAnalysisSummaryInput, type AiAnalysisSummaryOutput } from '@/ai/flows/ai-analysis-summary-flow';
import { detectOpg, type OpgDetectorInput, type OpgDetectorOutput } from '@/ai/flows/opg-detector-flow';
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
    return { success: false, error: 'Invalid input data.' };
  }

  if (!process.env.DENTAL_API_AUTH_TOKEN) {
    console.error('DENTAL_API_AUTH_TOKEN is not set in environment variables.');
    return { success: false, error: 'Server configuration error: Missing API token.' };
  }

  try {
    const result = await aiRadiographDetection(validation.data);
    return { success: true, data: result };
  } catch (e) {
    const error = e as Error;
    console.error('Error during radiograph analysis:', error);
    return { success: false, error: error.message };
  }
}

export async function runOpgDetection(input: OpgDetectorInput): Promise<OpgDetectorOutput> {
  return detectOpg(input);
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
  } catch (e) {
    const error = e as Error;
    console.error('Error during summary generation:', error);
    return { success: false, error: 'Failed to generate summary.' };
  }
}
