export { toNodeHandler } from "better-auth/node";
export {
	ACCOUNT_DISABLED,
	type Auth,
	type AuthConfig,
	CLIENT_IP_HEADER,
	createAuth,
	SIGN_IN_DISABLED,
} from "./auth.js";
export {
	AUTH_BASE_PATH,
	AUTH_JWKS_PATH,
	AUTH_TOKEN_PATH,
	type DataConnectionConfig,
	resolveAuthConfig,
	resolveDataConnectionConfig,
	resolveSelfSignUpEnabled,
	resolveSignInEnabled,
	resolveVerifierConfig,
	type VerifierConfig,
} from "./config.js";
export type { AuditRecord } from "./constants.js";
export {
	HOST_CLIENT_IP,
	type IdentityStore,
	isUserDisabled,
	openIdentityStore,
	writeAudit,
} from "./identity-store.js";
export {
	createPeopleDirectory,
	type PeopleAdmin,
	type PeopleConfig,
	type PeopleDirectory,
} from "./people.js";
export {
	type AuthFetchHandler,
	withRateLimitLogging,
} from "./rate-limit-log.js";
export {
	createJwtVerifier,
	extractBearerToken,
	type JwtClaims,
	type JwtVerifier,
} from "./verify.js";
