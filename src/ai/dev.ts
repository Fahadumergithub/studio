'use server';
import { config } from 'dotenv';
config();

import '@/ai/flows/ai-analysis-summary-flow.ts';
import '@/ai/flows/ai-radiograph-detection-flow.ts';
import '@/ai/flows/opg-detector-flow.ts';
import '@/ai/flows/radiograph-tutor-flow.ts';
