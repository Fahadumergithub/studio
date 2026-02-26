# How to Call the Dental Analysis API

This document provides the technical details required to make a successful call to the external dental radiograph analysis API.

---

## API Endpoint

The single endpoint for the analysis service is:

- **URL**: `https://services-decay.medentec.com/inference/opg/`
- **Method**: `POST`

---

## Headers

You must include the following headers in your request:

| Header          | Value                       | Description                                                                                              |
| --------------- | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Content-Type`  | `application/json`          | Indicates that the request body is in JSON format.                                                       |
| `Authorization` | `Token <YOUR_API_TOKEN>` | Your authentication token. **Replace `<YOUR_API_TOKEN>`** with the actual secret token provided for the service. |

---

## Request Body

The body of the `POST` request must be a JSON object with the following structure:

```json
{
    "class_list": [1, 5, 4, 8, 3, 7],
    "draw_boxes": true,
    "image": "data:image/jpeg;base64,..."
}
```

### Body Parameters:

- **`class_list`** (Array of integers):
  - A predefined list of numeric identifiers that specify which types of dental issues the AI should look for. The sequence `[1, 5, 4, 8, 3, 7]` is used to detect the standard set of findings.

- **`draw_boxes`** (Boolean):
  - When set to `true`, this instructs the API to return a new image with bounding boxes drawn around the detected areas of interest.

- **`image`** (String):
  - Must be a **Base64 Data URI**.
  - **Format**: `data:<MIME_TYPE>;base64,...`

---

## Integration in DentalVision AR

In this application, the API is integrated via a specialized Genkit flow:

- **File**: `src/ai/flows/ai-radiograph-detection-flow.ts`
- **Server Action**: `runAnalysis` in `src/app/actions.ts`

The application automatically handles client-side image compression to ensure payloads remain within network limits and reduces latency.

---

## Successful Response Body (200 OK)

### Example Response:

```json
{
    "report_html": "<HTML_STRING>...",
    "result_img": "data:image/png;base64,iVBORw0KGgo...",
    "results_df": [
        {
            "disease": "root canal treatment",
            "count": 6,
            "tooth_numbers": ["46", "14", "16", "26", "36", "47"]
        },
        {
            "disease": "Filling",
            "count": 12,
            "tooth_numbers": ["27", "37", "48", "21", "16", "11", "17", "47", "36", "34", "14", "24"]
        }
    ],
    "success": true,
    "unique_id": "66"
}
```

### Response Parameters:

- **`result_img`**: Used to display the analyzed radiograph with clinical overlays.
- **`results_df`**: Parsed into interactive badges and used as context for Gemini-powered clinical tutoring.
- **`success`**: Boolean indicator of successful inference.
