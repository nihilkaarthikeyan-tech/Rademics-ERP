/**
 * A real HTTP reply from the server, as opposed to never reaching it.
 *
 * Its own module, deliberately free of any electron import: api-client.ts pulls
 * in `electron`, and CI builds with ELECTRON_SKIP_BINARY_DOWNLOAD, where merely
 * importing that package throws. Anything that needs to tell "the server said
 * no" apart from "we could not reach the server" — including tests — imports
 * from here instead.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
