import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type { Context } from "openapi-backend";
import type { RemitClient } from "../service/data-client.js";
import type { QueueName } from "../service/queues.js";
import type { HandlerContext } from "../types.js";
import { MessageOperations } from "./message.js";

const describeMessage = MessageOperations.MessageOperations_describeMessage;
const getRawMessage = MessageOperations.MessageOperations_getRawMessage;

const MESSAGE_ID = "msg-1";
const MAILBOX_ID = "mb-1";
const ACCOUNT_ID = "acc-1";

const SUB = "sub-610";

const callerWith = (client: RemitClient): HandlerContext<QueueName> => ({
	client,
	identity: {
		kind: "user",
		accountConfigId: deriveAccountConfigId(SUB),
		sub: SUB,
		email: "caller@example.com",
	},
});

const context = {
	request: { params: { messageId: MESSAGE_ID } },
} as unknown as Context;

const unstoredMessage = {
	messageId: MESSAGE_ID,
	mailboxId: MAILBOX_ID,
	uid: 7,
	internalDate: 1,
	status: "active",
	syncStatus: "synced",
};

const mailboxRow = {
	mailboxId: MAILBOX_ID,
	accountId: ACCOUNT_ID,
	fullPath: "Junk",
	cursorState: "normal",
};

const clientWithFailingFolderLookup = (opened: string[]): RemitClient =>
	({
		message: {
			get: async () => unstoredMessage,
			describe: async () => ({
				message: [unstoredMessage],
				envelope: [],
				envelopeAddress: [],
				messageFlag: [],
				bodyPart: [],
				messageReference: [],
			}),
		},
		messageLabel: { listByMessageId: async () => [] },
		threadMessage: { findByMessageId: async () => null },
		account: {
			listAllByAccountConfig: async () => [{ accountId: ACCOUNT_ID }],
		},
		mailbox: {
			get: async (_accountId: string, ids: string | string[]) =>
				Array.isArray(ids) ? [mailboxRow] : mailboxRow,
		},
		storage: { bodyPartExists: async () => false },
		mailboxSpecialUse: {
			findJunkMailbox: async () => {
				throw new Error("special-use lookup timed out");
			},
			findInboxMailbox: async () => null,
		},
		createConnectionScope: async (accountId: string) => {
			opened.push(accountId);
			return {
				getConnection: async () => ({}),
				disconnect: async () => {},
			};
		},
	}) as unknown as RemitClient;

describe("reading an unstored message when the folder lookup fails", () => {
	for (const [name, handler] of [
		["describeMessage", describeMessage],
		["getRawMessage", getRawMessage],
	] as const) {
		it(`${name} opens no IMAP connection`, async () => {
			const opened: string[] = [];
			const caller = callerWith(clientWithFailingFolderLookup(opened));

			await assert.rejects(handler(context, caller), /special-use lookup/);

			assert.deepEqual(opened, []);
		});
	}
});
