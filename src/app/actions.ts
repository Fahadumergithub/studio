'use server';

import { aiRadiographDetection, type AiRadiographDetectionInput, type AiRadiographDetectionOutput } from '@/ai/flows/ai-radiograph-detection-flow';
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
    return { success: false, error: 'Failed to analyze the radiograph. Please try again later.' };
  }
}
