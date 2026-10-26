import { createLogger } from "@remit/logger";
import {
	queueNameFromEventSource,
	recordImapFailure,
	recordQueueEvent,
} from "@remit/logger-lambda/metrics";
import { installNodeLogger, withTelemetry } from "@remit/logger-lambda/node";
import type { SQSBatchResponse, SQSEvent, SQSHandler } from "aws-lambda";
import { env } from "expect-env";
import { isBodySyncEnabled } from "./body-sync-gate.js";
import type { WorkerEvent } from "./events.js";
import { imapFailureKind } from "./failure-kind.js";
import { lambdaProcessContext } from "./lambda-context.js";
import { processEvent } from "./processor.js";

installNodeLogger();

const log = createLogger();

const bodySyncParameterName = env.BODY_SYNC_ENABLED_PARAMETER_NAME;

const isPausedBodySync = async (event: WorkerEvent): Promise<boolean> =>
	event.type === "SYNC_MESSAGE_BODY" &&
	!(await isBodySyncEnabled(bodySyncParameterName, log));

/**
 * Parse SQS's `ApproximateReceiveCount` record attribute (1 on first
 * delivery). Missing/malformed defaults to 1 so a record with no attribute
 * (e.g. an older local harness) is treated as a first attempt rather than
 * skipping straight to retry-exhaustion handling.
 */
export const parseReceiveCount = (value: string | undefined): number => {
	const parsed = Number.parseInt(value ?? "1", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

export const handler: SQSHandler = withTelemetry(
	async (event: SQSEvent): Promise<SQSBatchResponse> => {
		const batchItemFailures: { itemIdentifier: string }[] = [];
		const ctx = await lambdaProcessContext(log);

		for (const record of event.Records) {
			const imapEvent: WorkerEvent = JSON.parse(record.body);
			const receiveCount = parseReceiveCount(
				record.attributes?.ApproximateReceiveCount,
			);
			log.info(
				{
					eventType: imapEvent.type,
					eventId: "eventId" in imapEvent ? imapEvent.eventId : undefined,
					receiveCount,
				},
				"Processing event",
			);

			if (await isPausedBodySync(imapEvent)) {
				log.info(
					{ eventType: imapEvent.type, messageId: record.messageId },
					"Body sync paused via SSM toggle, acking and skipping",
				);
				continue;
			}

			const queue = queueNameFromEventSource(record.eventSourceARN);
			const opStart = Date.now();
			const failed = await processEvent(imapEvent, ctx, receiveCount)
				.then(() => {
					recordQueueEvent({
						queue,
						eventType: imapEvent.type,
						outcome: "success",
						durationMs: Date.now() - opStart,
					});
					return false;
				})
				.catch((error) => {
					log.error(
						{ error, messageId: record.messageId },
						"Event processing failed",
					);
					recordQueueEvent({
						queue,
						eventType: imapEvent.type,
						outcome: "failure",
						durationMs: Date.now() - opStart,
					});
					recordImapFailure(imapEvent.type, imapFailureKind(error));
					return true;
				});

			if (failed) {
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	},
);
