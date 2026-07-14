import type { RemitImapOrganizeJobState } from "@remit/api-http-client/types.gen.ts";

/** States a back-apply job stops at — polling ends here (RFC 034, #1278). */
const TERMINAL_STATES: ReadonlySet<RemitImapOrganizeJobState> = new Set([
	"Complete",
	"Failed",
]);

export const isTerminalJobState = (
	state: RemitImapOrganizeJobState | undefined,
): boolean => state !== undefined && TERMINAL_STATES.has(state);

const BASE_POLL_MS = 1_000;
const MAX_POLL_MS = 15_000;

/**
 * Exponential backoff for job polling: 1s, 2s, 4s, 8s, capped at 15s. `attempt`
 * is the number of polls already made (0 for the first delay). Backoff keeps a
 * long-running back-apply from hammering the job endpoint while staying
 * responsive for the common fast case — and there is never a client-side loop
 * over message pages (remit is data-heavy; the corpus is queried once, server
 * side, by the job itself).
 */
export const nextPollDelayMs = (attempt: number): number => {
	const clampedAttempt = Math.max(0, attempt);
	const delay = BASE_POLL_MS * 2 ** clampedAttempt;
	return Math.min(delay, MAX_POLL_MS);
};
