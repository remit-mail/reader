// JWT-verification-only slice of this package's barrel. The full barrel
// (`index.ts`) re-exports `createAuth` from `./auth.js`, which constructs a
// `pg.Pool` + `drizzle-orm/node-postgres` at module scope, and `toNodeHandler`
// from `better-auth/node` — neither needed to verify a token, both dragging a
// Postgres client into any Lambda bundle that only checks a bearer token (see
// #1242's FAQ, #1244/#1247). `config.ts`'s `AuthConfig` import from `./auth.js`
// is type-only and erases at build, so this stays free of that chain.

export {
	AUTH_BASE_PATH,
	AUTH_JWKS_PATH,
	AUTH_TOKEN_PATH,
	resolveVerifierConfig,
	type VerifierConfig,
} from "./config.js";
export {
	createJwtVerifier,
	extractBearerToken,
	type JwtClaims,
	type JwtVerifier,
} from "./verify.js";
