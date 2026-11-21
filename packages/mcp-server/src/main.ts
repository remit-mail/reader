import { setTimeout as sleep } from "node:timers/promises";
import { serve } from "@hono/node-server";
import {
	createAuth,
	createPeopleDirectory,
	openIdentityStore,
	resolveAuthConfig,
} from "@remit/auth-service";
import { resolveSignInEnabled } from "@remit/auth-service/verifier";
import { getClient } from "@remit/backend/client";
import { configFromEnv } from "@remit/backend/config-from-env";
import { logger } from "@remit/logger";
import { installNodeLogger } from "@remit/logger/node";
import { createMcpApp } from "./app.js";
import { createBetterAuthTokenVerifier } from "./auth/authorization-server.js";
import { openMcpAuthDatabase } from "./auth/database.js";
import { createSqliteMcpAuth } from "./auth/node-auth.js";
import { resolveMcpServerConfig } from "./config.js";
import {
	FOLDER_POLL_INTERVAL_MS,
	FOLDER_SETTLE_TIMEOUT_MS,
	mcpDepsOf,
} from "./deps.js";
import { createCalendarClient } from "./local-api-client.js";
import { createOperatorClient } from "./operator-client.js";
import { ASSETS_PATH_PREFIX, serveAsset } from "./pages/assets.js";
import { loadPageAssets } from "./pages/load-assets.js";

installNodeLogger();

const config = resolveMcpServerConfig();

const client = await getClient();
const apiConfig = configFromEnv(process.env);
const identityStore = await openIdentityStore(config.databases.app);
const authConfig = resolveAuthConfig();
const peopleDirectory = await createPeopleDirectory({
	auth: await createAuth(authConfig, identityStore),
	store: identityStore,
	baseURL: authConfig.baseURL,
});
const operatorHost = {
	config: apiConfig,
	client: async () => client,
	peopleDirectory: async () => peopleDirectory,
};
const deps = mcpDepsOf(client, {
	apiConfig,
	calendarClient: (userId) =>
		createCalendarClient(config.origin, apiConfig, client, userId),
	logger,
	operatorClient: (userId) =>
		createOperatorClient(config.origin, operatorHost, userId),
	settle: {
		settleTimeoutMs: FOLDER_SETTLE_TIMEOUT_MS,
		pollIntervalMs: FOLDER_POLL_INTERVAL_MS,
		sleep,
	},
});

const authDb = openMcpAuthDatabase(config.databases.app).db;
const { auth, routes } = createSqliteMcpAuth(
	{
		origin: config.origin,
		secret: config.secret,
		signInEnabled: resolveSignInEnabled(),
	},
	authDb,
);
const app = createMcpApp({
	origin: config.origin,
	authRoutes: routes,
	verifier: createBetterAuthTokenVerifier(auth, config.origin),
	deps,
});
const pageAssets = loadPageAssets(config.pageAssetsDir);

serve({
	fetch: (request) => {
		const { pathname } = new URL(request.url);
		if (pathname.startsWith(ASSETS_PATH_PREFIX)) {
			return serveAsset(pageAssets, pathname);
		}
		return app(request);
	},
	hostname: "0.0.0.0",
	port: config.port,
});

// biome-ignore lint/plugin/no-logger-info: one boot line names the origin the server answers on
logger.info(
	{ origin: config.origin, port: config.port },
	"mcp server listening",
);
