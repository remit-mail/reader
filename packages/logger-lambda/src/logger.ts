import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import type { Context } from "aws-lambda";
import { pino } from "pino";

type LogBindings = Record<string, unknown>;

type EmitLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVELS = [
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
	"silent",
] as const;

const DEFAULT_LEVEL = "info";

const isLevel = (value: string): boolean =>
	(LEVELS as readonly string[]).includes(value);

const requestedLevel = process.env.LOG_LEVEL?.trim().toLowerCase();

const level =
	requestedLevel && isLevel(requestedLevel) ? requestedLevel : DEFAULT_LEVEL;

const isBindings = (value: unknown): value is LogBindings =>
	typeof value === "object" && value !== null;

// One JSON object per line on stdout: `level` as a lowercase name, `time` as
// RFC 3339, `service` naming the image, `msg` always present, and every binding
// at the top level. The field contract is documented in deploy/vps/README.md
// under "Logs" — log-shipping rules are written against these names.
const root = pino({
	level,
	base: { service: process.env.REMIT_SERVICE_NAME ?? "remit" },
	timestamp: pino.stdTimeFunctions.isoTime,
	formatters: { level: (label: string) => ({ level: label }) },
});

type PinoLogger = typeof root;

// A level nobody can spell is worth one line rather than a crashed container:
// the operator asked for something and did not get it, and every other line
// still arrives.
if (requestedLevel && requestedLevel !== level) {
	root.warn(
		{ configured: requestedLevel, expected: LEVELS.join(", ") },
		`LOG_LEVEL is not a level name; logging at ${level}`,
	);
}

// The interface accepts (bindings, message) and (message, bindings); pino reads
// (bindings, message) only, and treats an object after a string message as a
// format argument. Normalising here is what keeps both call shapes working.
const normalize = (
	first: LogBindings | string,
	second?: LogBindings | string,
): [LogBindings, string] => {
	if (typeof first === "string") {
		return [isBindings(second) ? second : {}, first];
	}
	return [first, typeof second === "string" ? second : ""];
};

export interface Logger {
	trace(obj: LogBindings, msg?: string): void;
	trace(msg: string, obj?: LogBindings): void;
	debug(obj: LogBindings, msg?: string): void;
	debug(msg: string, obj?: LogBindings): void;
	info(obj: LogBindings, msg?: string): void;
	info(msg: string, obj?: LogBindings): void;
	warn(obj: LogBindings, msg?: string): void;
	warn(msg: string, obj?: LogBindings): void;
	error(obj: LogBindings, msg?: string): void;
	error(msg: string, obj?: LogBindings): void;
	fatal(obj: LogBindings, msg?: string): void;
	fatal(msg: string, obj?: LogBindings): void;
	child(bindings: LogBindings): Logger;
	setBindings(bindings: LogBindings): void;
}

// `persistent` is merged into every line and mutated in place by setBindings,
// rather than handed to pino's own setBindings: pino appends to a cached
// bindings string, so a per-request call on a long-lived logger would repeat
// the key on every later line and grow without bound.
const createAdapter = (target: PinoLogger, persistent: LogBindings): Logger => {
	const emit = (
		level: EmitLevel,
		first: LogBindings | string,
		second?: LogBindings | string,
	): void => {
		const [fields, message] = normalize(first, second);
		target[level]({ ...persistent, ...fields }, message);
	};

	return {
		trace: (first: LogBindings | string, second?: LogBindings | string): void =>
			emit("trace", first, second),
		debug: (first: LogBindings | string, second?: LogBindings | string): void =>
			emit("debug", first, second),
		info: (first: LogBindings | string, second?: LogBindings | string): void =>
			emit("info", first, second),
		warn: (first: LogBindings | string, second?: LogBindings | string): void =>
			emit("warn", first, second),
		error: (first: LogBindings | string, second?: LogBindings | string): void =>
			emit("error", first, second),
		fatal: (first: LogBindings | string, second?: LogBindings | string): void =>
			emit("fatal", first, second),
		child: (bindings: LogBindings): Logger =>
			createAdapter(target.child({ ...persistent, ...bindings }), {}),
		setBindings: (bindings: LogBindings): void => {
			Object.assign(persistent, bindings);
		},
	};
};

export const logger: Logger = createAdapter(root, {});

export const metrics = new Metrics({
	namespace: process.env.POWERTOOLS_METRICS_NAMESPACE ?? "Remit",
	serviceName: process.env.POWERTOOLS_SERVICE_NAME ?? "remit",
});

export const createLogger = (): Logger => createAdapter(root, {});

export const withTelemetry = <TEvent, TResult>(
	handler: (event: TEvent, context: Context) => Promise<TResult>,
): ((event: TEvent, context: Context) => Promise<TResult>) => {
	return async (event: TEvent, context: Context): Promise<TResult> => {
		logger.debug("Lambda invocation started", {
			functionName: context.functionName,
		});

		metrics.captureColdStartMetric();

		const start = Date.now();

		try {
			const result = await handler(event, context);
			const duration = Date.now() - start;

			metrics.addMetric("invocationCount", MetricUnit.Count, 1);
			metrics.addMetric("invocationLatency", MetricUnit.Milliseconds, duration);

			return result;
		} catch (err) {
			metrics.addMetric("errorCount", MetricUnit.Count, 1);
			logger.error("Lambda invocation failed", { error: String(err) });
			throw err;
		} finally {
			metrics.publishStoredMetrics();
		}
	};
};
