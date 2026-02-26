# Agent Interaction Rules for DentalVision AR

To maintain stability and ensure a mobile-first evolution, the following rules apply to the AI Prototyper:

## 1. Localized Development
- Do not modify multiple application tabs (Upload, Live AR, Consult) in a single turn.
- Focus exclusively on the feature or tab currently under discussion.

## 2. Consent-Based Implementation
- Before applying changes to UI components or complex logic, the agent must propose the plan in natural language.
- XML changes should only be provided after user confirmation for that specific step.

## 3. Implementation Standards
- Always provide the full, final content of any file being modified within the `<changes>` XML block.
- Maintain mobile-first ergonomics (large touch targets, minimal scrolling, dense but readable layouts).

## 4. Feature Checkpoint (Latest)
- **Upload Tab**: Features a staged "Run Analysis" confirmation and a high-fidelity AI loading overlay.
- **Live AR Tab**: Features clinical scanning guides, a premium full-screen scanning overlay, and a high-accuracy isolation engine that strips background clutter (monitor bezels/text). Results are displayed "in-situ" within the tab using a landscape aspect ratio. Navigation to the deep-dive tutor is user-triggered.
- **Consult Tab**: Features interactive hotspots and a modular AI Tutor that provides specific deep-dives upon tapping findings. Includes landscape-locked visualization for panoramic accuracy.

## 5. Technical Constraints
- **Hydration Resilience**: All client components must use an `isMounted` check or `useEffect` to avoid SSR mismatches on dynamic values (like Tab IDs).
- **Payload Safety**: Images are compressed and resized (max 1200px) client-side to prevent server timeouts and "Load Failed" errors on mobile networks.
