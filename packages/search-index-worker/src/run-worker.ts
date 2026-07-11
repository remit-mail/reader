import { createLogger } from "@remit/logger-lambda";
import { startSqsConsumer } from "./consumer.js";
import { getServices } from "./services.js";
import { runShutdown } from "./shutdown.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;
const log = createLogger();

const main = async (): Promise<void> => {
	const services = await getServices();
	const consumer = startSqsConsumer({ services, logger: log });

	const shutdown = (): void =>
		runShutdown(consumer, {
			timeoutMs: SHUTDOWN_TIMEOUT_MS,
			exit: (code) => process.exit(code),
			onError: (error) =>
				log.error("shutdown failed", { error: String(error) }),
		});
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	log.info("search-index-worker consumer started");
};

await main();
