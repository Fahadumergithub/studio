'use server';
/**
 * @fileOverview This file implements a Genkit flow for detecting teeth and issues on dental radiographs
 * by calling an external API.
 *
 * - aiRadiographDetection - A function that handles the dental radiograph detection process.
 * - AiRadiographDetectionInput - The input type for the aiRadiographDetection function.
 * - AiRadiographDetectionOutput - The return type for the aiRadiographDetection function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// Input Schema for the radiograph detection flow
const AiRadiographDetectionInputSchema = z.object({
  radiographDataUri: z
    .string()
    .describe(
      "A dental radiograph image, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type AiRadiographDetectionInput = z.infer<typeof AiRadiographDetectionInputSchema>;

// Schema for an item in the results_df array from the API
const ResultDfItemSchema = z.object({
    disease: z.string(),
    count: z.number(),
    tooth_numbers: z.array(z.string()),
});

// Output Schema for the radiograph detection flow.
const AiRadiographDetectionOutputSchema = z.object({
    processedImage: z.string().describe('The processed image with boxes drawn on it, as a data URI.'),
    results: z.array(ResultDfItemSchema).describe('An array of detected diseases and affected teeth.'),
});
export type AiRadiographDetectionOutput = z.infer<typeof AiRadiographDetectionOutputSchema>;


// Wrapper function to call the Genkit flow
export async function aiRadiographDetection(
  input: AiRadiographDetectionInput
): Promise<AiRadiographDetectionOutput> {
  return aiRadiographDetectionFlow(input);
}

// Define the Genkit flow
const aiRadiographDetectionFlow = ai.defineFlow(
  {
    name: 'aiRadiographDetectionFlow',
    inputSchema: AiRadiographDetectionInputSchema,
    outputSchema: AiRadiographDetectionOutputSchema,
  },
  async (input) => {
    const apiUrl = 'https://services-decay.medentec.com/inference/opg/';
    const classList = [1, 5, 4, 8, 3, 7];

    const authorizationToken = process.env.DENTAL_API_AUTH_TOKEN;

    if (!authorizationToken) {
      throw new Error('DENTAL_API_AUTH_TOKEN environment variable is not set.');
    }
    
    if (!input.radiographDataUri || !input.radiographDataUri.includes(',')) {
        throw new Error('Invalid radiograph data URI format. Expected format: data:<mimetype>;base64,<encoded_data>');
    }

    const requestBody = {
      class_list: classList,
      draw_boxes: true, // Get the image with boxes drawn on it
      image: input.radiographDataUri,
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${authorizationToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`External API Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const apiResponse = await response.json();
    
    if (!apiResponse.result_img || !apiResponse.results_df) {
      throw new Error(
        `API response is missing 'result_img' or 'results_df'. Full response: ${JSON.stringify(apiResponse)}`
      );
    }
    
    // The API returns a base64 string, ensure it's a valid data URI
    const processedImageUri = apiResponse.result_img.startsWith('data:image')
      ? apiResponse.result_img
      : `data:image/jpeg;base64,${apiResponse.result_img}`;

    const parsedResults = z.array(ResultDfItemSchema).safeParse(apiResponse.results_df);

    if (!parsedResults.success) {
        throw new Error(
          `API 'results_df' field has an unexpected format. Full response: ${JSON.stringify(apiResponse)}`
        );
    }

    return {
      processedImage: processedImageUri,
      results: parsedResults.data,
    };
  }
);
