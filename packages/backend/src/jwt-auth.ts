import {
	createJwtVerifier,
	extractBearerToken,
	type JwtVerifier,
	resolveVerifierConfig,
} from "@remit/auth-service/verifier";
import { logger } from "@remit/logger";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { getIdentityFromEvent, userFromClaims } from "./auth.js";
import type { HandlerIdentity } from "./types.js";

let verifier: JwtVerifier | null = null;

const getVerifier = (): JwtVerifier => {
	if (!verifier) verifier = createJwtVerifier(resolveVerifierConfig());
	return verifier;
};

/** Test-only override for the memoized verifier. Pass null to reset. */
export const _setVerifierForTest = (v: JwtVerifier | null): void => {
	verifier = v;
};

const readHeader = (
	headers: APIGatewayProxyEvent["headers"],
	name: string,
): string | undefined => {
	for (const [key, value] of Object.entries(headers ?? {})) {
		if (key.toLowerCase() === name && typeof value === "string") return value;
	}
	return undefined;
};

/**
 * The caller of a self-host request, from a better-auth RS256 JWT.
 *
 * Claims the edge tier (APISIX) already verified and injected are trusted as
 * they stand. Otherwise a bearer token is verified here; a token that fails
 * verification is an anonymous caller, so the operation table answers 401. With
 * no token the local bypass, when one is configured, is the caller. Only an
 * operation that needs a caller resolves this, so a public route never does.
 */
export const identityFromSelfHostRequest = async (
	event: APIGatewayProxyEvent,
	localIdentity: HandlerIdentity,
): Promise<HandlerIdentity> => {
	const existingSub = event.requestContext?.authorizer?.claims?.sub;
	if (typeof existingSub === "string" && existingSub.length > 0) {
		return getIdentityFromEvent(event, localIdentity);
	}

	const token = extractBearerToken(readHeader(event.headers, "authorization"));
	if (!token) return localIdentity;

	const claims = await getVerifier()(token).catch((err: unknown) => {
		logger.warn(
			{ err: err instanceof Error ? err.message : String(err) },
			"better-auth JWT verification failed",
		);
		return null;
	});
	if (!claims) return { kind: "anonymous" };
	return userFromClaims(claims.sub, claims.email);
};
