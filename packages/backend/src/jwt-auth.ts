import {
	createJwtVerifier,
	extractBearerToken,
	type JwtVerifier,
	resolveVerifierConfig,
} from "@remit/auth-service/verifier";
import { logger } from "@remit/logger-lambda";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

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

const unauthorized = (message: string): APIGatewayProxyResult => ({
	statusCode: 401,
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ message }),
});

const injectClaims = (
	event: APIGatewayProxyEvent,
	sub: string,
	email: string | undefined,
): void => {
	event.requestContext = {
		...event.requestContext,
		authorizer: {
			...event.requestContext?.authorizer,
			claims: {
				sub,
				email: email ?? "",
			},
		},
	};
};

const hasLocalBypass = (): boolean =>
	Boolean(process.env.LOCAL_ACCOUNT_CONFIG_ID);

/**
 * The one route that runs without a token.
 *
 * Microsoft redirects the browser here after consent, so the request carries no
 * Authorization header and no session to derive one from. The handler takes its
 * identity from the HMAC-signed `state` parameter and validates it there; that
 * signature is the gate, not a JWT.
 *
 * Hardcoded and single-entry, matching the edge exemption in
 * packages/apisix/src/route-table.ts. `@useAuth(NoAuth)` in the spec does not
 * open a path here — a future public route is added by hand.
 */
const PUBLIC_ROUTE = {
	method: "GET",
	path: "/accounts/oauth/microsoft/callback",
};

const isPublicRoute = (event: APIGatewayProxyEvent): boolean =>
	event.httpMethod === PUBLIC_ROUTE.method && event.path === PUBLIC_ROUTE.path;

/**
 * Authenticate a self-host request from a better-auth RS256 JWT.
 *
 * On a valid token the verified `sub` is injected into the event's authorizer
 * claims, exactly where the Cognito authorizer puts it, so every downstream
 * handler reads identity through the unchanged `auth.ts` path. Returns a 401
 * response (not null) when a token is present but fails verification, or when no
 * token is supplied and no local test bypass is configured. Returns null to let
 * the request proceed.
 *
 * When the edge tier (APISIX) has already verified and injected claims, this is
 * a no-op — the backend trusts pre-populated claims and re-verifies otherwise.
 */
export const authenticateSelfHostRequest = async (
	event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult | null> => {
	if (isPublicRoute(event)) return null;

	const existingSub = event.requestContext?.authorizer?.claims?.sub;
	if (typeof existingSub === "string" && existingSub.length > 0) return null;

	const token = extractBearerToken(readHeader(event.headers, "authorization"));

	if (token) {
		const claims = await getVerifier()(token).catch((err: unknown) => {
			logger.warn(
				{ err: err instanceof Error ? err.message : String(err) },
				"better-auth JWT verification failed",
			);
			return null;
		});
		if (!claims) return unauthorized("Invalid or expired token");
		injectClaims(event, claims.sub, claims.email);
		return null;
	}

	if (hasLocalBypass()) return null;

	return unauthorized("Authentication required");
};
