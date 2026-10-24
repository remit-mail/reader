import { serve } from "@hono/node-server";
import {
	createSqliteDatabase,
	createSqliteRepositories,
	messageDataSchema,
} from "@remit/drizzle-service";
import { logger } from "@remit/logger-lambda";
import {
	BodySyncQueueService,
	BodySyncService,
	MailboxQueueService,
	SyncWarningService,
} from "@remit/mailbox-service";
import { createStorageService } from "@remit/storage-service/s3";
import { createMcpApp } from "./app.js";
import {
	createBetterAuthTokenVerifier,
	createMcpAuth,
	createMcpAuthRoutes,
} from "./auth/authorization-server.js";
import { openMcpAuthDatabase } from "./auth/database.js";
import { resolveMcpServerConfig } from "./config.js";
import type { McpDeps } from "./deps.js";
import { loadPageAssets } from "./pages/assets.js";

const FOLDER_SETTLE_TIMEOUT_MS = 20_000;
const FOLDER_POLL_INTERVAL_MS = 500;

const config = resolveMcpServerConfig();

const { db } = await createSqliteDatabase(messageDataSchema, {
	filename: config.sqliteDbPath,
});
const repositories = createSqliteRepositories(db);
const storage = createStorageService();

const deps: McpDeps = {
	account: repositories.account,
	mailbox: repositories.mailbox,
	message: repositories.message,
	threadMessage: repositories.threadMessage,
	filter: repositories.filter,
	organizeJobRequest: repositories.organizeJobRequest,
	storage,
	bodySync: new BodySyncService(
		repositories.message,
		storage,
		repositories.threadMessage,
		repositories.address,
		repositories.envelope,
		new SyncWarningService(repositories.syncWarning),
		logger,
	),
	bodySyncQueue: config.bodySyncQueueUrl
		? new BodySyncQueueService({ sqsQueueUrl: config.bodySyncQueueUrl, logger })
		: undefined,
	logger,
	folders: {
		mailboxQueue: new MailboxQueueService({
			mailboxService: repositories.mailbox,
			sqsQueueUrl: config.mailboxQueueUrl,
			logger,
		}),
		settleTimeoutMs: FOLDER_SETTLE_TIMEOUT_MS,
		pollIntervalMs: FOLDER_POLL_INTERVAL_MS,
	},
	filters: { organizeQueueUrl: config.organizeQueueUrl, logger },
};

const auth = createMcpAuth({
	origin: config.origin,
	secret: config.secret,
	db: openMcpAuthDatabase(config.sqliteDbPath).db,
});
const app = createMcpApp({
	origin: config.origin,
	authRoutes: createMcpAuthRoutes(auth),
	verifier: createBetterAuthTokenVerifier(auth, config.origin),
	deps,
	pageAssets: loadPageAssets(config.pageAssetsDir),
});

serve({
	fetch: app,
	hostname: "0.0.0.0",
	port: config.port,
});

// biome-ignore lint/plugin/no-logger-info: one boot line names the origin the server answers on
logger.info(
	{ origin: config.origin, port: config.port },
	"mcp server listening",
);
