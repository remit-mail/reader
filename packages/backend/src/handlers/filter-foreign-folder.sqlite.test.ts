import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import type { CreateFilterInput } from "@remit/api-openapi-types";
import { BadRequestError } from "@remit/data-ports/errors";
import {
	AccountAuthType,
	ConnectionState,
	FilterMatchOperator,
	FilterScope,
	MailboxCursorState,
} from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { deriveAccountConfigId } from "../auth.js";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { sqsClient } from "../service/sqs.js";
import { createCalendarSqliteClient } from "./calendar-sqlite-fixture.js";
import { FilterDetailOperations, FilterOperations } from "./filter.js";

const SUB = "sub-foreign-folder";
const CONFIG = deriveAccountConfigId(SUB);

let client: RemitClient;
let cleanup: () => void;
let mine: { accountId: string; inbox: string; invoices: string };
let siblings: { accountId: string; travel: string };

const createAccount = (email: string) =>
	client.account.create({
		accountConfigId: CONFIG,
		username: email,
		email,
		authType: AccountAuthType.Password,
		passwordHash: '{"ciphertext":"x"}',
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: ConnectionState.Authenticated,
	});

const createMailbox = async (
	accountId: string,
	fullPath: string,
): Promise<string> => {
	const created = await client.mailbox.create({
		accountId,
		namespacePrefix: "",
		hierarchyDelimiter: "/",
		fullPath,
		uidValidity: 7,
		uidNext: 1,
		highestModseq: "1",
		messageCount: 0,
		unseenCount: 0,
		deletedCount: 0,
		totalSize: 0,
		lastSyncUid: 0,
		highWaterMarkUid: 0,
		lastMessageSyncAt: 1,
		cursorState: MailboxCursorState.normal,
	} as Parameters<RemitClient["mailbox"]["create"]>[0]);
	if (created.outcome !== "Created") throw new Error(`${fullPath} taken`);
	return created.mailbox.mailboxId;
};

const request = {
	requestContext: { authorizer: { claims: { sub: SUB } } },
} as unknown as APIGatewayProxyEvent;

type Operation = (
	context: Context,
	event: APIGatewayProxyEvent,
) => Promise<Record<string, unknown>>;

const createFilter = (actionMailboxId: string) =>
	(FilterOperations.FilterOperations_createFilter as Operation)(
		{
			request: {
				params: { accountId: mine.accountId },
				requestBody: {
					name: "Trips",
					scope: FilterScope.Standing,
					matchOperator: FilterMatchOperator.And,
					literalClauses: [{ field: "From", value: "tickets@example.com" }],
					actionLabelId: "None",
					actionMailboxId,
				} satisfies Partial<CreateFilterInput>,
			},
		} as unknown as Context,
		request,
	);

const updateFilter = (filterId: string, actionMailboxId: string) =>
	(FilterDetailOperations.FilterDetailOperations_updateFilter as Operation)(
		{
			request: {
				params: { accountId: mine.accountId, filterId },
				requestBody: { actionMailboxId },
			},
		} as unknown as Context,
		request,
	);

const refusesForeignFolder = (error: unknown): boolean => {
	assert.ok(error instanceof BadRequestError);
	assert.match(
		error.message,
		/“INBOX\/Travel” is a folder of me-too@example\.com, not me@example\.com/,
	);
	return true;
};

before(async () => {
	process.env.SQS_QUEUE_URL_ACCOUNT_FANOUT =
		"http://localhost:9324/queue/account-fanout-test";
	({ client, cleanup } = await createCalendarSqliteClient());
	setClient(client);
	const me = await createAccount("me@example.com");
	const sibling = await createAccount("me-too@example.com");
	mine = {
		accountId: me.accountId,
		inbox: await createMailbox(me.accountId, "INBOX"),
		invoices: await createMailbox(me.accountId, "Invoices"),
	};
	siblings = {
		accountId: sibling.accountId,
		travel: await createMailbox(sibling.accountId, "INBOX/Travel"),
	};
});

afterEach(() => mock.restoreAll());

after(() => {
	_resetForTest();
	cleanup();
});

describe("a filter only moves mail into its own account's folders", () => {
	it("refuses creating a filter that moves into a sibling account's folder", async () => {
		mock.method(sqsClient, "send", async () => ({}));

		await assert.rejects(createFilter(siblings.travel), refusesForeignFolder);

		assert.deepEqual(
			(await client.filter.listPageByAccountConfig(CONFIG, {})).items,
			[],
		);
	});

	it("refuses pointing an existing filter at a sibling account's folder", async () => {
		mock.method(sqsClient, "send", async () => ({}));
		const created = await createFilter(mine.invoices);

		await assert.rejects(
			updateFilter(String(created.filterId), siblings.travel),
			refusesForeignFolder,
		);

		const kept = await client.filter.get(CONFIG, String(created.filterId));
		assert.equal(kept.actionMailboxId, mine.invoices);
	});
});
