import type { SpamReason, SpamRequest, SpamResponse } from "../types.js";

/** What the model answered for one message in the ambiguous band. */
export interface SpamModelAnswer {
	verdict: "Impersonation" | "Spam" | "Clean";
	score: number;
	reason: string;
}

export type SpamModelSkip = "DailyLimit" | "RateLimited" | "Failed";

export type SpamModelOutcome =
	| { state: "Answered"; answer: SpamModelAnswer }
	| { state: "Skipped"; cause: SpamModelSkip };

/**
 * Stage 3 as Remit offers it to the spam service: each call claims one unit of
 * the account's daily cap before it reaches the model.
 */
export interface SpamModel {
	ask(
		request: SpamRequest,
		reasons: readonly SpamReason[],
	): Promise<SpamModelOutcome>;
}

/**
 * A spam service judges what the request presents (RFC 041). It never reads
 * Remit's database: every fact it weighs arrives in the request, and it asks
 * the model only when the request's `modelAllowed` says it may.
 */
export interface SpamService {
	check(request: SpamRequest, model: SpamModel): Promise<SpamResponse>;
}

/**
 * The two scores that turn a spam score into an action. Calibration sets them;
 * until it does, every verdict's action is `None`.
 */
export type SpamThresholds =
	| { state: "Unset" }
	| { state: "Set"; cleanBelow: number; spamAt: number };

export interface SpamDeployment {
	thresholds: SpamThresholds;
}
