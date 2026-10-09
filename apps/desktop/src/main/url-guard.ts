/**
 * Which links the app may hand to Windows to open. Windows opens whatever a URL
 * scheme is registered for — file: runs a local program, ms-msdt:/search-ms:
 * have been used to run code from a single click — so only web pages and email
 * links ever leave the app. Plain http is allowed only in dev, where the local
 * stack has no TLS.
 */
export function isAllowedExternalUrl(target: string, allowHttp: boolean): boolean {
  try {
    const { protocol } = new URL(target);
    return protocol === 'https:' || protocol === 'mailto:' || (allowHttp && protocol === 'http:');
  } catch {
    return false;
  }
}

/** The origin of a URL, or null if it is not a URL (never throws). */
export function originOf(target: string | undefined | null): string | null {
  if (!target) return null;
  try {
    return new URL(target).origin;
  } catch {
    return null;
  }
}
