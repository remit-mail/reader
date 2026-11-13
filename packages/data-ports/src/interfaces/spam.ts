import type { SpamRequest, SpamResponse, SpamThresholds } from "../types.js";

/**
 * A spam service judges what the request presents (RFC 041). It never reads
 * Remit's database: every fact it weighs arrives in the request.
 */
export interface SpamService {
	check(request: SpamRequest): Promise<SpamResponse>;
}

export type SpamDeployment =
	| { name: "Inline"; thresholds: SpamThresholds }
	| { name: "Rspamd"; url: string };
