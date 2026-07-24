import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Remembered sign-in for the login screen. The email is stored as plain text;
 * the password is encrypted with Electron's safeStorage (DPAPI on Windows), so
 * it can only be decrypted by the same Windows user on the same machine — never
 * a plain-text password on disk. If OS-level encryption is unavailable, only
 * the email is remembered.
 */
interface SavedLoginFile {
  email: string;
  password?: string; // base64 of the safeStorage-encrypted buffer
}

function filePath(): string {
  return path.join(app.getPath('userData'), 'saved-login.json');
}

export async function loadSavedLogin(): Promise<{ email: string; password: string | null }> {
  try {
    const raw = JSON.parse(await fs.readFile(filePath(), 'utf8')) as SavedLoginFile;
    let password: string | null = null;
    if (raw.password && safeStorage.isEncryptionAvailable()) {
      try {
        password = safeStorage.decryptString(Buffer.from(raw.password, 'base64'));
      } catch {
        password = null; // encrypted under a different OS user/machine — ignore
      }
    }
    return { email: raw.email ?? '', password };
  } catch {
    return { email: '', password: null };
  }
}

export async function saveLogin(email: string, password: string, remember: boolean): Promise<void> {
  const data: SavedLoginFile = { email };
  if (remember && safeStorage.isEncryptionAvailable()) {
    data.password = safeStorage.encryptString(password).toString('base64');
  }
  await fs.writeFile(filePath(), JSON.stringify(data), 'utf8');
}
