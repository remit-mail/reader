import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import { deriveThreadId } from "@remit/data-ports/id";
import {
	DrizzleThreadMessageRepository,
	sweepThreadRootSpelling,
	type ThreadRootRepairClient,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import type { Logger } from "@remit/logger-lambda";
import { OutboxRelay } from "@remit/outbox-relay";
import type { SQSRecord } from "aws-lambda";
import { processBatch } from "./handler.js";
import type { Services } from "./services.js";
import { SqliteOutboxStore } from "./sqlite-outbox-drain.js";

// The migrator moves a message misfiled under a `<<id>>` thread root into the
// thread it answers. The semantic index keeps a thread id beside each message's
// vectors, so the move has to reach the index too: this runs the repair, the
// SQLite outbox drain and the worker against one shipped database, and reads
// the thread id the worker hands to the index.

const CONFIG = "cfg-1";
const MESSAGE_ID = "m-reply";

const silent = { info: () => {}, error: () => {} } as unknown as Logger;

describe("a message the migrator moves to another thread", () => {
	test("is re-indexed under the thread it was moved to", async () => {
		const { db, sqlite, close } = createShippedSqliteDb();
		const splitThread = deriveThreadId(CONFIG, "<<parent@remit.test>>");
		const parentThread = deriveThreadId(CONFIG, "<parent@remit.test>");

		sqlite
			.prepare(
				`INSERT INTO thread_message (
					thread_message_id, thread_id, message_id, account_config_id,
					mailbox_id, uid, message_id_header, in_reply_to, reference_order,
					internal_date, sent_date, is_read, has_attachment, has_stars,
					is_deleted, created_at, updated_at
				) VALUES ('tm-split', ?, ?, ?, 'mbx', 1, '<reply@remit.test>',
					'<<parent@remit.test>>', 1, 0, 0, 0, 0, 0, 0, 0, 0)`,
			)
			.run(splitThread, MESSAGE_ID, CONFIG);

		const client: ThreadRootRepairClient = {
			all: async (sql, params) => sqlite.prepare(sql).all(...params),
			run: async (sql, params) => sqlite.prepare(sql).run(...params).changes,
		};
		await sweepThreadRootSpelling(client, "repair");

		const relayed: string[] = [];
		await new OutboxRelay({
			store: new SqliteOutboxStore(sqlite as unknown as never),
			sqs: {
				send: async (command: SendMessageCommand) => {
					relayed.push(String(command.input.MessageBody));
					return {};
				},
			} as unknown as ConstructorParameters<typeof OutboxRelay>[0]["sqs"],
			queueUrl: "q",
		}).drainPending();

		const indexedThreadIds: string[] = [];
		const services = {
			accountService: {
				get: async () => ({ accountConfigId: CONFIG, deletedAt: undefined }),
			},
			threadMessageService: new DrizzleThreadMessageRepository(db),
			storageService: {
				retrieveParsedBody: async () => ({ text: "hello", html: "" }),
			},
			searchService: {
				prepareVectors: async (input: { metadata: { threadId: string } }) => {
					indexedThreadIds.push(input.metadata.threadId);
					return [];
				},
			},
		} as unknown as Services;

		await processBatch(
			relayed.map(
				(body, index) =>
					({
						messageId: `sqs-${index}`,
						eventSourceARN: "http://queue:9324/000000000000/remit-search-index",
						body,
					}) as unknown as SQSRecord,
			),
			services,
			silent,
		);

		assert.deepEqual(indexedThreadIds, [parentThread]);
		close();
	});
});
