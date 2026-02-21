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
 * Schema for a single item from the analysis' results_df array.
 */
const ResultItemSchema = z.object({
    disease: z.string().describe('The name of the disease or finding (e.g., "decay", "Filling").'),
    count: z.number().describe('The number of teeth affected.'),
    tooth_numbers: z.array(z.string()).describe('A list of the affected tooth numbers.'),
});


/**
 * Input schema for the AI analysis summary flow.
 * It expects an array of detected objects from a dental radiograph analysis.
 */
const AiAnalysisSummaryInputSchema = z.object({
  results: z.array(ResultItemSchema).describe("An array of detected diseases and findings from the radiograph analysis's results_df field."),
});
export type AiAnalysisSummaryInput = z.infer<typeof AiAnalysisSummaryInputSchema>;

/**
 * Output schema for the AI analysis summary flow.
 * It returns a concise textual summary of the findings.
 */
const AiAnalysisSummaryOutputSchema = z.object({
  summary: z.string().describe('A concise textual summary of the detected diseases, findings, and affected teeth.'),
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
  prompt: `You are an AI dental assistant. Your task is to provide a clear and concise summary of the following dental radiograph analysis.
Group the findings by category (Diseases Identified, Findings Observed, Existing Dental Work). For each item, list the name, the count, and the specific tooth numbers involved.

Analysis Results:
{{#if results}}
  {{#each results}}
    - {{this.disease}}: {{this.count}} tooth/teeth affected ({{#each this.tooth_numbers}}{{this}}{{#unless @last}}, {{/unless}}{{/each}})
  {{/each}}
{{else}}
  No specific findings were provided in the analysis results.
{{/if}}

Please provide a human-readable summary based on these findings.`,
  config: {
    temperature: 0.3,
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
