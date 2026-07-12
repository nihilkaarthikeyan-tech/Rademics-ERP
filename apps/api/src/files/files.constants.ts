/** Files queue + job names (Spec §5.6, §11 — scanning runs off the request path). */
export const QUEUE_FILES = 'files';
export const FILE_JOB_SCAN = 'scan';
export const FILE_JOB_CLEANUP = 'cleanup-orphans';
export const FILE_CLEANUP_REPEAT_ID = 'file-cleanup';

/** §24 defaults (overridable in Admin Settings). Executables blocked by default. */
export const DEFAULT_BLOCKED_EXTENSIONS = [
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'jar', 'js', 'vbs',
  'ps1', 'sh', 'app', 'dll', 'deb', 'rpm',
];
export const DEFAULT_PRESIGNED_MINUTES = 10; // presigned URL lifetime (§24)
export const DEFAULT_UPLOAD_LIMIT_MB = 100; // matches DEFAULT_BUSINESS_RULES.fileUploadLimitMb

export interface ScanJobData {
  versionId: string;
}
