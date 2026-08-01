export { toNodeHandler } from "better-auth/node";
export {
	type Auth,
	type AuthConfig,
	CLIENT_IP_HEADER,
	createAuth,
} from "./auth.js";
export {
	AUTH_BASE_PATH,
	AUTH_JWKS_PATH,
	AUTH_TOKEN_PATH,
	type DataConnectionConfig,
	resolveAuthConfig,
	resolveDataConnectionConfig,
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
