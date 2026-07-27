/**
 * The same JSON-lines field shape every other service writes (see
 * deploy/vps/README.md, "Logs"), written by hand.
 *
 * The checker depends on nothing, which is what makes it the container most
 * likely to still be running when the rest of the stack is not, and a logger is
 * not the reason to change that. The queue sidecar makes the same trade for the
 * same reason.
 *
 * Everything goes to stderr, including `info`. Stdout is the exec seam's
 * output (see report.ts): a log line landing in it would corrupt what
 * `remit doctor` parses.
 */
export interface Log {
	/** Routine traces — the per-check verdict line. Dropped at the default level. */
	debug(fields: Record<string, unknown>, msg: string): void;
	/** Startup, and an alert actually sent. Rare and worth a line. */
	info(fields: Record<string, unknown>, msg: string): void;
	error(fields: Record<string, unknown>, msg: string): void;
}

type Level = "debug" | "info" | "error";

const service = process.env.REMIT_SERVICE_NAME ?? "doctor";

const ORDER: readonly Level[] = ["debug", "info", "error"];

// The same LOG_LEVEL every other service reads. A value that is not a level
// leaves the threshold at info rather than silencing the container.
const threshold = ORDER.indexOf(
	(process.env.LOG_LEVEL?.trim().toLowerCase() as Level) ?? "info",
);

const write = (
	level: Level,
	fields: Record<string, unknown>,
	msg: string,
): void => {
	if (ORDER.indexOf(level) < (threshold === -1 ? 1 : threshold)) return;
	process.stderr.write(
		`${JSON.stringify({
			level,
			time: new Date().toISOString(),
			service,
			...fields,
			msg,
		})}\n`,
	);
};

export const log: Log = {
	debug: (fields, msg) => write("debug", fields, msg),
	info: (fields, msg) => write("info", fields, msg),
	error: (fields, msg) => write("error", fields, msg),
};

export const describeError = (error: unknown): string =>
	error instanceof Error ? (error.stack ?? error.message) : String(error);
