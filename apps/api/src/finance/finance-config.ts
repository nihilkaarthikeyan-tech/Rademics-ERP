import { DEFAULT_BUSINESS_RULES } from '@rademics/types';

/** Finance-relevant Admin Settings (Spec §4, §23), merged over the §4 seed defaults. */
export interface FinanceConfig {
  currency: string;
  defaultGstPercent: number;
  paymentTermsDays: number;
  paymentModes: string[];
  expenseCategories: string[];
  hourlyCostRates: Record<string, number>;
  standardWorkdayHours: number;
  invoiceFooterText: string;
  companyName: string;
  companyAddress: string;
  companyGstin: string;
  brandPrimary: string;
  brandAccent: string;
  workingDays: number[];
  threeLatesDeduction: { lateCount: number; halfDayDeduction: number };
}

const D = DEFAULT_BUSINESS_RULES;

export function toFinanceConfig(rules: Record<string, unknown>): FinanceConfig {
  const pick = <T>(key: keyof typeof D, val: unknown): T => (val ?? D[key]) as T;
  return {
    currency: pick('currency', rules.currency),
    defaultGstPercent: pick('defaultGstPercent', rules.defaultGstPercent),
    paymentTermsDays: pick('paymentTermsDays', rules.paymentTermsDays),
    paymentModes: pick('paymentModes', rules.paymentModes),
    expenseCategories: pick('expenseCategories', rules.expenseCategories),
    hourlyCostRates: { ...D.hourlyCostRates, ...((rules.hourlyCostRates as object) ?? {}) },
    standardWorkdayHours: pick('standardWorkdayHours', rules.standardWorkdayHours),
    invoiceFooterText: pick('invoiceFooterText', rules.invoiceFooterText),
    companyName: pick('companyName', rules.companyName),
    companyAddress: pick('companyAddress', rules.companyAddress),
    companyGstin: pick('companyGstin', rules.companyGstin),
    brandPrimary: pick('brandPrimary', rules.brandPrimary),
    brandAccent: pick('brandAccent', rules.brandAccent),
    workingDays: pick('workingDays', rules.workingDays),
    threeLatesDeduction: pick('threeLatesDeduction', rules.threeLatesDeduction),
  };
}
