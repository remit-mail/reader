/**
 * The header carrying the client address, set by the edge proxy from the
 * connection it terminates (deploy/vps/caddy/routes.caddy). It is deliberately
 * not `X-Forwarded-For`: that header arrives with an appended hop per proxy,
 * which resolves to no single client and collapses rate limiting onto one
 * shared bucket for everybody. Nothing else in the chain writes this name, and
 * the edge replaces any value a client sends, so it is single-valued and
 * trustworthy at the point better-auth reads it.
 */
export const CLIENT_IP_HEADER = "x-remit-client-ip";

export const SIGN_IN_DISABLED = {
	code: "SIGN_IN_DISABLED",
	message: "Sign-in is turned off on this server.",
} as const;

export const ACCOUNT_DISABLED = {
	code: "ACCOUNT_DISABLED",
	message: "This account is disabled.",
} as const;

const BEARER_PREFIX = /^Bearer\s+/i;

export const extractBearerToken = (
	authorization: string | undefined,
): string | undefined => {
	if (!authorization) return undefined;
	if (!BEARER_PREFIX.test(authorization)) return undefined;
	const token = authorization.replace(BEARER_PREFIX, "").trim();
	return token.length > 0 ? token : undefined;
};
