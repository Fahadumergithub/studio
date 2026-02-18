# **App Name**: DentalVision AR

## Core Features:

- Image Upload: Allow users to upload dental radiographs for analysis.
- Base64 Conversion: Convert the image data into a Base64-encoded string for API submission.
- API Request: Send the Base64 encoded image data to the external API (https://services-decay.medentec.com/inference/opg/) with required headers (Authorization, Content-Type: application/json) and body parameters (class_list: [1, 5, 4, 8, 3, 7], draw_boxes: true, image: <Base64 string>).
- AI-Powered Teeth Detection: Leverage the external API to detect teeth and identify potential issues on the radiograph using the AI model behind the tool.
- Overlay Detection Results: Overlay the detection results (bounding boxes, classifications) onto the original radiograph for clear visualization.
- Augmented Reality Visualization: Visualize dental structures and detection results in an augmented reality environment, using AR to view the radiographic findings.

## Style Guidelines:

- Primary color: Deep teal (#008080) to represent the fusion of technology and healthcare.
- Background color: Soft, desaturated teal (#E0F8F8) for a calming and professional feel.
- Accent color: Light beige (#F5F5DC) to provide a subtle contrast and highlight key interactive elements.
- Body and headline font: 'Inter' for a modern, neutral, and readable interface.
- Use simple, clean icons to represent different functionalities and ensure clarity.
- A clean and intuitive layout with a focus on easy navigation.
- Subtle animations for feedback, like loading indicators or transitions between views.