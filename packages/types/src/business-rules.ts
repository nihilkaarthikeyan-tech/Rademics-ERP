/**
 * Global Business Rules & Default Values — Spec §4.
 *
 * Every value here must be editable by Super Admin (and HR where noted) in Admin
 * Settings, WITHOUT a code change (§4). These constants are only the SEED defaults;
 * the running system reads them from the Settings store. Never hardcode against
 * these at a call site — read the setting.
 *
 * `[ASSUMED]` marks a default awaiting management sign-off (§15).
 */

export const ConfigurableBy = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  HR: 'HR',
  FINANCE: 'FINANCE',
  CLIENT: 'CLIENT',
  NONE: 'NONE',
} as const;

export type ConfigurableBy = (typeof ConfigurableBy)[keyof typeof ConfigurableBy];

export const DEFAULT_BUSINESS_RULES = {
  // Working time
  workingDays: [1, 2, 3, 4, 5, 6], // Mon–Sat, Sunday off [ASSUMED]
  workStart: '09:00', // 9:00 AM IST [ASSUMED]
  workEnd: '18:00', // 6:00 PM IST [ASSUMED]
  lateThreshold: '09:15', // check-in after = Late [ASSUMED]
  halfDayUnderHours: 4, // worked < 4h = half day [ASSUMED]
  overtimeOverHours: 9, // worked > 9h = overtime [ASSUMED]
  idleMinutes: 5, // no heartbeat 5 min = idle; per-role override allowed
  threeLatesDeduction: { lateCount: 3, halfDayDeduction: 1 }, // 3 lates/month = 1 half-day [ASSUMED]

  // Leave quotas (§4) [ASSUMED]
  leave: {
    casual: { daysPerYear: 12, accrualPerMonth: 1, carryForward: false, carryForwardCap: 0 },
    sick: { daysPerYear: 6, accrualPerMonth: 0, carryForward: false, carryForwardCap: 0 },
    earned: { daysPerYear: 15, accrualPerMonth: 1.25, carryForward: true, carryForwardCap: 30 },
    unpaid: { unlimited: true, requiresApproval: true },
  },
  leaveEscalationHours: 48, // unactioned → escalates one level

  // Sessions (§4) [ASSUMED]
  sessionTimeoutAdminFinanceMinutes: 30,
  sessionTimeoutOtherHours: 8,

  // Retention (§4) [ASSUMED]
  monitoringRetentionMonths: 12,

  // Finance (§4, §23) — all editable by Finance/SA in Admin Settings
  invoiceNumberFormat: 'RAD-{YYYY}-{SEQ4}', // [ASSUMED]
  currency: 'INR', // INR only in V1
  defaultGstPercent: 18, // editable per line [ASSUMED]
  paymentTermsDays: 15, // [ASSUMED]
  paymentModes: ['Bank Transfer', 'UPI', 'Cheque', 'Cash', 'Card'], // [ASSUMED]
  expenseCategories: ['Freelancer Payout', 'Tool Subscription', 'Travel', 'Other'], // §5.8 [ASSUMED]
  // Per-role hourly COST rates for P&L labor estimate (§5.8, §23). INR/hour. [ASSUMED]
  hourlyCostRates: {
    SUPER_ADMIN: 0,
    HR: 300,
    PM: 800,
    TEAM_LEAD: 600,
    EMPLOYEE: 400,
    FINANCE: 400,
    CLIENT: 0,
  } as Record<string, number>,
  standardWorkdayHours: 8, // payable-day / overtime-day basis (§21) [ASSUMED]
  invoiceFooterText: 'Thank you for your business.', // [ASSUMED]

  // Company / branding for invoices & portal (§23 Company) [ASSUMED — confirm]
  companyName: 'Rademics',
  companyAddress: 'Chennai, Tamil Nadu, India',
  companyGstin: '',
  brandPrimary: '#1B2A4A',
  brandAccent: '#2563EB',

  // Files (§4) [ASSUMED]
  fileUploadLimitMb: 100,

  // Notifications (§22) [ASSUMED]
  inAppNotificationRetentionDays: 90,

  // Capacity (§5.9)
  weeklyCapacityHoursInternal: 40,

  // AI (§7) [ASSUMED]
  aiDailyCallLimitPerUser: 50,

  // Auth (§5.1)
  passwordMinLength: 10, // must include a number [ASSUMED]
  passwordResetLinkMinutes: 30,
  failedLoginLockCount: 5,
  failedLoginLockMinutes: 15,

  // Company (§23)
  timezone: 'Asia/Kolkata',
} as const;

export type BusinessRules = typeof DEFAULT_BUSINESS_RULES;
