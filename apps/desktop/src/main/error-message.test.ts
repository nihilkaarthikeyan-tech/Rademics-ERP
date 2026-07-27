import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiError } from './api-client';
import { errorMessage } from './error-message';

/**
 * No user ever sees a network diagnostic code (2026-07-27).
 *
 * A person shown "net::ERR_NAME_NOT_RESOLVED" cannot tell whether their
 * password is wrong, their wifi is down, or the company's server has died — so
 * they message support instead of checking their connection. Server replies are
 * written for the user and must still pass through; only the unreachable case
 * gets rewritten.
 */
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const OFFLINE = "Can't reach Rademics — check your internet connection and try again.";

describe('errorMessage', () => {
  it('rewrites every flavour of "could not reach the server"', () => {
    for (const raw of [
      'net::ERR_NAME_NOT_RESOLVED',
      'net::ERR_INTERNET_DISCONNECTED',
      'net::ERR_CONNECTION_REFUSED',
      'net::ERR_TIMED_OUT',
      'net::ERR_PROXY_CONNECTION_FAILED',
      'getaddrinfo ENOTFOUND api.52digit.com',
      'connect ECONNREFUSED 127.0.0.1:4000',
      'fetch failed',
    ]) {
      expect(errorMessage(new Error(raw)), raw).toBe(OFFLINE);
    }
  });

  it('never leaks a raw net:: code to the user', () => {
    const shown = errorMessage(new Error('net::ERR_NAME_NOT_RESOLVED'));
    expect(shown).not.toMatch(/net::/);
    expect(shown).not.toMatch(/ERR_/);
  });

  it('passes a real server reply through — those are written for the user', () => {
    expect(errorMessage(new ApiError(401, 'Invalid email or password'))).toBe(
      'Invalid email or password',
    );
    expect(errorMessage(new ApiError(426, 'Please update the app to continue'))).toBe(
      'Please update the app to continue',
    );
  });

  it('does not leak an unexpected internal error either', () => {
    const shown = errorMessage(new Error("Cannot read properties of undefined (reading 'x')"));
    expect(shown).toBe('Something went wrong. Please try again.');
  });

  it('handles a thrown non-Error without crashing', () => {
    expect(errorMessage('a bare string')).toBe('Something went wrong. Please try again.');
    expect(errorMessage(undefined)).toBe('Something went wrong. Please try again.');
  });
});
