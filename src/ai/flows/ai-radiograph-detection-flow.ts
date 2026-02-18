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

// Output Schema for the radiograph detection flow
// Assuming the external API returns the processed image as a data URI
// and optionally, structured detection data.
const AiRadiographDetectionOutputSchema = z.object({
  processedRadiographDataUri: z
    .string()
    .describe(
      "The processed dental radiograph image with detections highlighted, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  // Future enhancement: If the external API provides structured detection data (e.g., bounding box coordinates, class labels)
  // in addition to the processed image, this schema could be extended to include it for more advanced AR visualizations.
  // For the current request focusing on visual highlighting on the image, the processed data URI is sufficient.
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

    const requestBody = {
      class_list: classList,
      draw_boxes: true,
      image: input.radiographDataUri,
    };

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authorizationToken}`, // Assuming Bearer token
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `External API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const apiResponse = await response.json();

      // The user description states "Overlay detection results (bounding boxes, classifications)"
      // "onto the original radiograph for clear visualization." and "visually highlight teeth".
      // This strongly suggests the API returns an image already processed with detections.
      // We assume the API response contains a field named 'processed_image' (or similar)
      // that holds the data URI of this processed image.
      // This field name should be confirmed by the actual API documentation.
      if (!apiResponse || typeof apiResponse.processed_image !== 'string') {
        throw new Error('External API response did not contain a valid processed image data URI in the "processed_image" field.');
      }

      return {
        processedRadiographDataUri: apiResponse.processed_image,
      };
    } catch (error) {
      console.error('Error calling external radiograph detection API:', error);
      throw new Error(`Failed to process radiograph: ${(error as Error).message}`);
    }
  }
);
