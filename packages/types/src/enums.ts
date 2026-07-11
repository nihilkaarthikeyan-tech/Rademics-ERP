/** Shared domain enums used across API and both apps. Spec §5.2, §5.4, §5.7, §5.8. */

/** Employment status (§5.2). */
export const EmploymentStatus = {
  ACTIVE: 'ACTIVE',
  ON_NOTICE: 'ON_NOTICE',
  EXITED: 'EXITED',
} as const;
export type EmploymentStatus = (typeof EmploymentStatus)[keyof typeof EmploymentStatus];

/** Container type (§5.4): fixed Project vs continuous Work Stream. */
export const ContainerType = {
  PROJECT: 'PROJECT',
  WORK_STREAM: 'WORK_STREAM',
} as const;
export type ContainerType = (typeof ContainerType)[keyof typeof ContainerType];

/** Task priority (§5.4). */
export const TaskPriority = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

/** Business verticals a department maps to for P&L (§5.2). */
export const BusinessVertical = {
  PUBLICATIONS: 'PUBLICATIONS',
  DESIGN: 'DESIGN',
  WEB: 'WEB',
  SUPPORT: 'SUPPORT',
} as const;
export type BusinessVertical = (typeof BusinessVertical)[keyof typeof BusinessVertical];

/** File visibility (§5.6). Internal is the default. */
export const FileVisibility = {
  INTERNAL: 'INTERNAL',
  CLIENT_VISIBLE: 'CLIENT_VISIBLE',
} as const;
export type FileVisibility = (typeof FileVisibility)[keyof typeof FileVisibility];

/** Virus-scan lifecycle for a file version (§5.6). Available only after a clean scan. */
export const ScanStatus = {
  PENDING: 'PENDING',
  CLEAN: 'CLEAN',
  INFECTED: 'INFECTED',
} as const;
export type ScanStatus = (typeof ScanStatus)[keyof typeof ScanStatus];

/** Client-portal scope level per project (§5.5). */
export const ClientScopeLevel = {
  VIEWER: 'VIEWER',
  APPROVER: 'APPROVER',
} as const;
export type ClientScopeLevel = (typeof ClientScopeLevel)[keyof typeof ClientScopeLevel];

/** Leave types (§4, §5.7). */
export const LeaveType = {
  CASUAL: 'CASUAL',
  SICK: 'SICK',
  EARNED: 'EARNED',
  UNPAID: 'UNPAID',
} as const;
export type LeaveType = (typeof LeaveType)[keyof typeof LeaveType];

/** Invoice lifecycle (§5.8). Overdue is auto after due date. */
export const InvoiceStatus = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

/** Client notification digest mode (§5.5). Default weekly. */
export const DigestMode = {
  REALTIME: 'REALTIME',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
} as const;
export type DigestMode = (typeof DigestMode)[keyof typeof DigestMode];
