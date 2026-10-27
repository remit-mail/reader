import { inspect } from "node:util";
import { createLogger, type Logger } from "@remit/logger";
import {
	queueNameFromEventSource,
	recordQueueEvent,
} from "@remit/logger-lambda/metrics";
import { installNodeLogger, withTelemetry } from "@remit/logger-lambda/node";
import type { SQSEvent, SQSHandler } from "aws-lambda";
import {
	type CascadeEntity,
	type CascadeServices,
	enumerateCascadeEntities,
} from "../cascade.js";
import { getCascadeServices } from "../config.js";
import {
	type DeletionCapabilities,
	getDeletionCapabilities,
} from "../deletion-capabilities.js";
import type {
	AccountDeleteFinalizeEvent,
	AccountFinalizeEvent,
} from "../events.js";
import { processAccountDataPurgeFinalize } from "./account-purge-finalize.js";

installNodeLogger();

export interface ProcessFinalizeDeps {
	capabilities?: DeletionCapabilities;
	cascadeServices?: CascadeServices;
}

const resolveDeps = async (
	deps: ProcessFinalizeDeps,
): Promise<{
	capabilities: DeletionCapabilities;
	services: CascadeServices;
}> => ({
	capabilities: deps.capabilities ?? (await getDeletionCapabilities()),
	services: deps.cascadeServices ?? (await getCascadeServices()),
});

/**
 * GDPR hard-delete: every row tied to the deleted AccountConfig is removed and
 * every stored object under `accounts/{accountConfigId}/` is purged. The
 * AccountConfig row itself is the LAST delete so that a mid-cascade replay still
 * sees the cascade-in-progress flag (`deletedAt` set, `isActive=false`, written
 * API-side) and re-runs cleanly. After a successful run nothing tied to the
 * AccountConfig persists.
 *
 * Step order (non-negotiable per #320):
 *   1. Content invalidation — runs FIRST so cached body parts cannot leak after
 *      the underlying objects are gone (a no-op where no CDN fronts content).
 *   2. Relational/DDB cascade delete in dependency order (children → parents).
 *   3. Storage prefix cleanup `accounts/{accountConfigId}/`.
 *   4. AccountConfig delete.
 *
 * Idempotency: every step is replay-safe. The cascade on a missing key is a
 * no-op, storage prefix delete on missing keys is a no-op, and invalidation is
 * always idempotent. No explicit "already deleted" pre-checks — they make
 * replays racier, not safer. Errors propagate so SQS retries the message;
 * eventually the DLQ alarm fires and an operator inspects the failure.
 */
export const processAccountFinalize = async (
	event: AccountDeleteFinalizeEvent,
	log: Logger,
	deps: ProcessFinalizeDeps = {},
): Promise<void> => {
	const { accountConfigId } = event;
	const { capabilities, services } = await resolveDeps(deps);

	// Validate every deploy-time precondition BEFORE the first destructive step,
	// so a missing var fails loud instead of deleting rows in the cascade and
	// only then erroring at the storage step.
	await capabilities.assertReady(log);

	// Step 1: content invalidation — first, so cached body parts cannot leak
	// after the underlying objects are gone.
	log.info(
		{ accountConfigId },
		"Invalidating cached content for erased account",
	);
	await capabilities.invalidateContent(accountConfigId, log);

	// Step 2: cascade delete (children → parents). The AccountConfig row is
	// excluded from the cascade plan and removed last, after storage.
	//
	// SQS is at-least-once: a successful cascade can be redelivered. After a
	// clean run the AccountConfig row is gone, so `describe()` throws
	// `NotFoundError` — that's the success signal, not a failure. Treat it as
	// "cascade already complete" and return cleanly. Any other error propagates
	// so SQS retries → DLQ.
	let entities: CascadeEntity[];
	try {
		const enumeration = await enumerateCascadeEntities(
			accountConfigId,
			services,
			log,
		);
		entities = enumeration.entities;
	} catch (error) {
		if ((error as { name?: string })?.name === "NotFoundError") {
			log.info(
				{ accountConfigId },
				"Cascade already complete (AccountConfig not found on replay) — no-op",
			);
			return;
		}
		throw error;
	}
	const cascadeEntities = entities.filter(
		(e) => e.entityType !== "AccountConfig",
	);
	await capabilities.cascadeDelete(cascadeEntities, log);

	// Step 3: storage prefix cleanup. Runs AFTER the cascade so a mid-cascade
	// replay always re-runs the (idempotent) storage step.
	await capabilities.deleteStoragePrefix(`accounts/${accountConfigId}/`, log);

	// Step 4: AccountConfig delete — the last write. The presence of an
	// AccountConfig row with `deletedAt` set is the cascade-in-progress flag;
	// removing the row is the only signal the cascade fully finished.
	await services.accountConfigService.delete(accountConfigId);
	log.info({ accountConfigId }, "AccountConfig deleted; cascade complete");
};

// ---------- SQS handler ----------

const log = createLogger();

export const handler: SQSHandler = withTelemetry(async (event: SQSEvent) => {
	const batchItemFailures: { itemIdentifier: string }[] = [];

	for (const record of event.Records) {
		const finalizeEvent: AccountFinalizeEvent = JSON.parse(record.body);
		log.info(
			{
				eventType: finalizeEvent.type,
				accountConfigId: finalizeEvent.accountConfigId,
			},
			"Processing account finalize event",
		);

		const start = Date.now();
		const work =
			finalizeEvent.type === "FinalizeAccountDataPurge"
				? resolveDeps({}).then((deps) =>
						processAccountDataPurgeFinalize(finalizeEvent, log, deps),
					)
				: processAccountFinalize(finalizeEvent, log);

		const failed = await work
			.then(() => false)
			.catch((error) => {
				log.error(
					{ error: inspect(error), messageId: record.messageId },
					"Account finalize event processing failed",
				);
				return true;
			});

		recordQueueEvent({
			queue: queueNameFromEventSource(record.eventSourceARN),
			eventType: finalizeEvent.type,
			outcome: failed ? "failure" : "success",
			durationMs: Date.now() - start,
		});

		if (failed) {
			batchItemFailures.push({ itemIdentifier: record.messageId });
		}
	}

	return { batchItemFailures };
});

export const finalizeHandler: SQSHandler = handler;
