import {
	createJsonLogger,
	type EmitLevel,
	type LogBindings,
	type Logger,
	levelMethods,
	normalizeLogArguments,
} from "./logger.js";

let installed: Logger = createJsonLogger();

/**
 * Plugs the implementation every `logger` and `createLogger()` handle writes
 * through. The composition root calls it once: the Lambda and Node entry points
 * install the Node adapter from `@remit/logger-lambda/node`, a Workers host its
 * own. Until then the handles write the platform-neutral JSON line to the
 * console at `info`.
 */
export const setLogger = (next: Logger): void => {
	installed = next;
};

// The implementation is looked up on every call, not captured, so a module that
// takes a handle at import time still writes through whatever the composition
// root installs afterwards.
const handle = (persistent: LogBindings): Logger => {
	const emit = (
		level: EmitLevel,
		first: LogBindings | string,
		second?: LogBindings | string,
	): void => {
		const [fields, msg] = normalizeLogArguments(first, second);
		const target =
			Object.keys(persistent).length === 0
				? installed
				: installed.child(persistent);
		target[level](fields, msg);
	};

	return {
		...levelMethods(emit),
		child: (bindings: LogBindings): Logger =>
			handle({ ...persistent, ...bindings }),
		setBindings: (bindings: LogBindings): void => {
			Object.assign(persistent, bindings);
		},
	};
};

/** The shared handle. */
export const logger: Logger = handle({});

/** A handle of its own, so bindings set on it stay off every other one. */
export const createLogger = (): Logger => handle({});
