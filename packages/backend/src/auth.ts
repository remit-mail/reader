import { base36uuidv5, REMIT_NAMESPACE } from "@remit/remit-electrodb-service";
import type { APIGatewayProxyEvent } from "aws-lambda";

/**
 * Derive a deterministic accountConfigId from a Cognito subject (`sub`) claim.
 * One Cognito user maps to exactly one account config.
 */
export const deriveAccountConfigId = (sub: string): string =>
	base36uuidv5(`account:${sub}`, REMIT_NAMESPACE);

const getSubFromClaims = (event: APIGatewayProxyEvent): string | undefined => {
	const claims = event.requestContext?.authorizer?.claims;
	if (!claims) return undefined;
	const sub = claims.sub;
	if (typeof sub === "string" && sub.length > 0) return sub;
	return undefined;
};

/**
 * Extract the caller's accountConfigId from an API Gateway event.
 *
 * Production: reads the Cognito `sub` claim (verified by the API Gateway
 * Cognito authorizer) and derives the accountConfigId via UUIDv5.
 *
 * Local development: honours two environment overrides so the dev server and
 * playwright fixtures can run without a real Cognito token:
 *   - `LOCAL_ACCOUNT_CONFIG_ID` — pin a specific seeded accountConfigId
 *   - `LOCAL_COGNITO_SUB` — pin a Cognito `sub` value; derived like production
 */
export const getAccountConfigIdFromEvent = (
	event: APIGatewayProxyEvent,
): string => {
	const sub = getSubFromClaims(event);
	if (sub) return deriveAccountConfigId(sub);

	const localAccountConfigId = process.env.LOCAL_ACCOUNT_CONFIG_ID;
	if (localAccountConfigId) return localAccountConfigId;

	const localSub = process.env.LOCAL_COGNITO_SUB;
	if (localSub) return deriveAccountConfigId(localSub);

	throw new Error(
		"Missing accountConfigId: no Cognito `sub` claim on the request, and neither LOCAL_ACCOUNT_CONFIG_ID nor LOCAL_COGNITO_SUB env var is set",
	);
};
