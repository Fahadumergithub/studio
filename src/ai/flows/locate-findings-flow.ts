'use server';
/**
 * @fileOverview Provides a Genkit flow for locating dental findings on a radiograph image.
 *
 * - locateFindings - A function that takes a radiograph and a list of findings and returns bounding box coordinates for each.
 * - LocateFindingsInput - The input type for the locateFindings function.
 * - LocateFindingsOutput - The return type for the locateFindings function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const ResultItemSchema = z.object({
  disease: z.string(),
  count: z.number(),
  tooth_numbers: z.array(z.string()),
});

const LocateFindingsInputSchema = z.object({
  radiographDataUri: z.string().describe('The original radiograph image as a data URI.'),
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
  prompt: `You are a specialist AI assistant for dental radiographs. You will be provided with a dental radiograph image and a list of dental findings.

Your task is to analyze the image and locate each finding. For every finding in the input list, you must return a bounding box that precisely outlines the area of that specific finding on the corresponding tooth.

The input image is: {{media url=radiographDataUri}}

The findings are:
{{#each findings}}
- Disease: {{this.disease}}, Count: {{this.count}}, Tooth Numbers: {{#each this.tooth_numbers}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
{{/each}}

IMPORTANT: The output must be a JSON object that adheres to the provided Zod schema. The 'box' coordinates (x_min, y_min, x_max, y_max) must be normalized, ranging from 0.0 to 1.0, relative to the image dimensions. Ensure you return a bounding box for every finding provided in the input.`,
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
