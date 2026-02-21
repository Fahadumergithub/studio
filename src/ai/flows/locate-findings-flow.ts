'use server';
/**
 * @fileOverview Provides a Genkit flow for locating dental findings on a radiograph image.
 *
 * - locateFindings - A function that takes a radiograph and a list of findings and returns bounding box coordinates for each.
 * - LocateFindingsInput - The input type for the locateFindings function.
 * - LocateFindingsOutput - The return type for the locateFindingsOutput function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';

const ResultItemSchema = z.object({
  disease: z.string(),
  count: z.number(),
  tooth_numbers: z.array(z.string()),
});

const LocateFindingsInputSchema = z.object({
  processedRadiographDataUri: z.string().describe('The processed radiograph image with bounding boxes as a data URI.'),
  findings: z.array(ResultItemSchema).describe('The list of findings from the initial analysis.'),
});
export type LocateFindingsInput = z.infer<typeof LocateFindingsInputSchema>;

const HotspotSchema = z.object({
  disease: z.string(),
  tooth_numbers: z.array(z.string()),
  box: z.array(z.number()).length(4).describe('Normalized bounding box coordinates as [x_min, y_min, x_max, y_max].'),
});

const LocateFindingsOutputSchema = z.object({
  hotspots: z.array(HotspotSchema),
});
export type LocateFindingsOutput = z.infer<typeof LocateFindingsOutputSchema>;

const locateFindingsPrompt = ai.definePrompt({
  name: 'locateFindingsPrompt',
  input: { schema: LocateFindingsInputSchema },
  output: { schema: LocateFindingsOutputSchema },
  prompt: `You are a specialist AI assistant for dental radiographs. You will be provided with a dental radiograph image that already has findings highlighted with bounding boxes. You will also be provided with a list of the dental findings that correspond to those boxes.

Your task is to analyze the image and identify the bounding box for each finding in the list.

The input image is: {{media url=processedRadiographDataUri}}

The findings are:
{{#each findings}}
- Disease: {{this.disease}}, Count: {{this.count}}, Tooth Numbers: {{#each this.tooth_numbers}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
{{/each}}

For every finding in the input list, you must return the normalized coordinates [x_min, y_min, x_max, y_max] for the corresponding box in the image.

IMPORTANT: The output must be a JSON object that adheres to the provided Zod schema. The 'box' coordinates must be normalized (0.0 to 1.0). Ensure you return a bounding box for every finding provided in the input.`,
  config: {
    temperature: 0.1,
  },
});

const locateFindingsFlow = ai.defineFlow(
  {
    name: 'locateFindingsFlow',
    inputSchema: LocateFindingsInputSchema,
    outputSchema: LocateFindingsOutputSchema,
  },
  async (input) => {
    const { output } = await locateFindingsPrompt(input);
    return output!;
  }
);

export async function locateFindings(input: LocateFindingsInput): Promise<LocateFindingsOutput> {
  return locateFindingsFlow(input);
}
