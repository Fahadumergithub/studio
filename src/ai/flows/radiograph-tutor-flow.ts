'use server';
/**
 * @fileOverview Provides a Genkit flow for clinical tutoring on dental radiographs.
 *
 * - radiographTutor - A function that provides educational insights based on an image and detection results.
 * - RadiographTutorInput - The input type for the radiographTutor function.
 * - RadiographTutorOutput - The return type for the radiographTutor function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const DetectionSchema = z.object({
  disease: z.string().describe('The identified condition.'),
  count: z.number().describe('Number of instances.'),
  tooth_numbers: z.array(z.string()).describe('Affected teeth.'),
});

const RadiographTutorInputSchema = z.object({
  originalImageDataUri: z.string().describe('The original radiograph image as a data URI.'),
  detections: z.array(DetectionSchema).describe('The initial analysis findings.'),
});
export type RadiographTutorInput = z.infer<typeof RadiographTutorInputSchema>;

const RadiographTutorOutputSchema = z.object({
  clinicalOverview: z.string().describe('An educational overview of the findings.'),
  pathologyExplanation: z.array(z.object({
    condition: z.string(),
    significance: z.string().describe('Why this finding is important in this context.'),
    considerations: z.string().describe('General clinical considerations or next steps.'),
  })),
  studentTakeaway: z.string().describe('A key learning point for dental students.'),
});
export type RadiographTutorOutput = z.infer<typeof RadiographTutorOutputSchema>;

const radiographTutorPrompt = ai.definePrompt({
  name: 'radiographTutorPrompt',
  input: { schema: RadiographTutorInputSchema },
  output: { schema: RadiographTutorOutputSchema },
  prompt: `You are an expert Clinical Dental Educator. You have been provided with a dental radiograph and a set of initial detections.

Your goal is to provide a deep educational breakdown of these findings to help a clinician or student understand the clinical picture.

Radiograph: {{media url=originalImageDataUri}}

Initial Detections:
{{#each detections}}
- {{this.disease}} found in {{this.count}} location(s) involving teeth: {{#each this.tooth_numbers}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
{{/each}}

Based on the image and these findings, provide:
1. A Clinical Overview: Summarize the overall oral health status visible.
2. Pathology Explanations: For each detected condition, explain its radiographic appearance, clinical significance, and general management considerations.
3. Student Takeaway: Provide a specific "pro-tip" or learning point related to these specific findings.

Maintain a professional, educational, and helpful tone.`,
});

const radiographTutorFlow = ai.defineFlow(
  {
    name: 'radiographTutorFlow',
    inputSchema: RadiographTutorInputSchema,
    outputSchema: RadiographTutorOutputSchema,
  },
  async (input) => {
    const { output } = await radiographTutorPrompt(input);
    return output!;
  }
);

export async function radiographTutor(input: RadiographTutorInput): Promise<RadiographTutorOutput> {
  return radiographTutorFlow(input);
}
