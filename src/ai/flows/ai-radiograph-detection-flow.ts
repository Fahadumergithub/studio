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

// Schema for a single detected item, to be included in the output.
const DetectionItemSchema = z.object({
  box: z.array(z.number()).length(4).describe('Bounding box coordinates [x1, y1, x2, y2].'),
  class_id: z.number().describe('ID of the detected class.'),
  class_name: z.string().describe('Name of the detected class (e.g., "tooth_1", "decay_area").'),
  score: z.number().describe('Confidence score of the detection.'),
});

// Output Schema for the radiograph detection flow
const AiRadiographDetectionOutputSchema = z.object({
  processedRadiographDataUri: z
    .string()
    .describe(
      "The processed dental radiograph image with detections highlighted, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  detections: z.array(DetectionItemSchema).describe('An array of detected objects from the radiograph analysis.'),
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
    const classList = [1, 5, 4, 8, 3, 7]; // Fixed class list as per request

    const authorizationToken = process.env.DENTAL_API_AUTH_TOKEN; // Get token from environment variable

    if (!authorizationToken) {
      throw new Error('DENTAL_API_AUTH_TOKEN environment variable is not set.');
    }
    
    if (!input.radiographDataUri || !input.radiographDataUri.includes(',')) {
        throw new Error('Invalid radiograph data URI format. Expected format: data:<mimetype>;base64,<encoded_data>');
    }

    const requestBody = {
      class_list: classList,
      draw_boxes: true,
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
      // Throw the raw error from the API to be displayed on the frontend
      throw new Error(`External API Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const apiResponse = await response.json();
    console.log('External API Response:', JSON.stringify(apiResponse, null, 2));

    if (!apiResponse || typeof apiResponse.result_img !== 'string' || apiResponse.result_img.trim() === '') {
      // Throw an error including the full API response if the expected field is missing
      throw new Error(
        `API response did not contain "result_img". Full response: ${JSON.stringify(apiResponse)}`
      );
    }
    
    // The Postman response contains 'results_df' not 'detections'. Let's adapt.
    // The summary flow expects 'detections' with 'class_name'. 'results_df' has 'disease'.
    // We will map 'disease' to 'class_name' and provide dummy values for other fields.
    const detections = (apiResponse.results_df && Array.isArray(apiResponse.results_df)) ? apiResponse.results_df.map((item: any) => ({
        box: [0, 0, 0, 0],
        class_id: 0,
        class_name: item.disease || 'unknown',
        score: item.score || 0 // score is not in results_df, default to 0
    })) : [];
    
    const processedRadiographDataUri = apiResponse.result_img;

    return {
      processedRadiographDataUri: processedRadiographDataUri,
      detections: detections,
    };
  }
);
