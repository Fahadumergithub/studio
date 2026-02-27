'use server';
/**
 * @fileOverview This file implements a Genkit flow for detecting if an image contains a dental OPG
 * and identifying its bounding box for surgical cropping.
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
  }).optional().describe('The tight bounding box of the OPG radiograph if detected.'),
});
export type OpgDetectorOutput = z.infer<typeof OpgDetectorOutputSchema>;

const opgDetectorPrompt = ai.definePrompt({
  name: 'opgDetectorPrompt',
  input: { schema: OpgDetectorInputSchema },
  output: { schema: OpgDetectorOutputSchema },
  prompt: `You are a "Surgical Frame Extractor" for clinical dental imaging. Your sole task is to identify the precise internal boundaries of a dental panoramic radiograph (OPG).

PRECISION EXTRACTION RULES:
1. CLINICAL DATA ONLY: Identify the exact rectangle containing the pink/purple-ish radiograph film data. 
2. ZERO TOLERANCE FOR BACKGROUND: You MUST EXCLUDE the following with 100% precision:
   - Monitor bezels, plastic frames, or desktop wallpaper.
   - Any browser UI, tabs, URL bars, or window minimize/maximize buttons.
   - Hospital logos, patient names, or date text appearing OUTSIDE the film frame.
   - Desks, lightboxes, or room reflections.
3. LANDSCAPE RATIO: OPGs are naturally wide. If the bounding box is not a wide landscape rectangle (width > height), you have likely failed. Re-evaluate to find the wide film frame.
4. TIGHTEST POSSIBLE CROP: Shrink the bounding box inward until it touches only the teeth and jaw structure.

Image: {{media url=imageDataUri}}`,
  config: {
    temperature: 0,
  }
});

export async function detectOpg(input: OpgDetectorInput): Promise<OpgDetectorOutput> {
  const { output } = await opgDetectorPrompt(input);
  return output!;
}
