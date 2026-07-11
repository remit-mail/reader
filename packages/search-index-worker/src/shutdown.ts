export interface RunningConsumer {
	stop(): Promise<void>;
}

export interface ShutdownOptions {
	timeoutMs: number;
	exit: (code: number) => void;
	onError?: (error: unknown) => void;
}

/**
 * Race a clean `consumer.stop()` against a hard deadline, then exit regardless.
 *
 * `stop()` awaits the SQS long-poll loop; under a saturated event loop that can
 * hang. A shutdown that never exits leaves the process ignoring SIGTERM and
 * orphaning to init still burning CPU (issue #1171), so the deadline
 * force-exits even when `stop()` never settles.
 */
export const runShutdown = (
	consumer: RunningConsumer,
	options: ShutdownOptions,
): void => {
	const { timeoutMs, exit, onError } = options;

	const forceExit = setTimeout(() => exit(1), timeoutMs);
	forceExit.unref();

	consumer
		.stop()
		.then(() => {
			clearTimeout(forceExit);
			exit(0);
		})
		.catch((error: unknown) => {
			clearTimeout(forceExit);
			onError?.(error);
			exit(1);
		});
};
