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
	buildSearchAllThreadsOptions,
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
	specialUse?: string[],
): MailboxItem =>
	({ mailboxId, accountId, fullPath, specialUse }) as unknown as MailboxItem;

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
	test("separates the INBOX scope from the wider starred scope", async () => {
		const client = buildClient([account("a1")], {
			a1: [
				mailbox("m-inbox", "a1", "INBOX"),
				mailbox("m-archive", "a1", "Archive", ["Archive"]),
				mailbox("m-sub", "a1", "INBOX/Receipts"),
			],
		});

		const { inboxMailboxIds, starredMailboxIds, mailboxIdToAccountId } =
			await buildInboxMailboxMap(CONFIG_ID, client);

		assert.deepEqual([...inboxMailboxIds], ["m-inbox"]);
		assert.deepEqual([...starredMailboxIds].sort(), [
			"m-archive",
			"m-inbox",
			"m-sub",
		]);
		// The map must cover every mailbox, or a starred row from Archive could
		// not resolve its accountId.
		assert.equal(mailboxIdToAccountId.get("m-archive"), "a1");
	});

	// A star on mail in Spam or Trash is not something the starred view should
	// resurface; Gmail's All Mail is a second copy of everything, so including it
	// renders every starred Gmail message twice.
	test("the starred scope excludes All Mail, Junk and Trash", async () => {
		const client = buildClient([account("a1")], {
			a1: [
				mailbox("m-inbox", "a1", "INBOX"),
				mailbox("m-all", "a1", "[Gmail]/All Mail", ["All"]),
				mailbox("m-junk", "a1", "[Gmail]/Spam", ["Junk"]),
				mailbox("m-trash", "a1", "[Gmail]/Trash", ["Trash"]),
				mailbox("m-sent", "a1", "[Gmail]/Sent Mail", ["Sent"]),
			],
		});

		const { starredMailboxIds, mailboxIdToAccountId } =
			await buildInboxMailboxMap(CONFIG_ID, client);

		assert.deepEqual([...starredMailboxIds].sort(), ["m-inbox", "m-sent"]);
		// Excluded mailboxes still resolve an accountId — the map is the wider set.
		assert.equal(mailboxIdToAccountId.get("m-trash"), "a1");
	});

	test("a mailbox carrying several special uses is excluded on any one of them", async () => {
		const client = buildClient([account("a1")], {
			a1: [mailbox("m-archive-all", "a1", "Archive", ["Archive", "All"])],
		});

		const { starredMailboxIds } = await buildInboxMailboxMap(CONFIG_ID, client);
		assert.equal(starredMailboxIds.size, 0);
	});

	// #49: the unified list backing the unscoped search was INBOX-only, so a
	// search from the daily brief could not see Archive, Sent, Spam or any
	// custom folder.
	test("the search scope reaches every folder but Trash and All Mail", async () => {
		const client = buildClient([account("a1")], {
			a1: [
				mailbox("m-inbox", "a1", "INBOX"),
				mailbox("m-sub", "a1", "INBOX/Receipts"),
				mailbox("m-archive", "a1", "Archive", ["Archive"]),
				mailbox("m-sent", "a1", "[Gmail]/Sent Mail", ["Sent"]),
				mailbox("m-junk", "a1", "[Gmail]/Spam", ["Junk"]),
				mailbox("m-custom", "a1", "Projects/Remit"),
				mailbox("m-all", "a1", "[Gmail]/All Mail", ["All"]),
				mailbox("m-trash", "a1", "[Gmail]/Trash", ["Trash"]),
			],
		});

		const { searchMailboxIds } = await buildInboxMailboxMap(CONFIG_ID, client);

		assert.deepEqual(
			[...searchMailboxIds].sort(),
			["m-archive", "m-custom", "m-inbox", "m-junk", "m-sent", "m-sub"],
			"Spam is in scope; Trash and All Mail are not",
		);
	});

	// The starred scope drops Junk; the search scope keeps it. Two sets, two
	// judgements — a star in Spam is noise, a search for mail that landed in
	// Spam is the whole point.
	test("the search scope and the starred scope differ on Junk", async () => {
		const client = buildClient([account("a1")], {
			a1: [
				mailbox("m-inbox", "a1", "INBOX"),
				mailbox("m-junk", "a1", "[Gmail]/Spam", ["Junk"]),
			],
		});

		const { searchMailboxIds, starredMailboxIds } = await buildInboxMailboxMap(
			CONFIG_ID,
			client,
		);

		assert.equal(searchMailboxIds.has("m-junk"), true);
		assert.equal(starredMailboxIds.has("m-junk"), false);
	});

	test("the search scope spans every non-muted account", async () => {
		const client = buildClient([account("a1"), account("a2")], {
			a1: [mailbox("m1-archive", "a1", "Archive", ["Archive"])],
			a2: [mailbox("m2-sent", "a2", "Sent", ["Sent"])],
		});

		const { searchMailboxIds } = await buildInboxMailboxMap(CONFIG_ID, client);

		assert.deepEqual([...searchMailboxIds].sort(), ["m1-archive", "m2-sent"]);
	});

	test("muted mailboxes are excluded from the search scope too", async () => {
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

		const { searchMailboxIds } = await buildInboxMailboxMap(CONFIG_ID, client);
		assert.deepEqual([...searchMailboxIds], ["m-inbox"]);
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

		const { inboxMailboxIds, starredMailboxIds } = await buildInboxMailboxMap(
			CONFIG_ID,
			client,
		);

		assert.deepEqual([...inboxMailboxIds], ["m-inbox"]);
		assert.deepEqual([...starredMailboxIds], ["m-inbox"]);
	});

	test("a muted account contributes no mailboxes", async () => {
		const client = buildClient(
			[account("a1")],
			{ a1: [mailbox("m-inbox", "a1", "INBOX")] },
			[mutedSetting("AccountMuted", "a1")],
		);

		const { starredMailboxIds } = await buildInboxMailboxMap(CONFIG_ID, client);
		assert.equal(starredMailboxIds.size, 0);
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

describe("buildSearchAllThreadsOptions", () => {
	test("carries the whole search scope, not just the inbox", () => {
		const options = buildSearchAllThreadsOptions(
			{},
			new Set(["m-inbox", "m-archive", "m-junk"]),
		);

		assert.deepEqual([...options.mailboxIds].sort(), [
			"m-archive",
			"m-inbox",
			"m-junk",
		]);
		assert.equal(options.order, "desc");
		assert.equal(options.excludeDeleted, true);
	});

	test("carries the caller's paging through", () => {
		const options = buildSearchAllThreadsOptions(
			{ continuationToken: "tok", order: "asc", limit: 10 },
			new Set(["m-inbox"]),
		);

		assert.equal(options.continuationToken, "tok");
		assert.equal(options.order, "asc");
		assert.equal(options.limit, 10);
	});

	test("defaults the page size to the unified default", () => {
		const search = buildSearchAllThreadsOptions({}, new Set(["m-inbox"]));
		const unified = buildListAllThreadsOptions({}, new Set(["m-inbox"]));
		assert.equal(search.limit, unified.limit);
	});
});
