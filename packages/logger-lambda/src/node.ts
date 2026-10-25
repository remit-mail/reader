import {
	createJsonLogger,
	DEFAULT_LOG_LEVEL,
	isLogLevel,
	LOG_LEVELS,
	logger,
	setLogger,
	withLogContext,
} from "@remit/logger";
import type { Context } from "aws-lambda";
import { recordHandlerOutcome } from "./metrics.js";

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
