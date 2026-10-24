import {
	createJsonLogger,
	DEFAULT_LOG_LEVEL,
	isLogLevel,
	LOG_LEVELS,
	type Logger,
	logger,
	setLogger,
	withLogContext,
} from "@remit/logger";
import type { Context } from "aws-lambda";
import { recordHandlerOutcome } from "./metrics.js";

/**
 * The Node host's logger: the platform-neutral JSON line from `@remit/logger`,
 * written synchronously to stdout, at the level `LOG_LEVEL` names and under the
 * service `REMIT_SERVICE_NAME` names. A level nobody can spell is worth one line
 * rather than a crashed container: the operator asked for something and did not
 * get it, and every other line still arrives.
 */
export const nodeLogger = (): Logger => {
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
	if (requested && requested !== level) {
		log.warn(
			{ configured: requested, expected: LOG_LEVELS.join(", ") },
			`LOG_LEVEL is not a level name; logging at ${level}`,
		);
	}
	return log;
};

let installed = false;

/** Plugs `nodeLogger()` into every `@remit/logger` handle, once per process. */
export const installNodeLogger = (): void => {
	if (installed) return;
	installed = true;
	setLogger(nodeLogger());
};

// The scope opens around the wrapper's own two lines, not just the handler:
// "Lambda invocation failed" is the line an operator correlates from, and it is
// written after the handler has already unwound, so a scope opened inside the
// handler no longer covers it. Everything the invocation writes — the wrapper's
// lines and the handler's — carries the same `requestId`.
//
// Wrapping a handler is what makes a module a Lambda entry point, so this is
// where the Node logger is installed.
export const withTelemetry = <TEvent, TResult>(
	handler: (event: TEvent, context: Context) => Promise<TResult>,
): ((event: TEvent, context: Context) => Promise<TResult>) => {
	installNodeLogger();
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
