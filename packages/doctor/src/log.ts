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
 *
 * The threshold is set once at startup from `DOCTOR_LOG_LEVEL`, not read from
 * the environment here. The compose service passes `DOCTOR_*` variables and
 * nothing else — deliberately, so no application secret can arrive in this
 * container — which means a plain `LOG_LEVEL` could never reach it and the
 * per-check verdict line could never be turned on.
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

const DEFAULT_THRESHOLD = ORDER.indexOf("info");

let threshold = DEFAULT_THRESHOLD;

/**
 * A value that is not a level name leaves the threshold at `info` rather than
 * silencing the container: a typo must not turn the log off.
 */
export const setLogLevel = (level: string | undefined): void => {
	const wanted = ORDER.indexOf(level?.trim().toLowerCase() as Level);
	threshold = wanted === -1 ? DEFAULT_THRESHOLD : wanted;
};

const write = (
	level: Level,
	fields: Record<string, unknown>,
	msg: string,
): void => {
	if (ORDER.indexOf(level) < threshold) return;
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
