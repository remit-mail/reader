import { deriveAccountConfigId } from "@remit/data-ports/id";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { HandlerIdentity } from "./types.js";

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
 * boot, not exploited at runtime. In a local NODE_ENV the bypass is read here
 * once, so a bypass set without LOCAL_EMAIL also fails at boot.
 */
export const assertLocalBypassNotInDeployedEnv = (
	env: NodeJS.ProcessEnv,
): void => {
	if (isLocalEnv(env)) {
		localIdentityFromEnv(env);
		return;
	}
	const leaked = LOCAL_BYPASS_VARS.filter((name) => {
		const value = env[name];
		return typeof value === "string" && value.length > 0;
	});
	if (leaked.length === 0) return;
	throw new Error(
		`Refusing to start: local auth bypass ${leaked.join(", ")} is set while NODE_ENV=${env.NODE_ENV ?? "(unset)"}. These overrides bypass authentication and must never be present in a deployed environment.`,
	);
};

const readClaim = (
	event: APIGatewayProxyEvent,
	name: "sub" | "email",
): string | undefined => {
	const value = event.requestContext?.authorizer?.claims?.[name];
	if (typeof value === "string" && value.length > 0) return value;
	return undefined;
};

const ANONYMOUS: HandlerIdentity = { kind: "anonymous" };

export const userFromClaims = (
	sub: string,
	email: string | undefined,
): HandlerIdentity => {
	if (!email) return ANONYMOUS;
	return {
		kind: "user",
		accountConfigId: deriveAccountConfigId(sub),
		sub,
		email,
	};
};

const pinnedLocalUser = (
	env: NodeJS.ProcessEnv,
): { accountConfigId: string; sub: string } | undefined => {
	const localAccountConfigId = env.LOCAL_ACCOUNT_CONFIG_ID;
	if (localAccountConfigId) {
		return { accountConfigId: localAccountConfigId, sub: localAccountConfigId };
	}
	const localSub = env.LOCAL_COGNITO_SUB;
	if (localSub) {
		return { accountConfigId: deriveAccountConfigId(localSub), sub: localSub };
	}
	return undefined;
};

export const localIdentityFromEnv = (
	env: NodeJS.ProcessEnv,
): HandlerIdentity => {
	const pinned = pinnedLocalUser(env);
	if (!pinned) return ANONYMOUS;

	const email = env.LOCAL_EMAIL;
	if (!email) {
		throw new Error(
			"Refusing to start: the local auth bypass (LOCAL_ACCOUNT_CONFIG_ID or LOCAL_COGNITO_SUB) is set without LOCAL_EMAIL. The bypass serves a signed-in user, and every user carries an email; set LOCAL_EMAIL to the address that user signs in with.",
		);
	}

	return { kind: "user", ...pinned, email };
};

/**
 * The caller of an API Gateway event. Production reads the Cognito `sub` and
 * `email` claims (verified by the authorizer, or by `jwt-auth.ts` on
 * self-host) and derives the accountConfigId via UUIDv5. Local development
 * honours `LOCAL_ACCOUNT_CONFIG_ID` (a pinned seeded config) and
 * `LOCAL_COGNITO_SUB` (a pinned sub, derived like production), read once at
 * boot into `localIdentity`.
 */
export const getIdentityFromEvent = (
	event: APIGatewayProxyEvent,
	localIdentity: HandlerIdentity,
): HandlerIdentity => {
	const sub = readClaim(event, "sub");
	if (!sub) return localIdentity;

	return userFromClaims(sub, readClaim(event, "email"));
};
