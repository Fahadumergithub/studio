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

// Output Schema for the radiograph detection flow. Now only returns detection data with coordinates.
const AiRadiographDetectionOutputSchema = z.object({
  detections: z.array(DetectionItemSchema).describe('An array of detected objects from the radiograph analysis, including coordinates.'),
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

    // Requesting raw detection data with coordinates instead of a pre-rendered image.
    const requestBody = {
      class_list: classList,
      draw_boxes: false, // Set to false to get coordinates
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
    console.log('External API Response:', JSON.stringify(apiResponse, null, 2));

    // Assuming the API returns a 'detections' field that matches our schema when draw_boxes is false.
    // The previous 'results_df' was a summary, not a list of detections with coordinates.
    if (!apiResponse || !Array.isArray(apiResponse.detections)) {
      // Throw an error including the full API response if the expected field is missing
      throw new Error(
        `API response did not contain a 'detections' array. This is needed for the AR experience. Full response: ${JSON.stringify(apiResponse)}`
      );
    }
    
    // The API might return a different structure. We'll parse it and ensure it fits our schema.
    // This is a safer way to handle external API data.
    const parsedDetections = z.array(DetectionItemSchema).safeParse(apiResponse.detections);

    if (!parsedDetections.success) {
      throw new Error(
        `API 'detections' field has an unexpected format. Full response: ${JSON.stringify(apiResponse)}`
      );
    }
    
    return {
      detections: parsedDetections.data,
    };
  }
);
