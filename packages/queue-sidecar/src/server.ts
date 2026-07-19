import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:http";
import {
	type BatchErrorEntry,
	type BatchSuccessEntry,
	errorResponse,
	queryResponse,
	queryResponseNoResult,
	queueAttributesResult,
	queueUrlResult,
	receiveMessageResult,
	sendMessageBatchResult,
	sendMessageResult,
} from "./protocol.js";
import {
	QueueDoesNotExistError,
	type QueueStore,
	SqsError,
	validateFifoSend,
} from "./store.js";

export interface SidecarLog {
	info: (fields: Record<string, unknown>, message: string) => void;
	error: (fields: Record<string, unknown>, message: string) => void;
}

export interface CreateSidecarOptions {
	readonly store: QueueStore;
	readonly accountId?: string;
	readonly log?: SidecarLog;
	/** Poll cadence while a ReceiveMessage long-poll waits for a message. */
	readonly longPollIntervalMs?: number;
}

interface DispatchResult {
	readonly status: number;
	readonly body: string;
}

const DEFAULT_ACCOUNT_ID = "000000000000";
const DEFAULT_LONG_POLL_INTERVAL_MS = 250;
const MAX_WAIT_TIME_SECONDS = 20;

const noopLog: SidecarLog = { info: () => {}, error: () => {} };

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

const readBody = (req: IncomingMessage): Promise<string> =>
	new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});

const queueNameFromUrl = (queueUrl: string): string => {
	const segments = queueUrl.split("?")[0].split("/").filter(Boolean);
	const name = segments.at(-1);
	if (!name) throw new InvalidRequestError(`malformed QueueUrl: ${queueUrl}`);
	return decodeURIComponent(name);
};

class InvalidRequestError extends SqsError {
	constructor(message: string) {
		super("InvalidParameterValue", message);
	}
}

const collectIndexed = (params: URLSearchParams, prefix: string): string[] => {
	const values: string[] = [];
	for (let index = 1; ; index += 1) {
		const value = params.get(`${prefix}.${index}`);
		if (value === null) break;
		values.push(value);
	}
	return values;
};

interface ParsedBatchEntry {
	id: string;
	body: string;
	groupId?: string;
	deduplicationId?: string;
}

const parseBatchEntries = (
	params: URLSearchParams,
	prefix: string,
): ParsedBatchEntry[] => {
	const indices = new Set<string>();
	for (const key of params.keys()) {
		const match = key.match(new RegExp(`^${prefix}\\.(\\d+)\\.`));
		if (match) indices.add(match[1]);
	}
	return [...indices]
		.sort((a, b) => Number(a) - Number(b))
		.map((index) => {
			const id = params.get(`${prefix}.${index}.Id`);
			const body = params.get(`${prefix}.${index}.MessageBody`);
			if (id === null || body === null) {
				throw new InvalidRequestError(
					`batch entry ${index} missing Id or MessageBody`,
				);
			}
			return {
				id,
				body,
				groupId: params.get(`${prefix}.${index}.MessageGroupId`) ?? undefined,
				deduplicationId:
					params.get(`${prefix}.${index}.MessageDeduplicationId`) ?? undefined,
			};
		});
};

export const createSidecarServer = (options: CreateSidecarOptions): Server => {
	const { store } = options;
	const accountId = options.accountId ?? DEFAULT_ACCOUNT_ID;
	const log = options.log ?? noopLog;
	const longPollIntervalMs =
		options.longPollIntervalMs ?? DEFAULT_LONG_POLL_INTERVAL_MS;

	let closing = false;

	const queueUrlFor = (host: string, queueName: string): string =>
		`http://${host}/${accountId}/${queueName}`;

	const requireQueueName = (params: URLSearchParams): string => {
		const queueUrl = params.get("QueueUrl");
		if (queueUrl) return queueNameFromUrl(queueUrl);
		const queueName = params.get("QueueName");
		if (queueName) return queueName;
		throw new InvalidRequestError("request is missing QueueUrl or QueueName");
	};

	const receiveWithLongPoll = async (
		queueName: string,
		maxMessages: number,
		visibilityTimeoutSeconds: number | undefined,
		waitSeconds: number,
	): Promise<ReturnType<QueueStore["receiveMessages"]>> => {
		const deadline = Date.now() + waitSeconds * 1000;
		for (;;) {
			const messages = store.receiveMessages({
				queueName,
				maxMessages,
				visibilityTimeoutSeconds,
			});
			if (messages.length > 0 || Date.now() >= deadline || closing) {
				return messages;
			}
			await delay(Math.min(longPollIntervalMs, deadline - Date.now()));
		}
	};

	const dispatch = async (
		action: string,
		params: URLSearchParams,
		host: string,
	): Promise<DispatchResult> => {
		const requestId = randomUUID();

		if (action === "CreateQueue") {
			const name = params.get("QueueName");
			if (!name)
				throw new InvalidRequestError("CreateQueue requires QueueName");
			const existing = store.getQueue(name);
			const fifo =
				params.get("Attribute.1.Name") === "FifoQueue"
					? params.get("Attribute.1.Value") === "true"
					: name.endsWith(".fifo");
			if (!existing) {
				store.upsertQueue({
					name,
					fifo,
					visibilityTimeoutSeconds: 30,
					contentBasedDeduplication: false,
				});
			}
			return {
				status: 200,
				body: queryResponse(
					action,
					queueUrlResult(queueUrlFor(host, name)),
					requestId,
				),
			};
		}

		if (action === "GetQueueUrl") {
			const name = params.get("QueueName");
			if (!name)
				throw new InvalidRequestError("GetQueueUrl requires QueueName");
			if (!store.getQueue(name)) throw new QueueDoesNotExistError(name);
			return {
				status: 200,
				body: queryResponse(
					action,
					queueUrlResult(queueUrlFor(host, name)),
					requestId,
				),
			};
		}

		const queueName = requireQueueName(params);

		if (action === "SendMessage") {
			const body = params.get("MessageBody");
			if (body === null) {
				throw new InvalidRequestError("SendMessage requires MessageBody");
			}
			const result = store.sendMessage({
				queueName,
				body,
				groupId: params.get("MessageGroupId") ?? undefined,
				deduplicationId: params.get("MessageDeduplicationId") ?? undefined,
			});
			return {
				status: 200,
				body: queryResponse(action, sendMessageResult(result), requestId),
			};
		}

		if (action === "SendMessageBatch") {
			const entries = parseBatchEntries(params, "SendMessageBatchRequestEntry");
			// A missing/unknown queue faults the whole request (SQS returns an
			// error, not per-entry failures); a bad individual entry becomes a
			// per-entry failure so the rest of the batch still lands.
			const queue = store.getQueue(queueName);
			if (!queue) throw new QueueDoesNotExistError(queueName);

			const successful: BatchSuccessEntry[] = [];
			const failed: BatchErrorEntry[] = [];
			for (const entry of entries) {
				const invalid = validateFifoSend(queue, entry);
				if (invalid) {
					failed.push({
						id: entry.id,
						code: invalid.code,
						message: invalid.message,
						senderFault: invalid.senderFault,
					});
					continue;
				}
				const result = store.sendMessage({
					queueName,
					body: entry.body,
					groupId: entry.groupId,
					deduplicationId: entry.deduplicationId,
				});
				successful.push({
					id: entry.id,
					messageId: result.messageId,
					md5OfBody: result.md5OfBody,
					sequenceNumber: result.sequenceNumber,
				});
			}
			return {
				status: 200,
				body: queryResponse(
					action,
					sendMessageBatchResult(successful, failed),
					requestId,
				),
			};
		}

		if (action === "ReceiveMessage") {
			const maxMessages = Number(params.get("MaxNumberOfMessages") ?? "1");
			const visibilityTimeoutParam = params.get("VisibilityTimeout");
			const waitSeconds = Math.min(
				Number(params.get("WaitTimeSeconds") ?? "0"),
				MAX_WAIT_TIME_SECONDS,
			);
			const messages = await receiveWithLongPoll(
				queueName,
				maxMessages,
				visibilityTimeoutParam === null
					? undefined
					: Number(visibilityTimeoutParam),
				waitSeconds,
			);
			return {
				status: 200,
				body: queryResponse(
					action,
					receiveMessageResult(
						messages.map((message) => ({
							messageId: message.messageId,
							receiptHandle: message.receiptHandle,
							md5OfBody: message.md5OfBody,
							body: message.body,
							attributes: {
								ApproximateReceiveCount: String(message.receiveCount),
								SentTimestamp: String(message.sentTimestamp),
								ApproximateFirstReceiveTimestamp: String(
									message.firstReceivedTimestamp,
								),
								...(message.groupId ? { MessageGroupId: message.groupId } : {}),
								...(message.sequenceNumber
									? { SequenceNumber: message.sequenceNumber }
									: {}),
							},
						})),
					),
					requestId,
				),
			};
		}

		if (action === "DeleteMessage") {
			const receiptHandle = params.get("ReceiptHandle");
			if (!receiptHandle) {
				throw new InvalidRequestError("DeleteMessage requires ReceiptHandle");
			}
			store.deleteMessage(queueName, receiptHandle);
			return { status: 200, body: queryResponseNoResult(action, requestId) };
		}

		if (action === "PurgeQueue") {
			store.purgeQueue(queueName);
			return { status: 200, body: queryResponseNoResult(action, requestId) };
		}

		if (action === "GetQueueAttributes") {
			const attributes = store.getQueueAttributes(queueName);
			const available: Record<string, string> = {
				ApproximateNumberOfMessages: String(
					attributes.approximateNumberOfMessages,
				),
				ApproximateNumberOfMessagesNotVisible: String(
					attributes.approximateNumberOfMessagesNotVisible,
				),
				VisibilityTimeout: String(attributes.visibilityTimeout),
				...(attributes.fifoQueue ? { FifoQueue: "true" } : {}),
				...(attributes.redrivePolicy
					? { RedrivePolicy: attributes.redrivePolicy }
					: {}),
			};
			const requested = collectIndexed(params, "AttributeName");
			const wantAll = requested.length === 0 || requested.includes("All");
			const values = wantAll
				? available
				: Object.fromEntries(
						Object.entries(available).filter(([name]) =>
							requested.includes(name),
						),
					);
			return {
				status: 200,
				body: queryResponse(action, queueAttributesResult(values), requestId),
			};
		}

		throw new InvalidRequestError(`unsupported action: ${action}`);
	};

	const respond = (res: ServerResponse, result: DispatchResult): void => {
		res.writeHead(result.status, { "content-type": "text/xml" });
		res.end(result.body);
	};

	const respondError = (res: ServerResponse, error: unknown): void => {
		const requestId = randomUUID();
		if (error instanceof SqsError) {
			res.writeHead(error.senderFault ? 400 : 500, {
				"content-type": "text/xml",
			});
			res.end(
				errorResponse(error.code, error.message, requestId, error.senderFault),
			);
			return;
		}
		const message = error instanceof Error ? error.message : "internal error";
		log.error({ error: message }, "sidecar: request failed");
		res.writeHead(500, { "content-type": "text/xml" });
		res.end(errorResponse("InternalFailure", message, requestId, false));
	};

	const handler = (req: IncomingMessage, res: ServerResponse): void => {
		if (req.method === "GET" && req.url === "/health") {
			res.writeHead(200, { "content-type": "text/plain" });
			res.end("ok");
			return;
		}
		if (req.method !== "POST") {
			respondError(res, new InvalidRequestError("only POST is supported"));
			return;
		}
		const host = req.headers.host ?? `localhost`;
		readBody(req)
			.then((body) => {
				const params = new URLSearchParams(body);
				const action = params.get("Action");
				if (!action) throw new InvalidRequestError("request is missing Action");
				return dispatch(action, params, host);
			})
			.then((result) => respond(res, result))
			.catch((error) => respondError(res, error));
	};

	const server = createServer(handler);
	server.on("close", () => {
		closing = true;
	});
	return server;
};
