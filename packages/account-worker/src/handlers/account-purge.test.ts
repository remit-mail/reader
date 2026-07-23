import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SQSClient } from "@aws-sdk/client-sqs";
import type { Logger } from "@remit/logger-lambda";
import type { CascadeServices } from "../cascade.js";
import type { AccountDataPurgeEvent } from "../events.js";
import {
	type ProcessPurgeFanoutDeps,
	processAccountDataPurge,
} from "./account-purge.js";

const noopLog = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	fatal: () => {},
	trace: () => {},
	child: () => noopLog,
} as unknown as Logger;

interface Sent {
	queueUrl: string | undefined;
	body: Record<string, unknown>;
	entries?: Array<{ Id: string; MessageBody: string }>;
}

const recordingSqs = (sent: Sent[], failBatch = false): SQSClient =>
	({
		send: async (command: {
			input: {
				QueueUrl?: string;
				MessageBody?: string;
				Entries?: Array<{ Id: string; MessageBody: string }>;
			};
		}) => {
			sent.push({
				queueUrl: command.input.QueueUrl,
				body: command.input.MessageBody
					? JSON.parse(command.input.MessageBody)
					: {},
				entries: command.input.Entries,
			});
			if (command.input.Entries && failBatch) {
				return { Failed: [{ Id: "0" }] };
			}
			return {};
		},
	}) as unknown as SQSClient;

const buildServices = (
	manifest: Array<{
		threadMessageId: string;
		messageId: string;
		mailboxId: string;
	}>,
	mailboxIds: string[] = ["mbx-1"],
): CascadeServices =>
	({
		accountService: {
			describe: async () => ({
				mailbox: mailboxIds.map((mailboxId) => ({ mailboxId })),
			}),
		},
		threadMessageService: {
			listAllByAccount: async () => manifest,
		},
	}) as unknown as CascadeServices;

const event: AccountDataPurgeEvent = {
	type: "AccountDataPurge",
	accountId: "acc-1",
	accountConfigId: "cfg-1",
};

const baseDeps = (
	sent: Sent[],
	overrides: Partial<ProcessPurgeFanoutDeps> = {},
): ProcessPurgeFanoutDeps => ({
	services: buildServices([
		{ threadMessageId: "tm-1", messageId: "msg-1", mailboxId: "mbx-1" },
		{ threadMessageId: "tm-2", messageId: "msg-2", mailboxId: "mbx-1" },
	]),
	sqs: recordingSqs(sent),
	accountPurgeDeleteQueueUrl: "http://queue/purge",
	searchIndexQueueUrl: "http://queue/search",
	dataBackend: "dynamodb",
	...overrides,
});

describe("processAccountDataPurge", () => {
	it("enqueues vector deletes then a subtrees batch and one container leftover", async () => {
		const sent: Sent[] = [];
		await processAccountDataPurge(event, noopLog, baseDeps(sent));

		const vectorBatch = sent.find((m) => m.queueUrl === "http://queue/search");
		assert.equal(vectorBatch?.entries?.length, 2, "one entry per message");

		const finalize = sent.filter((m) => m.queueUrl === "http://queue/purge");
		const kinds = finalize.map((m) => m.body.kind);
		assert.deepEqual(kinds, ["subtrees", "container"]);
		assert.equal(
			(finalize[0]?.body.items as unknown[])?.length,
			2,
			"both subtrees ride the one batch",
		);
	});

	it("skips vector deletes on the postgres backend, still enqueuing finalize", async () => {
		const sent: Sent[] = [];
		await processAccountDataPurge(
			event,
			noopLog,
			baseDeps(sent, { dataBackend: "postgres" }),
		);

		assert.equal(
			sent.some((m) => m.queueUrl === "http://queue/search"),
			false,
			"no search-index enqueue on postgres",
		);
		assert.deepEqual(
			sent
				.filter((m) => m.queueUrl === "http://queue/purge")
				.map((m) => m.body.kind),
			["subtrees", "container"],
		);
	});

	it("drops manifest rows outside the account's mailbox set", async () => {
		const sent: Sent[] = [];
		await processAccountDataPurge(event, noopLog, {
			...baseDeps(sent),
			services: buildServices([
				{ threadMessageId: "tm-1", messageId: "msg-1", mailboxId: "mbx-1" },
				{ threadMessageId: "tm-9", messageId: "msg-9", mailboxId: "other" },
			]),
		});

		const subtrees = sent.find((m) => m.body.kind === "subtrees");
		assert.equal((subtrees?.body.items as unknown[])?.length, 1);
	});

	it("no-ops when the account is already gone", async () => {
		const sent: Sent[] = [];
		await processAccountDataPurge(event, noopLog, {
			...baseDeps(sent),
			services: {
				accountService: {
					describe: async () => {
						throw Object.assign(new Error("gone"), {
							name: "NotFoundError",
						});
					},
				},
				threadMessageService: { listAllByAccount: async () => [] },
			} as unknown as CascadeServices,
		});

		assert.equal(sent.length, 0, "nothing enqueued for a missing account");
	});

	it("rethrows a non-NotFound describe error", async () => {
		const sent: Sent[] = [];
		await assert.rejects(
			processAccountDataPurge(event, noopLog, {
				...baseDeps(sent),
				services: {
					accountService: {
						describe: async () => {
							throw new Error("dynamo throttled");
						},
					},
					threadMessageService: { listAllByAccount: async () => [] },
				} as unknown as CascadeServices,
			}),
			/dynamo throttled/,
		);
	});

	it("throws when a vector-delete batch reports failed entries", async () => {
		const sent: Sent[] = [];
		await assert.rejects(
			processAccountDataPurge(event, noopLog, {
				...baseDeps(sent),
				sqs: recordingSqs(sent, true),
			}),
			/failed entries/,
		);
	});
});
