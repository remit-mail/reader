import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { bootstrapQueues, loadQueuesConfig } from "./queues-config.js";
import { createSidecarServer, type SidecarLog } from "./server.js";
import { QueueStore } from "./store.js";

const log: SidecarLog = {
	info: (fields, message) =>
		process.stdout.write(
			`${JSON.stringify({ level: "info", message, ...fields })}\n`,
		),
	error: (fields, message) =>
		process.stderr.write(
			`${JSON.stringify({ level: "error", message, ...fields })}\n`,
		),
};

const port = Number(process.env.QUEUE_SIDECAR_PORT ?? "9324");
const host = process.env.QUEUE_SIDECAR_HOST ?? "0.0.0.0";
const dbPath = process.env.QUEUE_SIDECAR_DB ?? "/data/queue/queue.db";
const accountId = process.env.QUEUE_SIDECAR_ACCOUNT_ID ?? "000000000000";
const queuesConfigPath = process.env.QUEUE_SIDECAR_QUEUES_CONFIG;

mkdirSync(dirname(dbPath), { recursive: true });
const store = new QueueStore(dbPath);

if (queuesConfigPath) {
	const config = loadQueuesConfig(queuesConfigPath);
	bootstrapQueues(store, config);
	log.info(
		{ path: queuesConfigPath, queues: config.queues.length },
		"sidecar: queues bootstrapped",
	);
} else {
	log.info({}, "sidecar: no queues config; queues created on demand");
}

const server = createSidecarServer({ store, accountId, log });

server.listen(port, host, () => {
	log.info({ host, port, dbPath }, "sidecar: listening");
});

const shutdown = (signal: NodeJS.Signals): void => {
	log.info({ signal }, "sidecar: shutting down");
	server.close(() => {
		store.close();
		process.exit(0);
	});
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, shutdown);
}
