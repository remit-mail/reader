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
	dedupeByMessageId,
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
	// custom folder. The scope is defined by what it excludes — anything not on
	// that list is searched, Drafts included.
	test("the search scope reaches every folder but Trash", async () => {
		const client = buildClient([account("a1")], {
			a1: [
				mailbox("m-inbox", "a1", "INBOX"),
				mailbox("m-sub", "a1", "INBOX/Receipts"),
				mailbox("m-archive", "a1", "Archive", ["Archive"]),
				mailbox("m-sent", "a1", "[Gmail]/Sent Mail", ["Sent"]),
				mailbox("m-junk", "a1", "[Gmail]/Spam", ["Junk"]),
				mailbox("m-drafts", "a1", "[Gmail]/Drafts", ["Drafts"]),
				mailbox("m-custom", "a1", "Projects/Remit"),
				mailbox("m-trash", "a1", "[Gmail]/Trash", ["Trash"]),
			],
		});

		const { searchMailboxIds } = await buildInboxMailboxMap(CONFIG_ID, client);

		assert.deepEqual(
			[...searchMailboxIds].sort(),
			[
				"m-archive",
				"m-custom",
				"m-drafts",
				"m-inbox",
				"m-junk",
				"m-sent",
				"m-sub",
			],
			"Spam and Drafts are in scope; Trash is not",
		);
	});

	// Trash is matched by path too, for servers that do not advertise the
	// special-use attribute.
	test("Trash is excluded without a special-use attribute", async () => {
		const client = buildClient([account("a1")], {
			a1: [
				mailbox("m-inbox", "a1", "INBOX"),
				mailbox("m-trash", "a1", "[Gmail]/Trash"),
				// Whole path, never a prefix — a user's own folder is real mail.
				mailbox("m-trash-talk", "a1", "Trash talk"),
			],
		});

		const { searchMailboxIds } = await buildInboxMailboxMap(CONFIG_ID, client);
		assert.deepEqual([...searchMailboxIds].sort(), ["m-inbox", "m-trash-talk"]);
	});

	// A row is keyed by (threadId, messageId), both mailbox-independent, so
	// Gmail's copies collapse into ONE row owned by whichever mailbox synced it
	// first. Barring the virtual folders from the scope would therefore delete
	// the only row such a message has — mail that exists and cannot be found.
	test("the virtual copies stay IN the search scope, so mail they own is findable", async () => {
		const client = buildClient([account("a1")], {
			a1: [
				mailbox("m-inbox", "a1", "INBOX"),
				mailbox("m-all", "a1", "[Gmail]/All Mail", ["All"]),
				mailbox("m-starred", "a1", "[Gmail]/Starred", ["Flagged"]),
				mailbox("m-important", "a1", "[Gmail]/Important", ["Important"]),
			],
		});

		const { searchMailboxIds, virtualCopyMailboxIds } =
			await buildInboxMailboxMap(CONFIG_ID, client);

		assert.deepEqual(
			[...searchMailboxIds].sort(),
			["m-all", "m-important", "m-inbox", "m-starred"],
			"nothing is barred — duplicates are dropped after the read instead",
		);
		assert.deepEqual(
			[...virtualCopyMailboxIds].sort(),
			["m-all", "m-important", "m-starred"],
			"they are still identified, to decide which duplicate to drop",
		);
	});

	test("a user folder named like a virtual copy is not treated as one", async () => {
		const client = buildClient([account("a1")], {
			a1: [
				mailbox("m-starred-ideas", "a1", "Starred ideas"),
				mailbox("m-important-clients", "a1", "Important clients"),
			],
		});

		const { virtualCopyMailboxIds } = await buildInboxMailboxMap(
			CONFIG_ID,
			client,
		);
		assert.equal(virtualCopyMailboxIds.size, 0);
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

// A backend that keys a row by its mailbox returns one row per Gmail copy, so
// a starred, Important inbox message arrives four times and crowds genuine
// matches off the page. Dropping the extras here — rather than barring the
// virtual folders from the scope — keeps the message reachable when the only
// row it has sits in one of them.
describe("dedupeByMessageId", () => {
	const row = (messageId: string, mailboxId: string) => ({
		messageId,
		mailboxId,
	});
	const virtual = new Set(["m-all", "m-starred", "m-important"]);
	const isVirtual = (r: { mailboxId: string }) => virtual.has(r.mailboxId);

	test("a starred, Important Gmail inbox message collapses to one row", () => {
		const deduped = dedupeByMessageId(
			[
				row("msg-1", "m-inbox"),
				row("msg-1", "m-all"),
				row("msg-1", "m-starred"),
				row("msg-1", "m-important"),
			],
			isVirtual,
		);

		assert.equal(deduped.length, 1);
		assert.equal(deduped[0].mailboxId, "m-inbox");
	});

	test("the real folder wins even when a virtual copy came first", () => {
		const deduped = dedupeByMessageId(
			[row("msg-1", "m-all"), row("msg-1", "m-archive")],
			isVirtual,
		);

		assert.deepEqual(
			deduped.map((r) => r.mailboxId),
			["m-archive"],
		);
	});

	// The case the scope exclusion would have broken: nothing but a virtual
	// copy holds this message, so that row must survive.
	test("a message that exists only in a virtual folder is kept", () => {
		const deduped = dedupeByMessageId([row("msg-1", "m-starred")], isVirtual);

		assert.deepEqual(
			deduped.map((r) => r.mailboxId),
			["m-starred"],
		);
	});

	test("the same mail in two real folders keeps the first, newest by order", () => {
		const deduped = dedupeByMessageId(
			[row("msg-1", "m-archive"), row("msg-1", "m-custom")],
			isVirtual,
		);

		assert.deepEqual(
			deduped.map((r) => r.mailboxId),
			["m-archive"],
		);
	});

	test("distinct messages are all kept, in order", () => {
		const deduped = dedupeByMessageId(
			[
				row("msg-1", "m-inbox"),
				row("msg-2", "m-archive"),
				row("msg-3", "m-junk"),
			],
			isVirtual,
		);

		assert.deepEqual(
			deduped.map((r) => r.messageId),
			["msg-1", "msg-2", "msg-3"],
		);
	});

	test("an empty page stays empty", () => {
		assert.deepEqual(dedupeByMessageId([], isVirtual), []);
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
