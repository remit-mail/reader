/**
 * The `#auth-token` seam for a better-auth-only build. A distributor that
 * composes the better-auth provider aliases `#auth-token` here, so the API
 * interceptor mints tokens without importing the Cognito (`aws-amplify/auth`)
 * path. The default `#auth-token` (see `auth-token.ts`) keeps both.
 */
export {
	fetchBetterAuthToken as fetchAuthToken,
	resetBetterAuthTokenCache as resetAuthTokenCache,
} from "./better-auth-config";
