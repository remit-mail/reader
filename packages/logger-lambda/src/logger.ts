import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "aws-lambda";
import { pino, stdSerializers } from "pino";
import { recordHandlerOutcome } from "./metrics.js";

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

// Written by the writer itself, so a binding of the same name would be a second
// occurrence of the key on the line and every JSON parser takes the last one —
// a call-site field named `level` would silently retag the line. Dropped rather
// than renamed: a field the operator cannot rely on is worse than an absent one.
const RESERVED = ["level", "time", "service", "msg"] as const;

const withoutReserved = (fields: LogBindings): LogBindings => {
	let kept: LogBindings | undefined;
	for (const key of RESERVED) {
		if (!(key in fields)) continue;
		kept ??= { ...fields };
		delete kept[key];
	}
	return kept ?? fields;
};

// One JSON object per line on stdout: `level` as a lowercase name, `time` as
// RFC 3339, `service` naming the image, `msg` always present, and every binding
// at the top level. The field contract is documented in deploy/vps/README.md
// under "Logs" — log-shipping rules are written against these names.
//
// `error` carries an Error at most call sites in this repo, so it is serialised
// the way pino serialises `err`: a bare Error spreads to nothing, which is how a
// stack trace disappears from a worker failure line.
const root = pino({
	level,
	base: { service: process.env.REMIT_SERVICE_NAME ?? "remit" },
	timestamp: pino.stdTimeFunctions.isoTime,
	formatters: { level: (label: string) => ({ level: label }) },
	serializers: { error: stdSerializers.err },
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

// Bindings from a scope opened by withLogContext. A server handling requests
// concurrently cannot carry per-request fields on a shared logger instance:
// whichever request wrote last owns them until the next one overwrites them.
const scope = new AsyncLocalStorage<LogBindings>();

/**
 * Runs `fn` with `bindings` on every line any logger writes inside it,
 * including asynchronous continuations. Scopes nest: an inner call adds to the
 * bindings of the one it runs inside.
 */
export const withLogContext = <T>(bindings: LogBindings, fn: () => T): T =>
	scope.run({ ...scope.getStore(), ...bindings }, fn);

// Every binding is merged into one object here rather than handed to pino:
// pino's own child/setBindings append to a cached string it writes verbatim, so
// a shadowing key would appear twice on one line, and a per-request setBindings
// on a long-lived logger would grow that string without bound.
const createAdapter = (target: PinoLogger, persistent: LogBindings): Logger => {
	const emit = (
		level: EmitLevel,
		first: LogBindings | string,
		second?: LogBindings | string,
	): void => {
		const [fields, message] = normalize(first, second);
		target[level](
			withoutReserved({ ...persistent, ...scope.getStore(), ...fields }),
			message,
		);
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
			createAdapter(target, { ...persistent, ...bindings }),
		setBindings: (bindings: LogBindings): void => {
			Object.assign(persistent, bindings);
		},
	};
};

export const logger: Logger = createAdapter(root, {});

export const createLogger = (): Logger => createAdapter(root, {});

// The scope opens around the wrapper's own two lines, not just the handler:
// "Lambda invocation failed" is the line an operator correlates from, and it is
// written after the handler has already unwound, so a scope opened inside the
// handler no longer covers it. Everything the invocation writes — the wrapper's
// lines and the handler's — carries the same `requestId`.
export const withTelemetry = <TEvent, TResult>(
	handler: (event: TEvent, context: Context) => Promise<TResult>,
): ((event: TEvent, context: Context) => Promise<TResult>) => {
	return async (event: TEvent, context: Context): Promise<TResult> =>
		withLogContext({ requestId: context.awsRequestId }, async () => {
			logger.debug("Lambda invocation started", {
				functionName: context.functionName,
			});

			const start = Date.now();

			try {
				const result = await handler(event, context);
				recordHandlerOutcome({
					handler: context.functionName,
					outcome: "success",
					durationMs: Date.now() - start,
				});
				return result;
			} catch (err) {
				recordHandlerOutcome({
					handler: context.functionName,
					outcome: "failure",
					durationMs: Date.now() - start,
				});
				logger.error("Lambda invocation failed", { error: err });
				throw err;
			}
		});
};
