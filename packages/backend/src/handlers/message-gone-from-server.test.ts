import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { handleError } from "../error.js";
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

const MESSAGE_ID = "msg-gone";
const MAILBOX_ID = "mb-1";
const ACCOUNT_ID = "acc-1";

const event = {
	requestContext: { authorizer: { claims: { sub: "sub-gone" } } },
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
	fullPath: "INBOX",
	cursorState: "normal",
};

const clientWhoseMessageLeftTheServer = (): RemitClient =>
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
			findJunkMailbox: async () => null,
			findInboxMailbox: async () => null,
		},
		createConnectionScope: async () => ({
			getConnection: async () => ({ openBox: async () => {} }),
			disconnect: async () => {},
		}),
		bodySync: { fetchAndGetBody: async () => ({ outcome: "gone" }) },
	}) as unknown as RemitClient;

describe("reading a message another client expunged", () => {
	afterEach(() => _resetForTest());

	for (const [name, handler] of [
		["describeMessage", describeMessage],
		["getRawMessage", getRawMessage],
	] as const) {
		it(`${name} answers 404 message_gone_from_server, not 500`, async () => {
			setClient(clientWhoseMessageLeftTheServer());

			const error = await handler(context, event).then(
				() => assert.fail("expected the read to be refused"),
				(rejection: unknown) => rejection,
			);
			const response = await handleError(error);

			assert.equal(response.statusCode, 404);
			assert.deepEqual(JSON.parse(response.body), {
				code: "message_gone_from_server",
				message: "This message is no longer on the mail server.",
				details: { messageId: MESSAGE_ID },
			});
		});
	}
});
