/**
 * Capability keys — the full enumeration of the Role & Permission Matrix (Spec §3).
 *
 * These are stored as capability-keys-against-roles so Super Admin can adjust
 * grants without a code change (§3). This file is the SEED / source of truth for
 * the key set; the grant values live in `matrix.ts`.
 *
 * 44 capabilities across 8 groups, transcribed verbatim from the §3 table.
 */

export const CapabilityGroup = {
  PEOPLE: 'People & Organization',
  ATTENDANCE: 'Attendance',
  PROJECTS: 'Projects & Tasks',
  FILES: 'Files',
  CLIENT_PORTAL: 'Client Portal',
  LEAVE: 'Leave',
  FINANCE: 'Finance',
  REPORTS_AI_ADMIN: 'Reports, AI & Admin',
} as const;

export type CapabilityGroup = (typeof CapabilityGroup)[keyof typeof CapabilityGroup];

export interface CapabilityMeta {
  key: string;
  group: CapabilityGroup;
  label: string;
}

const G = CapabilityGroup;

/** Ordered exactly as the §3 table rows. */
export const CAPABILITIES = [
  // — People & Organization —
  { key: 'people.employee.create_edit', group: G.PEOPLE, label: 'Create / edit employee' },
  { key: 'people.employee.deactivate', group: G.PEOPLE, label: 'Deactivate / offboard user' },
  { key: 'people.roles.assign', group: G.PEOPLE, label: 'Assign / change roles' },
  { key: 'people.departments.manage', group: G.PEOPLE, label: 'Manage departments & teams' },
  { key: 'people.directory.view', group: G.PEOPLE, label: 'View employee directory' },
  { key: 'people.salary.view_edit', group: G.PEOPLE, label: 'View / edit salary data' },
  {
    key: 'people.freelancer.manage_contracts',
    group: G.PEOPLE,
    label: 'Manage freelancer contracts/NDA files',
  },

  // — Attendance —
  { key: 'attendance.check_in_out', group: G.ATTENDANCE, label: 'Check in / check out (self)' },
  { key: 'attendance.own.view', group: G.ATTENDANCE, label: 'View own attendance & productivity' },
  { key: 'attendance.team.view', group: G.ATTENDANCE, label: 'View team attendance' },
  { key: 'attendance.all.view', group: G.ATTENDANCE, label: 'View all attendance' },
  { key: 'attendance.rules.configure', group: G.ATTENDANCE, label: 'Configure attendance rules' },
  {
    key: 'attendance.regularization.request',
    group: G.ATTENDANCE,
    label: 'Request attendance regularization',
  },
  {
    key: 'attendance.regularization.approve',
    group: G.ATTENDANCE,
    label: 'Approve regularization',
  },

  // — Projects & Tasks —
  {
    key: 'projects.create_edit',
    group: G.PROJECTS,
    label: 'Create / edit project or work stream',
  },
  { key: 'projects.archive_close', group: G.PROJECTS, label: 'Archive / close project' },
  { key: 'tasks.create', group: G.PROJECTS, label: 'Create tasks & subtasks' },
  { key: 'tasks.assign', group: G.PROJECTS, label: 'Assign / reassign tasks' },
  { key: 'tasks.update_own_status', group: G.PROJECTS, label: 'Update status of own tasks' },
  { key: 'tasks.review', group: G.PROJECTS, label: 'Review: approve / send back submissions' },
  { key: 'tasks.comment', group: G.PROJECTS, label: 'Comment on tasks' },
  { key: 'projects.view_all', group: G.PROJECTS, label: 'View all projects' },
  { key: 'projects.view_own_team', group: G.PROJECTS, label: 'View own / team projects only' },

  // — Files —
  { key: 'files.upload', group: G.FILES, label: 'Upload files to tasks' },
  { key: 'files.mark_client_visible', group: G.FILES, label: 'Mark file visible to client' },
  { key: 'files.delete_version', group: G.FILES, label: 'Delete file version' },

  // — Client Portal —
  { key: 'portal.progress.view', group: G.CLIENT_PORTAL, label: 'View shared project progress' },
  { key: 'portal.files.download', group: G.CLIENT_PORTAL, label: 'Download client-visible files' },
  {
    key: 'portal.deliverable.approve',
    group: G.CLIENT_PORTAL,
    label: 'Approve / request revision on deliverable',
  },
  {
    key: 'portal.invoices.view',
    group: G.CLIENT_PORTAL,
    label: 'View own invoices & payment status',
  },
  { key: 'portal.users.manage', group: G.CLIENT_PORTAL, label: 'Manage client users & scopes' },

  // — Leave —
  { key: 'leave.request', group: G.LEAVE, label: 'Request leave (self)' },
  { key: 'leave.approve_team', group: G.LEAVE, label: 'Approve team leave' },
  { key: 'leave.policy.configure', group: G.LEAVE, label: 'Configure leave policy & quotas' },
  { key: 'leave.calendar.view', group: G.LEAVE, label: 'View leave calendar' },

  // — Finance —
  { key: 'finance.invoices.create_edit', group: G.FINANCE, label: 'Create / edit invoices' },
  { key: 'finance.payments.record', group: G.FINANCE, label: 'Record payments & view dues' },
  { key: 'finance.expenses.log', group: G.FINANCE, label: 'Log expenses against projects' },
  { key: 'finance.pnl.view', group: G.FINANCE, label: 'View P&L per vertical' },
  { key: 'finance.payroll.export', group: G.FINANCE, label: 'Run payroll export' },

  // — Reports, AI & Admin —
  { key: 'reports.dashboard.view', group: G.REPORTS_AI_ADMIN, label: 'View reports dashboard' },
  {
    key: 'ai.assistant.use',
    group: G.REPORTS_AI_ADMIN,
    label: 'Use AI assistant (scoped to own access)',
  },
  { key: 'audit.log.view', group: G.REPORTS_AI_ADMIN, label: 'View audit log' },
  {
    key: 'admin.settings.manage',
    group: G.REPORTS_AI_ADMIN,
    label: 'Manage system settings & integrations',
  },
] as const satisfies readonly CapabilityMeta[];

export type CapabilityKey = (typeof CAPABILITIES)[number]['key'];

export const CAPABILITY_KEYS: readonly CapabilityKey[] = CAPABILITIES.map((c) => c.key);
