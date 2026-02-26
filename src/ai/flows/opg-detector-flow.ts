'use server';
/**
 * @fileOverview This file implements a Genkit flow for detecting if an image contains a dental OPG
 * and identifying its bounding box for cropping.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const OpgDetectorInputSchema = z.object({
  imageDataUri: z
    .string()
    .describe(
      "The image to check, as a data URI. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type OpgDetectorInput = z.infer<typeof OpgDetectorInputSchema>;

const OpgDetectorOutputSchema = z.object({
  isOpg: z.boolean().describe('Whether a dental OPG (panoramic) radiograph is clearly visible in the image.'),
  confidence: z.number().describe('Confidence score from 0 to 1.'),
  boundingBox: z.object({
    x: z.number().describe('Normalized x-coordinate of the top-left corner (0.0 to 1.0).'),
    y: z.number().describe('Normalized x-coordinate of the top-left corner (0.0 to 1.0).'),
    width: z.number().describe('Normalized width (0.0 to 1.0).'),
    height: z.number().describe('Normalized height (0.0 to 1.0).'),
  }).optional().describe('The bounding box of the OPG radiograph if detected.'),
});
export type OpgDetectorOutput = z.infer<typeof OpgDetectorOutputSchema>;

const opgDetectorPrompt = ai.definePrompt({
  name: 'opgDetectorPrompt',
  input: { schema: OpgDetectorInputSchema },
  output: { schema: OpgDetectorOutputSchema },
  prompt: `You are a specialized clinical imaging assistant. Your task is to locate the dental panoramic radiograph (OPG) within the provided frame.

Look for the characteristic 'horseshoe' or 'u-shaped' structure of the mandible and maxilla. The OPG contains the full dentition, roots, and surrounding bone.

Instructions:
1. Precision: Identify the exact boundaries of the clinical radiograph frame. Focus strictly on the X-ray data area.
2. Background Rejection: Explicitly ignore monitor bezels, room backgrounds, reflections, and any text or labels (patient names, dates, hospital logos) that appear outside the actual radiograph film or digital frame.
3. Landscape Priority: OPGs are naturally landscape. Ensure the bounding box captures the full width from left to right condyle/wisdom tooth area.
4. Stability: Ensure the bounding box is tight. If the jaw is clearly identifiable, set isOpg to true.

Image: {{media url=imageDataUri}}`,
  config: {
    temperature: 0,
  }
});

export async function detectOpg(input: OpgDetectorInput): Promise<OpgDetectorOutput> {
  const { output } = await opgDetectorPrompt(input);
  return output!;
}
