'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const AiRadiographDetectionInputSchema = z.object({
  radiographDataUri: z.string(),
});
export type AiRadiographDetectionInput = z.infer<typeof AiRadiographDetectionInputSchema>;

const ResultDfItemSchema = z.object({
    disease: z.string(),
    count: z.number(),
    tooth_numbers: z.array(z.string()),
});

const AiRadiographDetectionOutputSchema = z.object({
    processedImage: z.string(),
    results: z.array(ResultDfItemSchema),
});
export type AiRadiographDetectionOutput = z.infer<typeof AiRadiographDetectionOutputSchema>;

export async function aiRadiographDetection(
  input: AiRadiographDetectionInput
): Promise<AiRadiographDetectionOutput> {
  return aiRadiographDetectionFlow(input);
}

const aiRadiographDetectionFlow = ai.defineFlow(
  {
    name: 'aiRadiographDetectionFlow',
    inputSchema: AiRadiographDetectionInputSchema,
    outputSchema: AiRadiographDetectionOutputSchema,
  },
  async (input) => {
    const apiUrl = 'https://services-decay.medentec.com/inference/opg/';
    const classList = [1, 5, 4, 8, 3, 7];
    const token = process.env.DENTAL_API_AUTH_TOKEN;

    if (!token) {
      throw new Error('Server Environment Error: Clinical API token is not configured.');
    }
    
    if (!input.radiographDataUri || !input.radiographDataUri.includes('base64,')) {
        throw new Error('Invalid image format. Expected a base64 Data URI.');
    }

    const requestBody = {
      class_list: classList,
      draw_boxes: true,
      image: input.radiographDataUri,
    };

    let response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${token}`,
        },
        body: JSON.stringify(requestBody),
      });
    } catch (fetchError: any) {
      throw new Error(`Connection Error: Unable to reach the clinical analysis server. ${fetchError.message}`);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No additional error details.');
      throw new Error(`Clinical Server Error (${response.status}): ${errorText}`);
    }

    let apiResponse;
    try {
      apiResponse = await response.json();
    } catch (jsonError) {
      throw new Error('Malformed Response: The clinical server returned an invalid data format.');
    }
    
    if (!apiResponse.result_img || !apiResponse.results_df) {
      throw new Error('Incomplete Results: The clinical server did not return the expected analysis data.');
    }
    
    const processedImageUri = apiResponse.result_img.startsWith('data:image')
      ? apiResponse.result_img
      : `data:image/jpeg;base64,${apiResponse.result_img}`;

    const parsedResults = z.array(ResultDfItemSchema).safeParse(apiResponse.results_df);

    if (!parsedResults.success) {
        throw new Error('Format Error: The analysis findings returned by the server are in an unexpected format.');
    }

    return {
      processedImage: processedImageUri,
      results: parsedResults.data,
    };
  }
);
