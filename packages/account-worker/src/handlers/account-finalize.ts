import { inspect } from "node:util";
import { createLogger, type Logger } from "@remit/logger";
import {
	queueNameFromEventSource,
	recordQueueEvent,
} from "@remit/logger-lambda/metrics";
import { installNodeLogger, withTelemetry } from "@remit/logger-lambda/node";
import type { SQSEvent, SQSHandler } from "aws-lambda";
import type { CascadeServices } from "../cascade.js";
import { getCascadeServices } from "../config.js";
import {
	type DeletionCapabilities,
	getDeletionCapabilities,
} from "../deletion-capabilities.js";
import type {
	AccountDeleteFinalizeEvent,
	AccountFinalizeEvent,
} from "../events.js";
import { finalizeAccountDelete } from "./account-delete.js";
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

export const processAccountFinalize = async (
	event: AccountDeleteFinalizeEvent,
	log: Logger,
	deps: ProcessFinalizeDeps = {},
): Promise<void> => finalizeAccountDelete(event, log, await resolveDeps(deps));

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
