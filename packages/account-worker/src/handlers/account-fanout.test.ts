import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { SQSClient } from "@aws-sdk/client-sqs";
import type { Logger } from "@remit/logger-lambda";
import type { CascadeServices } from "../cascade.js";
import type { AccountDeleteEvent } from "../events.js";
import { processAccountFanout } from "./account-fanout.js";

const noopLog = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	fatal: () => {},
	trace: () => {},
	child: () => noopLog,
} as unknown as Logger;

// A CascadeServices fake with one account and no data: enough for
// enumerateCascadeEntities to yield a single Account row (so the stop-signal
// loop has one accountId to iterate) without standing up a database.
const buildServices = (): CascadeServices =>
	({
		accountConfigService: {
			get: async () => ({ userId: "user-1" }),
			describe: async () => ({
				account: [{ accountId: "acc-1" }],
				address: [],
			}),
		},
		accountService: {
			describe: async () => ({ mailbox: [] }),
		},
		messageService: {
			listAllByMailbox: async () => [],
			describe: async () => ({}),
		},
		outboxMessageService: { listByAccount: async () => ({ items: [] }) },
		mailboxLockService: { listByAccount: async () => [] },
		messagePlacementMoveService: { listByAccountId: async () => [] },
		messageFlagPushService: { listByAccountId: async () => [] },
		threadMessageService: { listAllByAccount: async () => [] },
		accountSettingService: { listByAccountConfig: async () => [] },
		filterService: { listByAccountConfig: async () => [] },
		filterAnchorService: { get: async () => null },
		labelService: { listByAccountConfig: async () => [] },
		messageLabelService: { listByLabelId: async () => [] },
	}) as unknown as CascadeServices;

interface SentMessage {
	queueUrl: string | undefined;
	body: { type?: string; accountId?: string };
}

const recordingSqs = (sent: SentMessage[]): SQSClient =>
	({
		send: async (command: {
			input: { QueueUrl?: string; MessageBody?: string };
		}) => {
			sent.push({
				queueUrl: command.input.QueueUrl,
				body: JSON.parse(command.input.MessageBody ?? "{}"),
			});
			return {};
		},
	}) as unknown as SQSClient;

const deleteEvent: AccountDeleteEvent = {
	type: "AccountDelete",
	accountConfigId: "cfg-1",
};

describe("processAccountFanout — imap-worker stop signal on account delete", () => {
	const prev = process.env.SQS_QUEUE_URL_IMAP_WORKER;
	afterEach(() => {
		if (prev === undefined) delete process.env.SQS_QUEUE_URL_IMAP_WORKER;
		else process.env.SQS_QUEUE_URL_IMAP_WORKER = prev;
	});

	it("skips the stop signal when no imap-worker queue is configured, still enqueuing finalize", async () => {
		delete process.env.SQS_QUEUE_URL_IMAP_WORKER;
		const sent: SentMessage[] = [];

		await processAccountFanout(deleteEvent, noopLog, {
			services: buildServices(),
			sqs: recordingSqs(sent),
			signOut: async () => {},
			accountFinalizeQueueUrl: "http://queue/finalize",
		});

		const stops = sent.filter((m) => m.body.type === "IMAP_WORKER_STOP");
		const finalize = sent.filter(
			(m) => m.body.type === "FinalizeAccountDelete",
		);
		assert.equal(stops.length, 0, "no stop signal without a configured queue");
		assert.equal(finalize.length, 1, "finalize is still enqueued");
	});

	it("enqueues one stop signal per account when a queue is configured", async () => {
		const sent: SentMessage[] = [];

		await processAccountFanout(deleteEvent, noopLog, {
			services: buildServices(),
			sqs: recordingSqs(sent),
			signOut: async () => {},
			imapWorkerQueueUrl: "http://queue/imap",
			accountFinalizeQueueUrl: "http://queue/finalize",
		});

		const stops = sent.filter((m) => m.body.type === "IMAP_WORKER_STOP");
		assert.equal(stops.length, 1, "one stop signal for the single account");
		assert.equal(stops[0]?.queueUrl, "http://queue/imap");
		assert.equal(stops[0]?.body.accountId, "acc-1");
		assert.equal(
			sent.filter((m) => m.body.type === "FinalizeAccountDelete").length,
			1,
		);
	});
});
