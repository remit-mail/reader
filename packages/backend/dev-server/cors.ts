export const parseAllowedOrigins = (raw: string | undefined): string[] =>
	(raw ?? "")
		.split(",")
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0);

/**
 * Resolve the `Access-Control-Allow-Origin` value for a request against the
 * configured allowlist.
 *
 * - a `*` entry allows any origin (browsers reject `*` with credentials, so this
 *   stays safe for a bearer-token API);
 * - otherwise the request `Origin` is reflected only when it is in the allowlist;
 * - an origin outside the allowlist yields `undefined` — no CORS header is sent.
 */
export const resolveAllowOrigin = (
	requestOrigin: string | undefined,
	allowedOrigins: string[],
): string | undefined => {
	if (allowedOrigins.includes("*")) return "*";
	if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
		return requestOrigin;
	}
	return undefined;
};
