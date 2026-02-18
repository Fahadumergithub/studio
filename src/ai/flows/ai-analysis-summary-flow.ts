'use server';
/**
 * @fileOverview Provides a Genkit flow for summarizing dental radiograph analysis results.
 *
 * - aiAnalysisSummary - A function that generates a concise textual summary of detected teeth and potential issues.
 * - AiAnalysisSummaryInput - The input type for the aiAnalysisSummary function, containing detection results.
 * - AiAnalysisSummaryOutput - The return type for the aiAnalysisSummary function, containing the textual summary.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

/**
 * Schema for a single detected item from the radiograph analysis.
 */
const DetectionItemSchema = z.object({
  box: z.array(z.number()).length(4).describe('Bounding box coordinates [x1, y1, x2, y2].'),
  class_id: z.number().describe('ID of the detected class.'),
  class_name: z.string().describe('Name of the detected class (e.g., "tooth_1", "decay_area").'),
  score: z.number().describe('Confidence score of the detection.'),
});

/**
 * Input schema for the AI analysis summary flow.
 * It expects an array of detected objects from a dental radiograph analysis.
 */
const AiAnalysisSummaryInputSchema = z.object({
  detections: z.array(DetectionItemSchema).describe('An array of detected objects from the radiograph analysis, including classifications and confidence scores.'),
});
export type AiAnalysisSummaryInput = z.infer<typeof AiAnalysisSummaryInputSchema>;

/**
 * Output schema for the AI analysis summary flow.
 * It returns a concise textual summary of the findings.
 */
const AiAnalysisSummaryOutputSchema = z.object({
  summary: z.string().describe('A concise textual summary of the detected teeth and any identified potential issues.'),
});
export type AiAnalysisSummaryOutput = z.infer<typeof AiAnalysisSummaryOutputSchema>;

/**
 * Defines a Genkit prompt to generate a concise summary of dental radiograph analysis results.
 * The prompt instructs the AI to act as a dental assistant and focus on key findings.
 */
const aiAnalysisSummaryPrompt = ai.definePrompt({
  name: 'aiAnalysisSummaryPrompt',
  input: { schema: AiAnalysisSummaryInputSchema },
  output: { schema: AiAnalysisSummaryOutputSchema },
  prompt: `You are an AI assistant specialized in dental radiograph analysis. Your task is to provide a concise summary of the detected teeth and any potential issues from the provided analysis results.
Focus on key findings relevant to a dental professional.

Analysis Results:
{{#if detections}}
  {{#each detections}}
    - Detected: {{this.class_name}} (Confidence: {{this.score}}) at coordinates [{{this.box.[0]}}, {{this.box.[1]}}, {{this.box.[2]}}, {{this.box.[3]}}]
  {{/each}}
{{else}}
  No specific detections were found.
{{/if}}

Please provide a summary of these findings, highlighting any areas of concern.`,
  config: {
    temperature: 0.2,
  }
});

/**
 * Defines the Genkit flow for generating an AI-powered summary of dental radiograph analysis.
 * It takes detection results as input and returns a textual summary.
 */
const aiAnalysisSummaryFlow = ai.defineFlow(
  {
    name: 'aiAnalysisSummaryFlow',
    inputSchema: AiAnalysisSummaryInputSchema,
    outputSchema: AiAnalysisSummaryOutputSchema,
  },
  async (input) => {
    const { output } = await aiAnalysisSummaryPrompt(input);
    return output!;
  }
);

/**
 * Wrapper function to execute the AI analysis summary flow.
 * @param input The detection results from a dental radiograph analysis.
 * @returns A promise that resolves to a concise textual summary of the findings.
 */
export async function aiAnalysisSummary(input: AiAnalysisSummaryInput): Promise<AiAnalysisSummaryOutput> {
  return aiAnalysisSummaryFlow(input);
}
