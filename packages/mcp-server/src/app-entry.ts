export { CLIENT_IP_HEADER } from "@remit/auth-service/constants";
export {
	challenge,
	createMcpApp,
	createMcpPages,
	type McpAppConfig,
	type McpChallengeError,
	type McpPagesConfig,
	type McpResourceConfig,
	protectedResourceMetadata,
} from "./app.js";
export {
	AUTH_BASE_PATH,
	CONNECTED_APPS_API_PATH,
	CONNECTED_APPS_PATH,
	CONSENT_PATH,
	createBetterAuthTokenVerifier,
	createMcpAuth,
	DEVICE_APPROVE_PATH,
	DEVICE_CODE_PATH,
	DEVICE_DENY_PATH,
	DEVICE_PATH,
	JWKS_PATH,
	LOGIN_PATH,
	MCP_PATH,
	type McpAuth,
	type McpAuthConfig,
	type McpAuthRoutes,
	type McpAuthServer,
	type McpBrowserAuth,
	type McpBrowserRoutes,
	type McpIdentity,
	type McpSessionState,
	type McpSignInResult,
	type McpSubject,
	mcpResource,
	OAUTH2_PATH_PREFIX,
	REVOKE_CLIENT_API_PATH,
	SIGN_IN_PATH,
	type SignIn,
} from "./auth/authorization-server.js";
export {
	type McpSqliteDatabase,
	type McpUserTables,
	mcpDatabase,
} from "./auth/mcp-database.js";
export {
	describeScopes,
	MCP_READ_SCOPE,
	MCP_RULES_SCOPE,
	MCP_SCOPES,
	OFFLINE_ACCESS_SCOPE,
} from "./auth/scopes.js";
export type {
	TokenVerification,
	TokenVerifier,
} from "./auth/token-verifier.js";
export {
	claudeMcpAddCommand,
	type DeviceLoginIo,
	type DeviceLoginResult,
	deviceLogin,
} from "./cli/device-login.js";
export {
	type FilterToolDeps,
	FOLDER_POLL_INTERVAL_MS,
	FOLDER_SETTLE_TIMEOUT_MS,
	type FolderToolDeps,
	type McpDeps,
	type McpDepsExtras,
	mcpDepsOf,
} from "./deps.js";
export { STYLESHEET_PATH } from "./pages/assets.js";
export { errorPage, pageError, renderPage } from "./pages/render.js";
export {
	type ConnectedAppGrant,
	connectedAppsView,
	consentView,
	deviceView,
	loginView,
} from "./pages/views.js";
export {
	createMcpHandler,
	type McpPrincipal,
	type McpRequestHandler,
} from "./server.js";
