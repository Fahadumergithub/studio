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
  - If set to `false`, the API may return coordinate data instead of a processed image (this behavior would need to be tested).

- **`image`** (String):
  - This is the most critical part of the request. The image must be encoded as a **Base64 Data URI**.
  - **Format**: The string must be prefixed with `data:<MIME_TYPE>;base64,`, where `<MIME_TYPE>` is the image type (e.g., `image/jpeg`, `image/png`).
  - **Example**: `data:image/jpeg;base64,/9j/4AAQSk...`

---

## Successful Response Body (200 OK)

If the request is successful, the API will respond with a JSON object containing the analysis results.

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

- **`report_html`** (String):
  - An HTML string that contains a formatted summary report of the findings. This is not currently used in the web app but is available.

- **`result_img`** (String):
  - A Base64 Data URI of the processed image with bounding boxes drawn on it. This string can be used directly as the `src` for an `<img>` tag in HTML to display the result.

- **`results_df`** (Array of Objects):
  - The structured data of the findings. Each object in the array represents a type of issue found and contains:
    - `disease` (String): The name of the finding (e.g., "decay", "Filling").
    - `count` (Integer): The number of instances of this finding.
    - `tooth_numbers` (Array of Strings): A list of the specific tooth numbers (using FDI notation) where the issue was detected.

- **`success`** (Boolean):
  - Will be `true` if the analysis was successful.

- **`unique_id`** (String):
  - A unique identifier for the analysis job.
