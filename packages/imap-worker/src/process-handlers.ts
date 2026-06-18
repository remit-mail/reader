import type { Logger } from "@remit/remit-logger-lambda";

/**
 * A worker that hits an unhandled rejection or uncaught exception is in an
 * unknown, possibly-corrupted state. Following let-it-crash, we log structured
 * and exit non-zero so the cluster primary restarts the worker cleanly rather
 * than letting it limp along.
 */
export const installCrashHandlers = (
	log: Logger,
	exit: (code: number) => void = process.exit,
): void => {
	process.on("unhandledRejection", (reason, promise) => {
		log.error(
			{ reason, promise: String(promise) },
			"Unhandled rejection, exiting worker",
		);
		exit(1);
	});

	process.on("uncaughtException", (err) => {
		log.error({ error: err }, "Uncaught exception, exiting worker");
		exit(1);
	});
};
