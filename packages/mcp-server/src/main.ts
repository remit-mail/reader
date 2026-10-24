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
	SyncWarningService,
} from "@remit/mailbox-service";
import { createStorageService } from "@remit/storage-service/s3";
import { createMcpApp } from "./app.js";
import {
	createBetterAuthTokenVerifier,
	createMcpAuth,
} from "./auth/authorization-server.js";
import { openMcpAuthDatabases } from "./auth/database.js";
import { createRemitPasswordAuthenticator } from "./auth/user-authenticator.js";
import { resolveMcpServerConfig } from "./config.js";
import type { McpDeps } from "./deps.js";

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
};

const authDatabases = openMcpAuthDatabases(config.sqliteDbPath);
const auth = createMcpAuth({
	origin: config.origin,
	secret: config.secret,
	db: authDatabases.db,
	users: createRemitPasswordAuthenticator(authDatabases.readonlyDb),
});

serve({
	fetch: createMcpApp({
		origin: config.origin,
		auth,
		verifier: createBetterAuthTokenVerifier(auth, config.origin),
		deps,
	}),
	hostname: "0.0.0.0",
	port: config.port,
});

// biome-ignore lint/plugin/no-logger-info: one boot line names the origin the server answers on
logger.info(
	{ origin: config.origin, port: config.port },
	"mcp server listening",
);
