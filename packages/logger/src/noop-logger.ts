import type { Logger } from "./logger.js";

export const noopLogger: Logger = Object.freeze({
	trace: () => {},
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	child: () => noopLogger,
	setBindings: () => {},
});
