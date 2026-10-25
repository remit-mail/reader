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
	env: NodeJS.ProcessEnv = process.env,
): void => {
	if (isLocalEnv(env)) {
		localIdentity(env);
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

const localIdentity = (env: NodeJS.ProcessEnv): HandlerIdentity => {
	const localAccountConfigId = env.LOCAL_ACCOUNT_CONFIG_ID;
	const localSub = env.LOCAL_COGNITO_SUB;
	if (!localAccountConfigId && !localSub) return ANONYMOUS;

	const email = env.LOCAL_EMAIL;
	if (!email) {
		throw new Error(
			"Refusing to start: the local auth bypass (LOCAL_ACCOUNT_CONFIG_ID or LOCAL_COGNITO_SUB) is set without LOCAL_EMAIL. The bypass serves a signed-in user, and every user carries an email; set LOCAL_EMAIL to the address that user signs in with.",
		);
	}

	if (localAccountConfigId) {
		return {
			kind: "user",
			accountConfigId: localAccountConfigId,
			sub: localAccountConfigId,
			email,
		};
	}

	if (!localSub) return ANONYMOUS;
	return {
		kind: "user",
		accountConfigId: deriveAccountConfigId(localSub),
		sub: localSub,
		email,
	};
};

/**
 * The caller of an API Gateway event. Production reads the Cognito `sub` and
 * `email` claims (verified by the authorizer, or by `jwt-auth.ts` on
 * self-host) and derives the accountConfigId via UUIDv5. Local development
 * honours `LOCAL_ACCOUNT_CONFIG_ID` (a pinned seeded config) and
 * `LOCAL_COGNITO_SUB` (a pinned sub, derived like production).
 */
export const getIdentityFromEvent = (
	event: APIGatewayProxyEvent,
	env: NodeJS.ProcessEnv = process.env,
): HandlerIdentity => {
	const sub = readClaim(event, "sub");
	if (!sub) return localIdentity(env);

	const email = readClaim(event, "email");
	if (!email) return ANONYMOUS;

	return {
		kind: "user",
		accountConfigId: deriveAccountConfigId(sub),
		sub,
		email,
	};
};
