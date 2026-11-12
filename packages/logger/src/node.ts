import { setLogger } from "./handle.js";
import {
	createJsonLogger,
	DEFAULT_LOG_LEVEL,
	isLogLevel,
	LOG_LEVELS,
} from "./logger.js";

/**
 * Plugs the Node host's logger into every `@remit/logger` handle: the
 * platform-neutral JSON line, written synchronously to stdout, at the level
 * `LOG_LEVEL` names and under the service `REMIT_SERVICE_NAME` names. Every
 * Node entry point calls it once at startup. A level nobody can spell is worth
 * one line rather than a crashed container: the operator asked for something and
 * did not get it, and every other line still arrives.
 */
export const installNodeLogger = (): void => {
	const requested = process.env.LOG_LEVEL?.trim().toLowerCase();
	const level =
		requested && isLogLevel(requested) ? requested : DEFAULT_LOG_LEVEL;
	const log = createJsonLogger({
		level,
		service: process.env.REMIT_SERVICE_NAME ?? "remit",
		write: (line) => {
			process.stdout.write(`${line}\n`);
		},
	});
	setLogger(log);
	if (requested && requested !== level) {
		log.warn(
			{ configured: requested, expected: LOG_LEVELS.join(", ") },
			`LOG_LEVEL is not a level name; logging at ${level}`,
		);
	}
};
