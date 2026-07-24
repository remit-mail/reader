/**
 * Build-time constants injected by vite.config.ts via `define`.
 * __APP_SHA__ is the full git SHA (or "dev" in local builds without git).
 * __APP_BUILD_TIME__ is an ISO timestamp.
 */

export const APP_SHA: string = __APP_SHA__;
export const APP_BUILD_TIME: string = __APP_BUILD_TIME__;

/** First 7 characters of the SHA, matching git's default short form. */
export const APP_SHORT_SHA: string = APP_SHA.slice(0, 7);

/**
 * True when `APP_SHA` is a real git commit — a build that was given the commit
 * (via `GITHUB_SHA` at build time). A local build with no git resolves to the
 * literal "dev", which is not a commit and must not be linked (a
 * `/commit/dev` URL is a dead link).
 */
export const APP_SHA_IS_COMMIT = /^[0-9a-f]{40}$/.test(APP_SHA);

/** Commit URL for the build, or undefined when the build has no real SHA. */
export const GITHUB_COMMIT_URL: string | undefined = APP_SHA_IS_COMMIT
	? `https://github.com/remit-mail/reader/commit/${APP_SHA}`
	: undefined;

export const GITHUB_NEW_ISSUE_URL =
	"https://github.com/remit-mail/reader/issues/new";
