export { toNodeHandler } from "better-auth/node";
export { type Auth, type AuthConfig, createAuth } from "./auth.js";
export {
	AUTH_BASE_PATH,
	AUTH_JWKS_PATH,
	AUTH_TOKEN_PATH,
	resolveAuthConfig,
	resolveSelfSignUpEnabled,
	resolveVerifierConfig,
	type VerifierConfig,
} from "./config.js";
export {
	createJwtVerifier,
	extractBearerToken,
	type JwtClaims,
	type JwtVerifier,
} from "./verify.js";
