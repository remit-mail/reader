import { base36uuidv5, REMIT_NAMESPACE } from "@remit/remit-electrodb-service";
import type { APIGatewayProxyEvent } from "aws-lambda";

const LOCAL_BYPASS_VARS = [
	"LOCAL_ACCOUNT_CONFIG_ID",
	"LOCAL_COGNITO_SUB",
] as const;

const isLocalEnv = (env: NodeJS.ProcessEnv): boolean =>
	env.NODE_ENV === "development" || env.NODE_ENV === "test";

/**
 * The LOCAL_ACCOUNT_CONFIG_ID / LOCAL_COGNITO_SUB overrides bypass authentication
 * for local dev and fixtures: with them set, an unauthenticated request is served
 * as the pinned account. They must never reach a deployed environment. Refuse to
 * start (throw at module load) if either is present outside a local NODE_ENV — the
 * same `development`/`test` signal the data layer already uses to decide local vs
 * deployed. Fail loud rather than silently ignore, so a leaked env var is caught at
 * boot, not exploited at runtime.
 */
export const assertLocalBypassNotInDeployedEnv = (
	env: NodeJS.ProcessEnv = process.env,
): void => {
	if (isLocalEnv(env)) return;
	const leaked = LOCAL_BYPASS_VARS.filter((name) => {
		const value = env[name];
		return typeof value === "string" && value.length > 0;
	});
	if (leaked.length === 0) return;
	throw new Error(
		`Refusing to start: local auth bypass ${leaked.join(", ")} is set while NODE_ENV=${env.NODE_ENV ?? "(unset)"}. These overrides bypass authentication and must never be present in a deployed environment.`,
	);
};

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
 * Return the Cognito `sub` for the current request, preferring the JWT claim
 * and falling back to `LOCAL_COGNITO_SUB` for local development. Returns
 * `undefined` when neither is available (e.g. seeded fixtures that only set
 * `LOCAL_ACCOUNT_CONFIG_ID`).
 */
export const getSubFromEvent = (
	event: APIGatewayProxyEvent,
): string | undefined => {
	const sub = getSubFromClaims(event);
	if (sub) return sub;
	const localSub = process.env.LOCAL_COGNITO_SUB;
	if (localSub && localSub.length > 0) return localSub;
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
