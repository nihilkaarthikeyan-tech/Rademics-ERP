import { app, shell } from 'electron';
import { isAllowedExternalUrl } from './url-guard';

/**
 * Open a link in the employee's normal browser or mail app — but only a web or
 * email link (see url-guard.ts). Anything else is dropped without a word: a
 * page in the app should never be able to make Windows run something.
 */
export function openExternalIfAllowed(target: string): void {
  if (isAllowedExternalUrl(target, !app.isPackaged)) void shell.openExternal(target);
}
