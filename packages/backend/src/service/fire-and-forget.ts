import { inspect } from "node:util";
import { logger } from "@remit/remit-logger-lambda";

type StructuredLog = (fields: Record<string, unknown>, message: string) => void;

export interface FireAndForgetLogger {
	error: StructuredLog;
}

export interface FireAndForgetContext {
	/**
	 * Stable discriminator for the originating call site (e.g. `"config_load"`,
	 * `"account_create"`). Surfaces on the log line as `source` so a CloudWatch
	 * metric filter / alarm can attribute a leak to its origin.
	 */
	source: string;
	/**
	 * Message logged when the background work rejects. Should describe the work
	 * and reassure that the failure is contained (e.g. "...best-effort").
	 */
	message: string;
	/**
	 * Identifiers carried onto the structured error line (accountId,
	 * accountConfigId, …) so a failure is traceable without a stack dive.
	 */
	ids?: Record<string, unknown>;
	logger?: FireAndForgetLogger;
}

/**
 * Run unawaited background work that MUST NOT be able to fail the request that
 * spawned it.
 *
 * The dev/Lambda runtime shares one event loop across concurrent requests, so a
 * rejection escaping an unawaited background promise (a `void trigger()`) lands
 * on whatever request happens to be in flight when the deferred work finally
 * fails — turning an unrelated READ into a spurious 500. That is exactly how an
 * unreachable SQS queue 500'd `/mailboxes`, `/threads`, `/outbox` and `/config`.
 *
 * This helper is the single containment point: it awaits the work inside a
 * try/catch, logs every rejection LOUDLY with the alertable structured fields
 * (`alert: "sync_trigger_failed"`, `source`, the SDK error name/code, the caller
 * ids), and ALWAYS resolves to void. Callers `void fireAndForget(...)` with no
 * chance of an unhandled rejection escaping. Routing all fire-and-forget sites
 * through here keeps the containment from regressing one handler at a time.
 *
 * Use this ONLY for genuine side effects whose failure must not change the
 * response. A failure the caller is responsible for (the real DynamoDB read, an
 * enqueue that IS the request's purpose) must still propagate and 500.
 */
export const fireAndForget = async (
	work: () => Promise<unknown>,
	context: FireAndForgetContext,
): Promise<void> => {
	try {
		await work();
	} catch (error: unknown) {
		const log = context.logger ?? logger;
		log.error(
			{
				alert: "sync_trigger_failed",
				source: context.source,
				...context.ids,
				errorName: (error as { name?: string })?.name,
				errorCode:
					(error as { Code?: string })?.Code ??
					(error as { code?: string })?.code,
				error: inspect(error),
			},
			context.message,
		);
	}
};
