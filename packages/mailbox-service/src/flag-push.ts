import { randomUUID } from "node:crypto";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { IMessageFlagPushRepository } from "@remit/data-ports";
import { createMarkerSqsClient } from "./marker-sqs-client.js";

/**
 * Event the reconciler (imap-worker `handleFlagPush`) drains. Carries ONLY
 * our own message id + the flag field — never a UID and never the desired
 * operation (that lives on the marker, resolved fresh at push time, epic
 * #1281 invariant 1). The event stays valid across any amount of queue delay
 * or a later local flip of the SAME field (which replaces the marker before
 * this event is ever processed).
 */
export interface FlagPushEvent {
	type: "FLAG_PUSH";
	eventId: string;
	timestamp: number;
	accountId: string;
	accountConfigId: string;
	messageId: string;
	flagName: string;
}

export interface FlagPushLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: FlagPushLogger = {
	info: () => {},
	error: () => {},
};

export interface FlagPushConfig {
	markerService: IMessageFlagPushRepository;
	sqsQueueUrl: string;
	sqsEndpoint?: string;
	logger?: FlagPushLogger;
}

export type FlagPushOperationValue = "add" | "remove";

/**
 * Writes a pending flag-push marker and best-effort enqueues a wake-up hint
 * (issue #1273, epic #1281). Called AFTER the caller (`FlagQueueService`) has
 * already durably written the local `MessageFlag`/`ThreadMessage` state in
 * the SAME request — the user's intent is durable the moment `flip` writes
 * the marker, before the enqueue even runs.
 *
 * Mirrors `PlacementMoveService` (#1289)'s marker lifecycle, scoped per
 * (`messageId`, `flagName`) instead of per `messageId` — a message can carry
 * an independent pending read-state marker and pending star marker at once
 * (epic FAQ: "a flag flip replaces a pending flag flip", scoped per field).
 * `put` (not `create`) always resets the marker to `pending`, so a later flip
 * of the SAME field simply replaces the earlier marker — "later intent wins
 * locally".
 *
 * Unlike #1289's placement move (where an enqueue failure must propagate,
 * because nothing besides the marker+enqueue sequence has committed the
 * user's intent), the flag flip here is durable the instant the marker write
 * lands — the enqueue is purely a latency optimization so the push does not
 * have to wait for the next periodic sync tick. An enqueue failure is
 * therefore swallowed on purpose: it must never fail the caller's request.
 * It must also never be silent — logged with an `alert`-shaped entry so a
 * string of failures (SQS itself unhealthy) is operationally visible, same
 * convention as the enqueue this replaces (`flag-queue.ts`'s prior
 * `flag_sync_enqueue_failed`).
 */
export class FlagPushService {
	private markerService: IMessageFlagPushRepository;
	private sqs: SQSClient;
	private queueUrl: string;
	private log: FlagPushLogger;

	constructor(config: FlagPushConfig) {
		this.markerService = config.markerService;
		this.queueUrl = config.sqsQueueUrl;
		this.log = config.logger ?? noopLogger;
		this.sqs = createMarkerSqsClient(config.sqsQueueUrl, config.sqsEndpoint);
	}

	flip = async (params: {
		accountId: string;
		accountConfigId: string;
		messageId: string;
		mailboxId: string;
		flagName: string;
		operation: FlagPushOperationValue;
	}): Promise<void> => {
		const {
			accountId,
			accountConfigId,
			messageId,
			mailboxId,
			flagName,
			operation,
		} = params;

		await this.markerService.put({
			messageId,
			flagName,
			accountId,
			accountConfigId,
			mailboxId,
			operation,
		});

		await this.enqueueHint({ accountId, accountConfigId, messageId, flagName });
	};

	private enqueueHint = async (params: {
		accountId: string;
		accountConfigId: string;
		messageId: string;
		flagName: string;
	}): Promise<void> => {
		const event: FlagPushEvent = {
			type: "FLAG_PUSH",
			eventId: randomUUID(),
			timestamp: Date.now(),
			...params,
		};

		const useFifo = this.queueUrl.endsWith(".fifo");

		// The marker persisted in `flip` is the durable record — the queue,
		// per the issue's own words. This send is only a wake-up hint: a
		// queue-down failure must NOT fail the caller's flip (intent is
		// already durable) and must NOT be silent either (standing rule: our
		// infra failing is never a quiet blip). The periodic per-mailbox
		// drain (issue #1273) still finds and pushes the marker regardless.
		await this.sqs
			.send(
				new SendMessageCommand({
					QueueUrl: this.queueUrl,
					MessageBody: JSON.stringify(event),
					...(useFifo && {
						MessageGroupId: params.accountId,
						MessageDeduplicationId: event.eventId,
					}),
				}),
			)
			.then(async () => {
				// Only advance past `pending` once the hint is CONFIRMED sent — a
				// marker still `pending` is exactly the periodic drain's query
				// target (`sync-messages.ts`'s `drainPendingFlagPushes`), so a
				// failed send below must leave it there, never here.
				await this.markerService
					.updateState(params.messageId, params.flagName, "queued")
					.catch(async (error: unknown) => {
						// Fast-path race (review finding on #1292): the worker can
						// drain AND delete the marker before this transition runs —
						// SQS delivery + processing can outrun this .then(). The
						// enqueue itself already succeeded, so re-check whether the
						// marker still exists before treating this as an infra
						// failure: if it's already gone, the push already completed
						// and this is expected, routine — never the
						// flag_push_hint_enqueue_failed alarm shape. Any OTHER
						// failure (e.g. the re-check itself fails because the
						// backend is genuinely down) still propagates to the outer
						// catch below.
						const stillPending = await this.markerService.find(
							params.messageId,
							params.flagName,
						);
						if (!stillPending) {
							this.log.info(
								{ eventId: event.eventId, ...params },
								"Marker already drained before the queued-state transition (fast-path race, harmless)",
							);
							return;
						}
						throw error;
					});
				this.log.info(
					{ eventId: event.eventId, ...params },
					"Enqueued FLAG_PUSH wake-up hint",
				);
			})
			.catch((error: unknown) => {
				this.log.error(
					{
						alert: "flag_push_hint_enqueue_failed",
						eventId: event.eventId,
						...params,
						errorName: (error as { name?: string })?.name,
						errorCode:
							(error as { Code?: string })?.Code ??
							(error as { code?: string })?.code,
					},
					"Failed to enqueue FLAG_PUSH wake-up hint (marker persisted; the periodic sync tick will still drain it)",
				);
			});
	};
}
