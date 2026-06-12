/**
 * Build-time constants injected by vite.config.ts via `define`.
 * __APP_SHA__ is the full git SHA (or "dev" in local builds without git).
 * __APP_BUILD_TIME__ is an ISO timestamp.
 */

export const APP_SHA: string = __APP_SHA__;
export const APP_BUILD_TIME: string = __APP_BUILD_TIME__;

/** First 7 characters of the SHA, matching git's default short form. */
export const APP_SHORT_SHA: string = APP_SHA.slice(0, 7);

export const GITHUB_COMMIT_URL = `https://github.com/remit-mail/remit/commit/${APP_SHA}`;
export const GITHUB_NEW_ISSUE_URL =
	"https://github.com/remit-mail/remit/issues/new";
