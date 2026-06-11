import type { RefreshError } from "./types.js";

/**
 * AAD error codes that require the user to re-authenticate (invalid_grant family).
 *
 * 70000 — General invalid_grant
 * 70008 — Refresh token has expired or is invalid
 * 700082 — Refresh token has expired due to inactivity (90-day policy)
 * 50173 — Fresh auth required; credential or token has expired
 * 50057 — User account is disabled
 * 65001 — The user or administrator has not consented to use the application
 * 50076 — MFA required (interactive re-auth needed)
 * 50079 — User is required to use MFA
 * 50158 — External security challenge was not satisfied
 * 53003 — Access blocked by Conditional Access
 */
const REAUTH_CODES = new Set([
	70000, // General invalid_grant
	70008, // Refresh token expired or invalid
	700082, // Refresh token expired due to inactivity
	50173, // Credential or token expired, fresh auth required
	50057, // Account disabled
	65001, // No consent granted
	50076, // MFA required
	50079, // MFA required (stronger auth)
	50158, // External security challenge not satisfied
	53003, // Access blocked by Conditional Access
]);

/**
 * AAD error codes that indicate a configuration problem (bad scopes, bad client).
 *
 * 70011 — The requested scope is invalid, unknown, or malformed. This is a
 *         deployment/configuration error, not an end-user reauth situation — the
 *         registered application's scope list must be corrected before retrying.
 */
const CONFIG_CODES = new Set([
	70011, // Invalid, unknown, or malformed scope
]);

export interface MicrosoftTokenErrorResponse {
	error: string;
	error_description?: string;
	error_codes?: number[];
	correlation_id?: string;
	trace_id?: string;
}

/**
 * Classifies a Microsoft OAuth error response into one of three kinds:
 * - reauth-required: user must re-authenticate (invalid_grant family)
 * - transient: network/server error, safe to retry
 * - config: bad client credentials or revoked consent
 */
export function classifyMicrosoftError(
	httpStatus: number,
	body: MicrosoftTokenErrorResponse,
): RefreshError {
	const errorCode = body.error ?? "unknown";
	const errorCodes = body.error_codes ?? [];

	// 1. explicit invalid_grant or known reauth error codes
	if (
		errorCode === "invalid_grant" ||
		errorCodes.some((c) => REAUTH_CODES.has(c))
	) {
		return { kind: "reauth-required", code: errorCode };
	}

	// 2. bad client credentials, revoked app consent, or misconfigured scopes
	if (
		errorCode === "invalid_client" ||
		errorCode === "unauthorized_client" ||
		errorCodes.some((c) => CONFIG_CODES.has(c))
	) {
		return { kind: "config", code: errorCode };
	}

	// 3. HTTP 5xx or 429 (rate-limited) → transient
	if (httpStatus >= 500 || httpStatus === 429) {
		return { kind: "transient", code: errorCode };
	}

	// 4. unknown → transient (retry-safe default)
	return { kind: "transient", code: errorCode };
}
