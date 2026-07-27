import { ApiError } from './api-client';

/**
 * Chromium's network failure codes, which reach us verbatim when a request never
 * makes it to the server. They are not messages — they are diagnostics, and a
 * user shown "net::ERR_NAME_NOT_RESOLVED" cannot tell whether their password is
 * wrong, their wifi is down, or the company's server has died. So they contact
 * support, when the answer was "check your wifi".
 *
 * Every one of these means the same thing to the person sitting there: we could
 * not reach the server. The distinction between them matters only to us, so it
 * goes to the log and never on screen.
 *
 * Deliberately its own module, free of any electron import, so the guarantee
 * "no diagnostic code is ever shown to a user" can be tested directly.
 */
const NETWORK_ERROR_PATTERN =
  /net::ERR_|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|ERR_CONNECTION|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE|ERR_PROXY|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network error/i;

export const OFFLINE_MESSAGE =
  "Can't reach Rademics — check your internet connection and try again.";

export const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

export function errorMessage(err: unknown): string {
  // An ApiError is a real reply FROM the server (wrong password, account
  // disabled, app too old). Those are written for the user and pass through
  // untouched — rewriting them would hide the one thing they need to know.
  if (err instanceof ApiError) return err.message;

  if (err instanceof Error) {
    if (NETWORK_ERROR_PATTERN.test(err.message)) {
      console.error('[network]', err.message);
      return OFFLINE_MESSAGE;
    }
    // An unrecognised Error is still an internal detail — a stack-trace string
    // on screen tells the user nothing and looks broken.
    console.error('[unexpected]', err.message);
    return GENERIC_MESSAGE;
  }

  return GENERIC_MESSAGE;
}
