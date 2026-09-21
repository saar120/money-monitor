import type { Transaction } from '../../shared/types.js';

export interface CategorizationCategory {
  name: string;
  label: string;
  rules: string | null;
  ignoredFromStats: boolean;
}

export interface CategorizationPrediction {
  id: number;
  category: string;
  confidence?: number;
  reviewReason?: string;
}

export interface CategorizationInput {
  transactions: Transaction[];
  categories: CategorizationCategory[];
}

export type CategorizationAdapter = (
  input: CategorizationInput,
) => Promise<CategorizationPrediction[]>;
