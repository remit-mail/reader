import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { MessageOperations } from "./message.js";

type Handler = (
	context: Context,
	event: APIGatewayProxyEvent,
) => Promise<unknown>;

const describeMessage =
	MessageOperations.MessageOperations_describeMessage as unknown as Handler;
const getRawMessage =
	MessageOperations.MessageOperations_getRawMessage as unknown as Handler;

const MESSAGE_ID = "msg-1";
const MAILBOX_ID = "mb-1";
const ACCOUNT_ID = "acc-1";

const event = {
	requestContext: { authorizer: { claims: { sub: "sub-610" } } },
} as unknown as APIGatewayProxyEvent;

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
	afterEach(() => _resetForTest());

	for (const [name, handler] of [
		["describeMessage", describeMessage],
		["getRawMessage", getRawMessage],
	] as const) {
		it(`${name} opens no IMAP connection`, async () => {
			const opened: string[] = [];
			setClient(clientWithFailingFolderLookup(opened));

			await assert.rejects(handler(context, event), /special-use lookup/);

			assert.deepEqual(opened, []);
		});
	}
});
