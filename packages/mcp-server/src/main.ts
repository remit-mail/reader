import { setTimeout as sleep } from "node:timers/promises";
import { serve } from "@hono/node-server";
import { resolveSignInEnabled } from "@remit/auth-service/verifier";
import { getClient } from "@remit/backend/client";
import {
	createJsonLogger,
	DEFAULT_LOG_LEVEL,
	isLogLevel,
	LOG_LEVELS,
	logger,
	setLogger,
} from "@remit/logger";
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
import { ASSETS_PATH_PREFIX, serveAsset } from "./pages/assets.js";
import { loadPageAssets } from "./pages/load-assets.js";

const requestedLevel = process.env.LOG_LEVEL?.trim().toLowerCase();
const level =
	requestedLevel && isLogLevel(requestedLevel)
		? requestedLevel
		: DEFAULT_LOG_LEVEL;
setLogger(
	createJsonLogger({
		level,
		service: process.env.REMIT_SERVICE_NAME ?? "remit",
		write: (line) => {
			process.stdout.write(`${line}\n`);
		},
	}),
);
if (requestedLevel && requestedLevel !== level) {
	logger.warn(
		{ configured: requestedLevel, expected: LOG_LEVELS.join(", ") },
		`LOG_LEVEL is not a level name; logging at ${level}`,
	);
}

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
