import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import {
	reconcileStaleMessage,
	type StaleMessageReconcileDeps,
} from "./stale-message-reconcile.js";

describe("reconcileStaleMessage", () => {
	it("deletes the Message row and every ThreadMessage copy that points at it", async () => {
		const deletedMessages: string[] = [];
		const deletedThreadMessageKeys: Array<{
			accountConfigId: string;
			threadMessageId: string;
		}> = [];

		const deps: StaleMessageReconcileDeps = {
			messageService: {
				delete: async (messageId: string) => {
					deletedMessages.push(messageId);
				},
			} as unknown as Pick<IMessageRepository, "delete">,
			threadMessageService: {
				findAllByMessageId: async (
					accountConfigId: string,
					messageId: string,
				) => [
					{ accountConfigId, threadMessageId: `tm-inbox-${messageId}` },
					{ accountConfigId, threadMessageId: `tm-label-${messageId}` },
				],
				deleteMany: async (
					keys: Array<{ accountConfigId: string; threadMessageId: string }>,
				) => {
					deletedThreadMessageKeys.push(...keys);
				},
			} as unknown as Pick<
				IThreadMessageRepository,
				"findAllByMessageId" | "deleteMany"
			>,
		};

		const result = await reconcileStaleMessage(deps, "cfg-1", "msg-1");

		assert.equal(result.threadMessagesDeleted, 2);
		assert.deepEqual(deletedMessages, ["msg-1"]);
		assert.deepEqual(deletedThreadMessageKeys, [
			{ accountConfigId: "cfg-1", threadMessageId: "tm-inbox-msg-1" },
			{ accountConfigId: "cfg-1", threadMessageId: "tm-label-msg-1" },
		]);
	});

	it("skips the batch delete (never calls deleteMany with an empty array) when no copies exist", async () => {
		const deletedMessages: string[] = [];
		let deleteManyCalls = 0;

		const deps: StaleMessageReconcileDeps = {
			messageService: {
				delete: async (messageId: string) => {
					deletedMessages.push(messageId);
				},
			} as unknown as Pick<IMessageRepository, "delete">,
			threadMessageService: {
				findAllByMessageId: async () => [],
				deleteMany: async () => {
					deleteManyCalls++;
				},
			} as unknown as Pick<
				IThreadMessageRepository,
				"findAllByMessageId" | "deleteMany"
			>,
		};

		const result = await reconcileStaleMessage(deps, "cfg-1", "msg-solo");

		assert.equal(result.threadMessagesDeleted, 0);
		assert.deepEqual(deletedMessages, ["msg-solo"]);
		assert.equal(deleteManyCalls, 0);
	});
});
