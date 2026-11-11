import { setTimeout as sleep } from "node:timers/promises";
import { serve } from "@hono/node-server";
import { resolveSignInEnabled } from "@remit/auth-service/verifier";
import { getClient } from "@remit/backend/client";
import { logger } from "@remit/logger";
import { installNodeLogger } from "@remit/logger-lambda/node";
import { createMcpApp } from "./app.js";
import {
	createBetterAuthTokenVerifier,
	createMcpAuth,
	createMcpAuthRoutes,
} from "./auth/authorization-server.js";
import { openMcpAuthDatabase } from "./auth/database.js";
import { resolveMcpServerConfig } from "./config.js";
import { mcpDepsOf } from "./deps.js";
import { ASSETS_PATH_PREFIX, serveAsset } from "./pages/assets.js";
import { loadPageAssets } from "./pages/load-assets.js";

installNodeLogger();

const FOLDER_SETTLE_TIMEOUT_MS = 20_000;
const FOLDER_POLL_INTERVAL_MS = 500;

const config = resolveMcpServerConfig();

const client = await getClient();
const deps = mcpDepsOf(client, {
	logger,
	settle: {
		settleTimeoutMs: FOLDER_SETTLE_TIMEOUT_MS,
		pollIntervalMs: FOLDER_POLL_INTERVAL_MS,
		sleep,
	},
});

const auth = createMcpAuth({
	origin: config.origin,
	secret: config.secret,
	db: openMcpAuthDatabase(config.databases.app).db,
	signInEnabled: resolveSignInEnabled(),
});
const app = createMcpApp({
	origin: config.origin,
	authRoutes: createMcpAuthRoutes(auth),
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
