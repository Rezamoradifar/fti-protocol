// Read-only activity work may use the existing bounded RPC/fallback window.
// The browser leaves room for the server response and does not immediately
// repeat a timed-out/cached failure. Never apply this policy to wallet sends.
export const HISTORY_SERVER_TIMEOUT_MS = 18_000;
export const ACTIVITY_READ_TIMEOUT_MS = 20_000;
export const ACTIVITY_READ_ATTEMPTS = 1;
