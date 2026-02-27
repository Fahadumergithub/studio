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
    y: z.number().describe('Normalized y-coordinate of the top-left corner (0.0 to 1.0).'),
    width: z.number().describe('Normalized width (0.0 to 1.0).'),
    height: z.number().describe('Normalized height (0.0 to 1.0).'),
  }).optional().describe('The bounding box of the OPG radiograph if detected.'),
});
export type OpgDetectorOutput = z.infer<typeof OpgDetectorOutputSchema>;

const opgDetectorPrompt = ai.definePrompt({
  name: 'opgDetectorPrompt',
  input: { schema: OpgDetectorInputSchema },
  output: { schema: OpgDetectorOutputSchema },
  prompt: `You are a high-precision "Clinical Cam Scanner". Your sole task is to extract the dental panoramic radiograph (OPG) from the provided image.

CRITICAL PRECISION INSTRUCTIONS:
1. INNER FRAME ONLY: Identify the exact four corners of the clinical X-ray data area. The bounding box should capture ONLY the internal radiograph frame.
2. AGGRESSIVE BACKGROUND PURGE: Explicitly exclude every single pixel of the following:
   - Monitor bezels, plastic frames, or stand bases.
   - Any text appearing OUTSIDE the radiograph film (e.g., patient names in browser headers, Windows/Mac taskbars, hospital logos on monitor corners).
   - Chrome browser tabs, URL bars, or viewing software UI elements.
   - Desk surfaces or room backgrounds.
3. TIGHT CROP: If there is a black border or white text labels at the extreme edges of the film, shrink the bounding box inward to prioritize the dentition and supporting bone.
4. LANDSCAPE PRIORITY: OPGs are naturally landscape. Ensure the bounding box is a wide rectangle.

Image: {{media url=imageDataUri}}`,
  config: {
    temperature: 0,
  }
});

export async function detectOpg(input: OpgDetectorInput): Promise<OpgDetectorOutput> {
  const { output } = await opgDetectorPrompt(input);
  return output!;
}
