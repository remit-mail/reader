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
	sqsFanoutQueues,
} from "../config.js";
import {
	type DeletionCapabilities,
	getDeletionCapabilities,
} from "../deletion-capabilities.js";
import type {
	AccountDeleteEvent,
	AccountFanoutEvent,
	AccountFinalizeEvent,
} from "../events.js";
import { processAccountExport } from "./account-export.js";
import { processAccountDataPurge } from "./account-purge.js";
import { processOrganizeJob } from "./organize-job.js";
import { processSenderCategoryBackApply } from "./sender-category-backapply.js";

installNodeLogger();

export interface ProcessAccountFanoutDeps {
	queues: FanoutQueues;
	services?: CascadeServices;
	signOut?: DeletionCapabilities["signOut"];
}

/**
 * Fanout step of the account-deletion cascade. Signs the user out and
 * enqueues the finalize step. Throws on any non-swallowable error so SQS partial batch-failure
 * retries the whole record.
 */
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
		await processAccountExport(event, log);
		return;
	}

	if (event.type === "OrganizeJob") {
		await processOrganizeJob(event, log);
		return;
	}

	if (event.type === "SenderCategoryBackApply") {
		await processSenderCategoryBackApply(event, log);
		return;
	}

	await processAccountDelete(event, log, services, deps);
};

const processAccountDelete = async (
	event: AccountDeleteEvent,
	log: Logger,
	services: CascadeServices,
	deps: ProcessAccountFanoutDeps,
): Promise<void> => {
	const { accountConfigId } = event;
	const signOut = deps.signOut ?? (await getDeletionCapabilities()).signOut;
	const { accountFinalize } = deps.queues;

	const accountConfig =
		await services.accountConfigService.get(accountConfigId);
	const userId = accountConfig.userId;

	await signOut(userId, log);

	const finalizeEvent: AccountFinalizeEvent = {
		type: "FinalizeAccountDelete",
		accountConfigId,
	};
	await accountFinalize.send({ body: finalizeEvent });
	log.info({ accountConfigId }, "Enqueued finalize event");
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
