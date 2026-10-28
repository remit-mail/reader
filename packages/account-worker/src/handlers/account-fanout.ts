import { getClient } from "@remit/backend/client";
import { createLogger, type Logger } from "@remit/logger";
import {
	queueNameFromEventSource,
	recordQueueEvent,
} from "@remit/logger-lambda/metrics";
import { installNodeLogger, withTelemetry } from "@remit/logger-lambda/node";
import type { SQSBatchResponse, SQSEvent, SQSHandler } from "aws-lambda";
import type { CascadeServices } from "../cascade.js";
import {
	type FanoutQueues,
	getCascadeServices,
	getStorageService,
	sqsFanoutQueues,
} from "../config.js";
import {
	type DeletionCapabilities,
	getDeletionCapabilities,
} from "../deletion-capabilities.js";
import type { AccountFanoutEvent } from "../events.js";
import { processAccountFanoutEvent } from "../process.js";
import { processAccountDelete } from "./account-delete.js";
import { processAccountExport } from "./account-export.js";
import { processAccountDataPurge } from "./account-purge.js";

installNodeLogger();

export interface ProcessAccountFanoutDeps {
	queues: FanoutQueues;
	services?: CascadeServices;
	signOut?: DeletionCapabilities["signOut"];
}

export const processAccountFanout = async (
	event: AccountFanoutEvent,
	log: Logger,
	deps: ProcessAccountFanoutDeps,
): Promise<void> => {
	const services = deps.services ?? (await getCascadeServices());

	if (event.type === "AccountDataPurge") {
		await processAccountDataPurge(event, log, {
			services,
			queue: deps.queues.accountPurgeDelete,
		});
		return;
	}

	if (event.type === "AccountExport") {
		await processAccountExport(event, log, {
			services,
			storageService: getStorageService(),
		});
		return;
	}

	if (
		event.type === "OrganizeJob" ||
		event.type === "SenderCategoryBackApply"
	) {
		await processAccountFanoutEvent(event, { client: await getClient() });
		return;
	}

	await processAccountDelete(event, log, {
		services,
		signOut: deps.signOut ?? (await getDeletionCapabilities()).signOut,
		enqueueFinalize: (finalizeEvent) =>
			deps.queues.accountFinalize.send({ body: finalizeEvent }),
	});
};

const log = createLogger();

let fanoutQueues: FanoutQueues | null = null;

const composedQueues = (): FanoutQueues => {
	fanoutQueues ??= sqsFanoutQueues();
	return fanoutQueues;
};

export const handler: SQSHandler = withTelemetry(
	async (event: SQSEvent): Promise<SQSBatchResponse> => {
		const batchItemFailures: { itemIdentifier: string }[] = [];

		for (const record of event.Records) {
			const fanoutEvent: AccountFanoutEvent = JSON.parse(record.body);
			log.info(
				{
					eventType: fanoutEvent.type,
					accountConfigId: fanoutEvent.accountConfigId,
				},
				"Processing account fanout event",
			);

			const start = Date.now();
			const failed = await processAccountFanout(fanoutEvent, log, {
				queues: composedQueues(),
			})
				.then(() => false)
				.catch((error) => {
					log.error(
						{ error, messageId: record.messageId },
						"Account fanout event processing failed",
					);
					return true;
				});

			recordQueueEvent({
				queue: queueNameFromEventSource(record.eventSourceARN),
				eventType: fanoutEvent.type,
				outcome: failed ? "failure" : "success",
				durationMs: Date.now() - start,
			});

			if (failed) {
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	},
);
