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
  prompt: `You are a specialized "Cam Scanner" clinical imaging assistant. Your task is to extract the dental panoramic radiograph (OPG) from the provided image.

Think like a document scanner: Identify the exact four corners of the clinical radiograph frame.

CRITICAL INSTRUCTIONS FOR SCANNER PRECISION:
1. FOCUS ON CLINICAL DATA: Identify the exact boundaries of the clinical radiograph frame. The bounding box should capture ONLY the X-ray data area.
2. AGGRESSIVE BACKGROUND REJECTION: Explicitly ignore and exclude the following "Negative Features":
   - Monitor bezels, plastic lightbox frames, or desk surfaces.
   - Background text, patient names, dates, or hospital logos appearing outside the radiograph frame.
   - Browser tabs, Windows/Mac menu bars, or viewing software UI elements (e.g., "Preview", "File", "Edit" menus).
   - Reflections on the monitor glass.
3. LANDSCAPE PRIORITY: OPGs are naturally landscape. Ensure the bounding box captures the full width from left to right condyle.
4. TIGHT INNER CROP: If there is a black border or text labels at the extreme edges of the film, shrink the bounding box inward to prioritize the dentition and supporting bone.

Image: {{media url=imageDataUri}}`,
  config: {
    temperature: 0,
  }
});

export async function detectOpg(input: OpgDetectorInput): Promise<OpgDetectorOutput> {
  const { output } = await opgDetectorPrompt(input);
  return output!;
}
