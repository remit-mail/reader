import { AsyncLocalStorage } from "node:async_hooks";

export type LogBindings = Record<string, unknown>;

export const LOG_LEVELS = [
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
	"silent",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

type EmitLevel = Exclude<LogLevel, "silent">;

export const DEFAULT_LOG_LEVEL: LogLevel = "info";

export const isLogLevel = (value: string): value is LogLevel =>
	(LOG_LEVELS as readonly string[]).includes(value);

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

export interface JsonLoggerOptions {
	readonly level?: LogLevel;
	readonly service?: string;
	readonly write?: (line: string) => void;
}

const SEVERITY: Record<LogLevel, number> = {
	trace: 10,
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
	fatal: 60,
	silent: Number.POSITIVE_INFINITY,
};

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

/** The bindings of the innermost open scope, for a Logger implemented elsewhere. */
export const logContext = (): LogBindings => scope.getStore() ?? {};

const isBindings = (value: unknown): value is LogBindings =>
	typeof value === "object" && value !== null;

// The interface accepts (bindings, message) and (message, bindings).
export const normalizeLogArguments = (
	first: LogBindings | string,
	second?: LogBindings | string,
): [LogBindings, string] => {
	if (typeof first === "string") {
		return [isBindings(second) ? second : {}, first];
	}
	return [first, typeof second === "string" ? second : ""];
};

// Written by the writer itself, so a binding of the same name would be a second
// occurrence of the key on the line and every JSON parser takes the last one —
// a call-site field named `level` would silently retag the line. Dropped rather
// than renamed: a field the operator cannot rely on is worse than an absent one.
const RESERVED = new Set(["level", "time", "service", "msg"]);

// `error` carries an Error at most call sites in this repo; a bare Error spreads
// to nothing under JSON.stringify, which is how a stack trace disappears.
const ERROR_KEYS = new Set(["error", "err"]);

const serializeError = (error: Error): LogBindings => {
	const serialized: LogBindings = {
		type: error.constructor?.name ?? error.name,
		message: error.message,
		stack: error.stack,
	};
	for (const [key, value] of Object.entries(error)) {
		if (key in serialized) continue;
		serialized[key] = value instanceof Error ? serializeError(value) : value;
	}
	if (error.cause instanceof Error)
		serialized.cause = serializeError(error.cause);
	return serialized;
};

// A circular reference or a BigInt makes JSON.stringify throw, and a log call
// must never take the request down with it.
const safeReplacer = (): ((key: string, value: unknown) => unknown) => {
	const ancestors: unknown[] = [];
	return function replace(this: unknown, _key: string, value: unknown) {
		if (typeof value === "bigint") return value.toString();
		if (typeof value !== "object" || value === null) return value;
		while (ancestors.length > 0 && ancestors.at(-1) !== this) ancestors.pop();
		if (ancestors.includes(value)) return "[Circular]";
		ancestors.push(value);
		return value;
	};
};

const defaultWrite = (line: string): void => {
	console.log(line);
};

/**
 * One JSON object per line: `level` as a lowercase name, `time` as RFC 3339,
 * `service`, every binding at the top level, and `msg` always present. The field
 * contract is documented in deploy/vps/README.md under "Logs". Uses no platform
 * global, so it runs on Node and on Workers alike; the host supplies `write`.
 */
export const createJsonLogger = (options: JsonLoggerOptions = {}): Logger => {
	const threshold = SEVERITY[options.level ?? DEFAULT_LOG_LEVEL];
	const service = options.service ?? "remit";
	const write = options.write ?? defaultWrite;

	const build = (persistent: LogBindings): Logger => {
		const emit = (
			level: EmitLevel,
			first: LogBindings | string,
			second?: LogBindings | string,
		): void => {
			if (SEVERITY[level] < threshold) return;
			const [fields, msg] = normalizeLogArguments(first, second);
			const line: LogBindings = {
				level,
				time: new Date().toISOString(),
				service,
			};
			for (const [key, value] of Object.entries({
				...persistent,
				...scope.getStore(),
				...fields,
			})) {
				if (RESERVED.has(key)) continue;
				line[key] =
					ERROR_KEYS.has(key) && value instanceof Error
						? serializeError(value)
						: value;
			}
			line.msg = msg;
			write(JSON.stringify(line, safeReplacer()));
		};

		return {
			trace: (first: LogBindings | string, second?: LogBindings | string) =>
				emit("trace", first, second),
			debug: (first: LogBindings | string, second?: LogBindings | string) =>
				emit("debug", first, second),
			info: (first: LogBindings | string, second?: LogBindings | string) =>
				emit("info", first, second),
			warn: (first: LogBindings | string, second?: LogBindings | string) =>
				emit("warn", first, second),
			error: (first: LogBindings | string, second?: LogBindings | string) =>
				emit("error", first, second),
			fatal: (first: LogBindings | string, second?: LogBindings | string) =>
				emit("fatal", first, second),
			child: (bindings: LogBindings): Logger =>
				build({ ...persistent, ...bindings }),
			setBindings: (bindings: LogBindings): void => {
				Object.assign(persistent, bindings);
			},
		};
	};

	return build({});
};
