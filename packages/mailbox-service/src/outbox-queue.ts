import { randomUUID } from "node:crypto";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type {
	IAccountRepository,
	IOutboxMessageRepository,
	OutboxMessageItem,
} from "@remit/data-ports";
import { BadRequestError, ConflictError } from "@remit/data-ports/errors";
import { OutboxMessageStatus } from "@remit/domain-enums";
import { createQueueProducer } from "@remit/sqs-client/producer";
import type { OutboxAttachmentService } from "./outbox-attachment.js";
import { isOpenForWork } from "./outbox-status.js";

interface SendMessageEvent {
	type: "SEND_MESSAGE";
	eventId: string;
	timestamp: number;
	accountId: string;
	outboxMessageId: string;
}

export interface OutboxQueueLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: OutboxQueueLogger = {
	info: () => {},
	error: () => {},
};

export interface OutboxQueueConfig {
	outboxMessageService: IOutboxMessageRepository;
	outboxAttachmentService: OutboxAttachmentService;
	accountService: IAccountRepository;
	sqsSmtpQueueUrl: string;
	sqsEndpoint?: string;
	sqsClient?: SQSClient;
	logger?: OutboxQueueLogger;
}

export interface CreateDraftInput {
	accountId: string;
	accountConfigId: string;
	fromAddress: string;
	fromName?: string;
	toAddresses: string[];
	ccAddresses?: string[];
	bccAddresses?: string[];
	subject?: string;
	textBody?: string;
	htmlBody?: string;
	inReplyTo?: string;
	references?: string[];
}

export interface UpdateDraftInput {
	toAddresses?: string[];
	ccAddresses?: string[];
	bccAddresses?: string[];
	subject?: string;
	textBody?: string;
	htmlBody?: string;
	inReplyTo?: string;
	references?: string[];
}

/**
 * Nobody to send to. `@minItems(1)` on the create input is the only thing that
 * has ever stood between a zero-recipient message and nodemailer, which refuses
 * an empty envelope — and refuses it inside the SMTP worker, where the failure
 * lands in the DLQ rather than in front of the person who pressed Send. Neither
 * route into the queue passes that schema: a draft is created with a recipient
 * and can be edited down to none, and `send` never sees the create input at all.
 *
 * Cc and Bcc count. A message addressed only in Bcc is a real message with a
 * real envelope; only a message with no address anywhere has nowhere to go.
 */
const hasNowhereToGo = (message: {
	toAddresses?: string[];
	ccAddresses?: string[];
	bccAddresses?: string[];
}): boolean =>
	(message.toAddresses?.length ?? 0) === 0 &&
	(message.ccAddresses?.length ?? 0) === 0 &&
	(message.bccAddresses?.length ?? 0) === 0;

const NO_RECIPIENT_MESSAGE =
	"This message has nobody to send to. Add a recipient before sending it.";

const ENQUEUE_FAILED_MESSAGE =
	"This message could not be handed to the outgoing queue, so it was not sent. Send it again.";

const MOVED_WHILE_EDITING_MESSAGE =
	"This message started sending while it was being edited, so the change was not saved. Open the Outbox to see where it stands.";

const MOVED_WHILE_SENDING_MESSAGE =
	"This message already left the queue and cannot be sent again. Open the Outbox to see where it stands.";

/**
 * Where a row goes when the enqueue reports a failure — never `draft`, and
 * never back to `draft` where it came from.
 *
 * A throw from `SendMessage` does not prove the broker refused the event. This
 * queue is not FIFO on the send path and carries no deduplication id, so a
 * timeout or a lost response leaves an event that may still be delivered. And
 * `draft` is inside the worker's send fence (`SENDABLE_STATUSES`, smtp-worker
 * `send-message-core.ts`): a row put back there is sendable by the landed event
 * and by the user pressing Send, which is two copies of one message. `failed`
 * is outside that fence, so the landed event is dropped on arrival, and a
 * `failed` row is editable and sendable by hand (#933) — the recovery survives.
 *
 * `blocked` is outside the fence too and names a cause the enqueue did not
 * change, so a row that came from there goes back to it.
 */
const settledStatusFor = (
	priorStatus: OutboxMessageItem["status"],
): OutboxMessageItem["status"] =>
	priorStatus === OutboxMessageStatus.blocked
		? OutboxMessageStatus.blocked
		: OutboxMessageStatus.failed;

const generateMessageId = (domain: string): string => {
	const timestamp = Date.now();
	const random = randomUUID().replace(/-/g, "").slice(0, 16);
	return `${timestamp}.${random}@${domain}`;
};

const extractDomain = (email: string): string => {
	const atIndex = email.lastIndexOf("@");
	if (atIndex === -1) return "localhost";
	return email.slice(atIndex + 1);
};

export class OutboxQueueService {
	private outboxMessageService: IOutboxMessageRepository;
	private outboxAttachmentService: OutboxAttachmentService;
	private accountService: IAccountRepository;
	private sqs: SQSClient;
	private queueUrl: string;
	private log: OutboxQueueLogger;

	constructor(config: OutboxQueueConfig) {
		const {
			outboxMessageService,
			outboxAttachmentService,
			accountService,
			sqsSmtpQueueUrl,
			sqsEndpoint,
		} = config;
		this.outboxMessageService = outboxMessageService;
		this.outboxAttachmentService = outboxAttachmentService;
		this.accountService = accountService;
		this.queueUrl = sqsSmtpQueueUrl;
		this.log = config.logger ?? noopLogger;

		this.sqs =
			config.sqsClient ??
			createQueueProducer({
				queueUrl: sqsSmtpQueueUrl,
				endpoint: sqsEndpoint,
			});
	}

	createDraft = async (input: CreateDraftInput): Promise<OutboxMessageItem> => {
		const domain = extractDomain(input.fromAddress);
		const messageIdValue = generateMessageId(domain);

		const outbox = await this.outboxMessageService.create({
			accountId: input.accountId,
			accountConfigId: input.accountConfigId,
			fromAddress: input.fromAddress,
			fromName: input.fromName,
			toAddresses: input.toAddresses,
			ccAddresses: input.ccAddresses,
			bccAddresses: input.bccAddresses,
			subject: input.subject,
			textBody: input.textBody,
			htmlBody: input.htmlBody,
			inReplyTo: input.inReplyTo,
			references: input.references,
			messageIdValue,
			status: OutboxMessageStatus.draft,
		});

		this.log.info(
			{ outboxMessageId: outbox.outboxMessageId, accountId: input.accountId },
			"Created draft outbox message",
		);

		return outbox;
	};

	updateDraft = async (
		accountConfigId: string,
		outboxMessageId: string,
		input: UpdateDraftInput,
	): Promise<OutboxMessageItem> => {
		const existing = await this.outboxMessageService.get(
			accountConfigId,
			outboxMessageId,
			"act",
		);
		if (!isOpenForWork(existing.status)) {
			throw new ConflictError(
				`This message is already ${existing.status} and can no longer be edited as a draft. Start a new message to change it.`,
			);
		}

		// Editing a settled failure returns the row to `draft`: it is no longer the
		// message that failed, and the Outbox renders a `failed` row with its
		// `lastError` — a failure reported against text that never went out. The
		// same row moves to Drafts carrying its content, recipients and
		// attachments, so there is no copy to reconcile.
		//
		// Conditional on the status this decision was read from. A concurrent send
		// can move the row to `queued` between the two, and an unconditional write
		// would pull it back to `draft` with its event already on the wire — the
		// worker's fence takes `draft`, so that row goes out and stays sendable.
		const updated = await this.outboxMessageService.updateIfStatus(
			accountConfigId,
			outboxMessageId,
			existing.status,
			{
				...(existing.status !== OutboxMessageStatus.draft && {
					status: OutboxMessageStatus.draft,
				}),
				...(input.toAddresses !== undefined && {
					toAddresses: input.toAddresses,
				}),
				...(input.ccAddresses !== undefined && {
					ccAddresses: input.ccAddresses,
				}),
				...(input.bccAddresses !== undefined && {
					bccAddresses: input.bccAddresses,
				}),
				...(input.subject !== undefined && { subject: input.subject }),
				...(input.textBody !== undefined && { textBody: input.textBody }),
				...(input.htmlBody !== undefined && { htmlBody: input.htmlBody }),
				...(input.inReplyTo !== undefined && { inReplyTo: input.inReplyTo }),
				...(input.references !== undefined && {
					references: input.references,
				}),
			},
		);
		if (!updated) throw new ConflictError(MOVED_WHILE_EDITING_MESSAGE);

		this.log.info({ outboxMessageId }, "Updated draft outbox message");

		return updated;
	};

	send = async (
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<OutboxMessageItem> => {
		const existing = await this.outboxMessageService.get(
			accountConfigId,
			outboxMessageId,
			"act",
		);
		if (!isOpenForWork(existing.status)) {
			throw new ConflictError(
				`This message is already ${existing.status} and cannot be sent again. Open the Outbox to see where it stands.`,
			);
		}

		if (hasNowhereToGo(existing)) {
			throw new BadRequestError(NO_RECIPIENT_MESSAGE);
		}

		// Conditional on the status this send was decided against, so two presses —
		// or a press racing the worker — produce one queued row and one conflict
		// rather than two events for the same message.
		const updated = await this.outboxMessageService.updateIfStatus(
			accountConfigId,
			outboxMessageId,
			existing.status,
			{ status: OutboxMessageStatus.queued },
		);
		if (!updated) throw new ConflictError(MOVED_WHILE_SENDING_MESSAGE);

		// `queued` is a dead end for a row the queue never accepted: `send` takes
		// draft, failed and blocked, `deleteDraft` those three plus unfiled, so a
		// row parked at `queued` by a failed enqueue is neither sendable nor
		// discardable (#845.8). Settle it and let the enqueue failure surface —
		// the row stays reachable, the caller still hears no.
		await this.enqueueSend(existing.accountId, outboxMessageId).catch(
			async (error: unknown) => {
				await this.settleUnqueued(
					accountConfigId,
					outboxMessageId,
					existing.status,
				);
				throw error;
			},
		);

		this.log.info(
			{ outboxMessageId, accountId: existing.accountId },
			"Queued outbox message for sending",
		);

		return updated;
	};

	createAndSend = async (
		input: CreateDraftInput,
	): Promise<OutboxMessageItem> => {
		if (hasNowhereToGo(input)) {
			throw new BadRequestError(NO_RECIPIENT_MESSAGE);
		}

		const domain = extractDomain(input.fromAddress);
		const messageIdValue = generateMessageId(domain);

		const outbox = await this.outboxMessageService.create({
			accountId: input.accountId,
			accountConfigId: input.accountConfigId,
			fromAddress: input.fromAddress,
			fromName: input.fromName,
			toAddresses: input.toAddresses,
			ccAddresses: input.ccAddresses,
			bccAddresses: input.bccAddresses,
			subject: input.subject,
			textBody: input.textBody,
			htmlBody: input.htmlBody,
			inReplyTo: input.inReplyTo,
			references: input.references,
			messageIdValue,
			status: OutboxMessageStatus.queued,
		});

		// Same dead end as in `send`: a row parked at `queued` by an enqueue that
		// threw is neither sendable nor discardable (#845.8, #931, #936). This row
		// is new, so there is no prior status — it settles at `failed`, carrying
		// the reason, which keeps the composed text editable and sendable while
		// staying outside the fence a landed event has to pass.
		await this.enqueueSend(input.accountId, outbox.outboxMessageId).catch(
			async (error: unknown) => {
				await this.settleUnqueued(
					input.accountConfigId,
					outbox.outboxMessageId,
					OutboxMessageStatus.failed,
				);
				throw error;
			},
		);

		this.log.info(
			{ outboxMessageId: outbox.outboxMessageId, accountId: input.accountId },
			"Created and queued outbox message for sending",
		);

		return outbox;
	};

	deleteDraft = async (
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<void> => {
		const existing = await this.outboxMessageService.get(
			accountConfigId,
			outboxMessageId,
			"act",
		);
		// `unfiled` is discardable: the message was delivered but never landed in
		// a Sent folder, so this row is the only copy the user has and dismissing
		// it is their acknowledgement.
		if (
			existing.status !== OutboxMessageStatus.draft &&
			existing.status !== OutboxMessageStatus.failed &&
			existing.status !== OutboxMessageStatus.blocked &&
			existing.status !== OutboxMessageStatus.unfiled
		) {
			throw new ConflictError(
				`This message is already ${existing.status} and can no longer be discarded. Open the Outbox to see where it stands.`,
			);
		}

		// Files first, row second. Nothing but this row points at those objects,
		// so a row deleted ahead of a sweep that then fails leaves bytes no one
		// can reach; the other order leaves a draft whose files are gone, which
		// is at least visible. A storage failure aborts the discard outright.
		await this.outboxAttachmentService.discardAll(
			accountConfigId,
			existing.accountId,
			outboxMessageId,
		);

		await this.outboxMessageService.delete(accountConfigId, outboxMessageId);

		this.log.info({ outboxMessageId }, "Deleted outbox message");
	};

	/**
	 * Take a row back out of `queued` after the enqueue reported a failure.
	 *
	 * Conditional on `queued`, because the event may have landed regardless — an
	 * error from `SendMessage` says the response was lost, not that the broker
	 * refused it. If the worker already has the row, it holds the newer truth and
	 * this write does nothing.
	 *
	 * Never rejects. The enqueue failure is what went wrong and what the caller
	 * has to hear; a settle that also fails would replace it with the wrong
	 * cause, so it is logged and the row is left where #936 found it — which the
	 * caller's error at least names.
	 */
	private settleUnqueued = async (
		accountConfigId: string,
		outboxMessageId: string,
		priorStatus: OutboxMessageItem["status"],
	): Promise<void> => {
		const status = settledStatusFor(priorStatus);
		await this.outboxMessageService
			.updateIfStatus(
				accountConfigId,
				outboxMessageId,
				OutboxMessageStatus.queued,
				{
					status,
					...(status === OutboxMessageStatus.failed && {
						lastError: ENQUEUE_FAILED_MESSAGE,
					}),
				},
			)
			.catch((settleError: unknown) => {
				this.log.error(
					{ outboxMessageId, settleError: String(settleError) },
					"Could not settle an outbox message the queue refused",
				);
			});
	};

	private enqueueSend = async (
		accountId: string,
		outboxMessageId: string,
	): Promise<void> => {
		const event: SendMessageEvent = {
			type: "SEND_MESSAGE",
			eventId: randomUUID(),
			timestamp: Date.now(),
			accountId,
			outboxMessageId,
		};

		const useFifo = this.queueUrl.endsWith(".fifo");
		await this.sqs.send(
			new SendMessageCommand({
				QueueUrl: this.queueUrl,
				MessageBody: JSON.stringify(event),
				...(useFifo && {
					MessageGroupId: accountId,
					MessageDeduplicationId: event.eventId,
				}),
			}),
		);

		this.log.info(
			{ eventId: event.eventId, accountId, outboxMessageId },
			"Enqueued SEND_MESSAGE event",
		);
	};
}
