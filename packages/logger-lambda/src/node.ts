import { logger, withLogContext } from "@remit/logger";
import type { Context } from "aws-lambda";
import { recordHandlerOutcome } from "./metrics.js";

export { installNodeLogger } from "@remit/logger/node";

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
