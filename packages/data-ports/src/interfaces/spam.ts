import type { SpamRequest, SpamResponse } from "../types.js";

/**
 * A spam service judges what the request presents (RFC 041). It never reads
 * Remit's database: every fact it weighs arrives in the request.
 */
export interface SpamService {
	check(request: SpamRequest): Promise<SpamResponse>;
}
