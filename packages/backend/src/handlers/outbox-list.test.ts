/**
 * Issue #1013: the outbox listing took the head of the configured account list,
 * so on an instance with two accounts the second account's drafts and failed
 * sends were never on screen.
 *
 * The operation takes no account parameter and does not gain one — the fan-out
 * is the handler's job. What is pinned here is that every account under the
 * caller's config is asked for, and that the continuation token the handler
 * hands back resumes the one merged ordering rather than one account's.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	AccountItem,
	IAccountRepository,
	IOutboxMessageRepository,
	OutboxMessageItem,
	ResultList,
} from "@remit/data-ports";
import { APPENDED_UID_NONE } from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { OutboxMessageStatus } from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { handlerContextFromEvent } from "../handler-context.js";
import type { RemitClient } from "../service/data-client.js";
import { OutboxOperations } from "./outbox.js";

const SUB = "cognito-sub-1013";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);
const FIRST_ACCOUNT = "acc-first";
const SECOND_ACCOUNT = "acc-second";

const outboxRow = (
	outboxMessageId: string,
	accountId: string,
	createdAt: number,
): OutboxMessageItem => ({
	outboxMessageId,
	accountId,
	accountConfigId: ACCOUNT_CONFIG_ID,
	fromAddress: `${accountId}@example.com`,
	toAddresses: ["recipient@example.com"],
	ccAddresses: [],
	bccAddresses: [],
	references: [],
	messageIdValue: `<${outboxMessageId}@example.com>`,
	status: OutboxMessageStatus.draft,
	appendedUid: APPENDED_UID_NONE,
	createdAt,
	updatedAt: createdAt,
});

/**
 * Four rows, the two accounts alternating in time, so a page of two can only
 * hold rows from both and a listing that follows one account is visibly short.
 */
const rows: OutboxMessageItem[] = [
	outboxRow("out-1", FIRST_ACCOUNT, 4000),
	outboxRow("out-2", SECOND_ACCOUNT, 3000),
	outboxRow("out-3", FIRST_ACCOUNT, 2000),
	outboxRow("out-4", SECOND_ACCOUNT, 1000),
];

const askedFor: string[][] = [];

/** The keyset the drizzle repository implements, over the fixture above. */
const outboxRepository = {
	listByAccounts: async (
		accountIds: string[],
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<OutboxMessageItem>> => {
		askedFor.push([...accountIds]);
		const limit = options?.limit ?? 2;
		const after = options?.continuationToken
			? (JSON.parse(
					Buffer.from(options.continuationToken, "base64url").toString("utf8"),
				) as { createdAt: number })
			: undefined;
		const matching = rows
			.filter((row) => accountIds.includes(row.accountId))
			.filter((row) => after === undefined || row.createdAt < after.createdAt)
			.sort((left, right) => right.createdAt - left.createdAt);
		const items = matching.slice(0, limit);
		const last = items[items.length - 1];
		const hasMore = matching.length > limit;
		return {
			items,
			continuationToken:
				hasMore && last
					? Buffer.from(JSON.stringify({ createdAt: last.createdAt })).toString(
							"base64url",
						)
					: undefined,
		};
	},
} as unknown as IOutboxMessageRepository;

const accountRepository = {
	listAllByAccountConfig: async (): Promise<AccountItem[]> =>
		[FIRST_ACCOUNT, SECOND_ACCOUNT].map(
			(accountId) =>
				({
					accountId,
					accountConfigId: ACCOUNT_CONFIG_ID,
					email: `${accountId}@example.com`,
				}) as unknown as AccountItem,
		),
} as unknown as IAccountRepository;

let client: RemitClient;

const installClient = (): void => {
	askedFor.length = 0;
	client = {
		account: accountRepository,
		outboxMessage: outboxRepository,
	} as unknown as RemitClient;
};

const authorizedEvent = (): APIGatewayProxyEvent =>
	({
		body: null,
		requestContext: { authorizer: { claims: { sub: SUB } } },
	}) as unknown as APIGatewayProxyEvent;

const queryContext = (query: Record<string, string> = {}): Context =>
	({ request: { query } }) as unknown as Context;

type ListResult = {
	items: { outboxMessageId: string; accountId: string }[];
	continuationToken?: string;
};

const listOutbox = async (query?: Record<string, string>) =>
	(await OutboxOperations.OutboxOperations_listOutboxMessages(
		queryContext(query),
		handlerContextFromEvent(client, authorizedEvent()),
	)) as ListResult;

describe("the outbox of an instance with two accounts (#1013)", () => {
	it("lists rows from every account, not just the first", async () => {
		installClient();

		const first = await listOutbox();

		assert.deepEqual(askedFor, [[FIRST_ACCOUNT, SECOND_ACCOUNT]]);
		assert.deepEqual(
			[...new Set(first.items.map((item) => item.accountId))].sort(),
			[FIRST_ACCOUNT, SECOND_ACCOUNT],
		);
	});

	it("resumes the merged ordering on the second page", async () => {
		installClient();

		const first = await listOutbox();
		assert.ok(first.continuationToken, "a second page is offered");

		const second = await listOutbox({
			continuationToken: first.continuationToken,
		});

		const seen = [...first.items, ...second.items].map(
			(item) => item.outboxMessageId,
		);
		assert.deepEqual(seen, ["out-1", "out-2", "out-3", "out-4"]);
		assert.equal(new Set(seen).size, 4, "no row on both pages");
		assert.equal(second.continuationToken, undefined, "paging terminates");
	});
});
