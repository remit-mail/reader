import type { SpamBackend } from "@remit/domain-enums";
import type { SpamRequest, SpamResponse } from "../types.js";

/**
 * A spam service judges what the request presents (RFC 041). It never reads
 * Remit's database: every fact it weighs arrives in the request.
 */
export interface SpamService {
	check(request: SpamRequest): Promise<SpamResponse>;
}

/**
 * The two scores that turn a spam score into an action. Calibration sets them;
 * until it does, every verdict's action is `None`.
 */
export type SpamThresholds =
	| { state: "Unset" }
	| { state: "Set"; cleanBelow: number; spamAt: number };

export interface SpamDeployment {
	backend: (typeof SpamBackend)[keyof typeof SpamBackend];
	thresholds: SpamThresholds;
}
