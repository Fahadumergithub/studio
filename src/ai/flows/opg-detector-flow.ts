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
  prompt: `You are a specialized dental radiograph identification agent. 
Your primary goal is to find the panoramic dental X-ray (OPG) within the frame and return its bounding box.

Instructions:
1. Identifying OPG: Look for the curved jaw structure showing all teeth. It might be on a computer screen, a film, or a piece of paper.
2. Screen Context: If the OPG is on a monitor, ignore the monitor stand, keyboard, or room background. Focus ONLY on the bright area showing the X-ray content.
3. Flexibility: Even if there are reflections, bezel frames, or it's viewed at an angle, if the panoramic X-ray content is identifiable, set isOpg to true.
4. Bounding Box: Provide the tightest possible bounding box around the X-ray content area itself. 
5. Coordinates: Use normalized [0, 1] coordinates. x and y are the top-left corner. width and height are the dimensions.

Image: {{media url=imageDataUri}}`,
  config: {
    temperature: 0, // Deterministic for better bounding box accuracy
  }
});

export async function detectOpg(input: OpgDetectorInput): Promise<OpgDetectorOutput> {
  const { output } = await opgDetectorPrompt(input);
  return output!;
}
