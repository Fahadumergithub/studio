'use server';
import { config } from 'dotenv';
config();

import '@/ai/flows/ai-analysis-summary-flow.ts';
import '@/ai/flows/ai-radiograph-detection-flow.ts';
import '@/ai/flows/locate-findings-flow.ts';
