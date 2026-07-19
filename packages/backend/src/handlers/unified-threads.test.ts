import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
	AccountItem,
	AccountSettingItem,
	MailboxItem,
} from "@remit/data-ports";
import {
	buildInboxMailboxMap,
	buildListAllThreadsOptions,
	buildListStarredThreadsOptions,
	type InboxMapClient,
} from "./unified-threads.js";

// #44: Flagged filtered client-side over the newest 50 unified-inbox rows, so a
// star outside that window — or in any folder that is not INBOX — never showed.
// The starred scope is every non-muted mailbox, served by its own access
// pattern.

const CONFIG_ID = "cfg-1";

const account = (accountId: string): AccountItem =>
	({ accountId }) as unknown as AccountItem;

const mailbox = (
	mailboxId: string,
	accountId: string,
	fullPath: string,
): MailboxItem =>
	({ mailboxId, accountId, fullPath }) as unknown as MailboxItem;

const mutedSetting = (
	name: "AccountMuted" | "MailboxMuted",
	targetId: string,
): AccountSettingItem =>
	({
		name: `${name}#${targetId}`,
		value: { kind: "MutedFlag", value: { value: true, setAt: 0 } },
	}) as unknown as AccountSettingItem;

const buildClient = (
	accounts: AccountItem[],
	mailboxesByAccount: Record<string, MailboxItem[]>,
	settings: AccountSettingItem[] = [],
): InboxMapClient =>
	({
		account: { listAllByAccountConfig: async () => accounts },
		mailbox: {
			listAllByAccount: async (accountId: string) =>
				mailboxesByAccount[accountId] ?? [],
		},
		accountSetting: { listByAccountConfig: async () => settings },
	}) as unknown as InboxMapClient;

describe("buildInboxMailboxMap", () => {
	test("separates the INBOX scope from the all-mailbox starred scope", async () => {
		const client = buildClient([account("a1")], {
			a1: [
				mailbox("m-inbox", "a1", "INBOX"),
				mailbox("m-archive", "a1", "Archive"),
				mailbox("m-sub", "a1", "INBOX/Receipts"),
			],
		});

		const { inboxMailboxIds, activeMailboxIds, mailboxIdToAccountId } =
			await buildInboxMailboxMap(CONFIG_ID, client);

		assert.deepEqual([...inboxMailboxIds], ["m-inbox"]);
		assert.deepEqual([...activeMailboxIds].sort(), [
			"m-archive",
			"m-inbox",
			"m-sub",
		]);
		// The map must cover every mailbox, or a starred row from Archive could
		// not resolve its accountId.
		assert.equal(mailboxIdToAccountId.get("m-archive"), "a1");
	});

	test("muted mailboxes are excluded from both scopes", async () => {
		const client = buildClient(
			[account("a1")],
			{
				a1: [
					mailbox("m-inbox", "a1", "INBOX"),
					mailbox("m-muted", "a1", "Archive"),
				],
			},
			[mutedSetting("MailboxMuted", "m-muted")],
		);

		const { inboxMailboxIds, activeMailboxIds } = await buildInboxMailboxMap(
			CONFIG_ID,
			client,
		);

		assert.deepEqual([...inboxMailboxIds], ["m-inbox"]);
		assert.deepEqual([...activeMailboxIds], ["m-inbox"]);
	});

	test("a muted account contributes no mailboxes", async () => {
		const client = buildClient(
			[account("a1")],
			{ a1: [mailbox("m-inbox", "a1", "INBOX")] },
			[mutedSetting("AccountMuted", "a1")],
		);

		const { activeMailboxIds } = await buildInboxMailboxMap(CONFIG_ID, client);
		assert.equal(activeMailboxIds.size, 0);
	});
});

describe("buildListStarredThreadsOptions", () => {
	test("scopes to every supplied mailbox, not just the inbox", () => {
		const options = buildListStarredThreadsOptions(
			{},
			new Set(["m-inbox", "m-archive"]),
		);

		assert.deepEqual([...options.mailboxIds].sort(), ["m-archive", "m-inbox"]);
		assert.equal(options.order, "desc");
		assert.equal(options.excludeDeleted, true);
	});

	test("carries the caller's paging through", () => {
		const options = buildListStarredThreadsOptions(
			{ continuationToken: "tok", order: "asc", limit: 10 },
			new Set(["m-inbox"]),
		);

		assert.equal(options.continuationToken, "tok");
		assert.equal(options.order, "asc");
		assert.equal(options.limit, 10);
	});

	test("defaults the page size to the unified default", () => {
		const starred = buildListStarredThreadsOptions({}, new Set(["m-inbox"]));
		const unified = buildListAllThreadsOptions({}, new Set(["m-inbox"]));
		assert.equal(starred.limit, unified.limit);
	});
});
