import assert from "node:assert";
import { describe, test } from "node:test";
import type {
	RemitImapMailboxResponse,
	RemitImapMailboxSpecialUse,
} from "@remit/api-http-client/types.gen.ts";
import { buildMoveTargets, filterMoveTargetsByQuery } from "./move-targets.js";

// The OpenAPI client types special-use values as the RFC 6154 backslashed
// strings (`'\\Sent'`). At runtime the `MailboxSpecialUse` enum resolves to
// the bare names (`"Sent"`) — see the comment in `mailbox-order.ts`. The
// move-target filter normalizes the leading backslash so both shapes match
// the same exclusion set; the tests below fix the OpenAPI shape because
// that's what the rest of the type system expects on the wire.
const flag = (name: string): RemitImapMailboxSpecialUse =>
	`\\${name}` as RemitImapMailboxSpecialUse;
// Bare runtime form is what the JS enum constants actually carry. We force
// it past the OpenAPI type to verify the filter still excludes correctly
// when the wire format drifts. Confined to a single helper so the cast
// doesn't leak into individual tests.
const bareFlag = (name: string): RemitImapMailboxSpecialUse =>
	name as unknown as RemitImapMailboxSpecialUse;

const make = (
	overrides: Partial<RemitImapMailboxResponse> & {
		mailboxId: string;
		fullPath: string;
	},
): RemitImapMailboxResponse =>
	({
		accountId: "acct-1",
		namespaceType: "personal",
		namespacePrefix: "",
		hierarchyDelimiter: "/",
		messageCount: 0,
		unseenCount: 0,
		deletedCount: 0,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}) as RemitImapMailboxResponse;

describe("buildMoveTargets — excluded destinations (#236)", () => {
	test("drops Drafts/Sent when specialUse arrives in backslashed RFC 6154 form (wire shape)", () => {
		const result = buildMoveTargets([
			make({ mailboxId: "m1", fullPath: "INBOX" }),
			make({
				mailboxId: "m2",
				fullPath: "Drafts",
				specialUse: [flag("Drafts")],
			}),
			make({
				mailboxId: "m3",
				fullPath: "Sent",
				specialUse: [flag("Sent")],
			}),
		]);
		const ids = result.map((mailbox) => mailbox.mailboxId);
		assert.deepStrictEqual(ids, ["m1"]);
	});

	test("also drops Drafts/Sent when specialUse arrives in bare runtime form", () => {
		// The runtime `MailboxSpecialUse.*` enum constants carry bare names
		// (`"Sent"`) without the RFC 6154 leading backslash. Existing fixture
		// generators sometimes emit that shape directly. The normalizer in
		// `move-targets.ts` strips a leading backslash so both shapes match the
		// same exclusion set — guard the regression here.
		const result = buildMoveTargets([
			make({ mailboxId: "m1", fullPath: "INBOX" }),
			make({
				mailboxId: "m2",
				fullPath: "Drafts",
				specialUse: [bareFlag("Drafts")],
			}),
			make({
				mailboxId: "m3",
				fullPath: "Sent",
				specialUse: [bareFlag("Sent")],
			}),
		]);
		const ids = result.map((mailbox) => mailbox.mailboxId);
		assert.deepStrictEqual(ids, ["m1"]);
	});

	test("drops Drafts/Outbox/Sent by name alias when no flag is set", () => {
		const result = buildMoveTargets([
			make({ mailboxId: "m1", fullPath: "INBOX" }),
			make({ mailboxId: "m2", fullPath: "Drafts" }),
			make({ mailboxId: "m3", fullPath: "Outbox" }),
			make({ mailboxId: "m4", fullPath: "Sent Mail" }),
		]);
		const ids = result.map((mailbox) => mailbox.mailboxId);
		assert.deepStrictEqual(ids, ["m1"]);
	});

	test("keeps Trash and Spam — both are valid manual destinations", () => {
		const result = buildMoveTargets([
			make({
				mailboxId: "trash",
				fullPath: "Trash",
				specialUse: [flag("Trash")],
			}),
			make({
				mailboxId: "spam",
				fullPath: "Spam",
				specialUse: [flag("Junk")],
			}),
			make({ mailboxId: "inbox", fullPath: "INBOX" }),
		]);
		const ids = result.map((mailbox) => mailbox.mailboxId).sort();
		assert.deepStrictEqual(ids, ["inbox", "spam", "trash"]);
	});

	test("keeps user-defined folders", () => {
		const result = buildMoveTargets([
			make({ mailboxId: "m1", fullPath: "INBOX" }),
			make({ mailboxId: "m2", fullPath: "Project Alpha" }),
			make({ mailboxId: "m3", fullPath: "Receipts/2025" }),
		]);
		const ids = result.map((mailbox) => mailbox.mailboxId);
		assert.deepStrictEqual(ids.sort(), ["m1", "m2", "m3"]);
	});
});

describe("buildMoveTargets — Outbox locale exclusion (#290)", () => {
	// Outbox has no IMAP special-use flag, so we recognize it by name across
	// the locales the curated list covers. Drafts/Sent are flag-driven, so we
	// don't try to localize those here.
	const localizedOutboxNames: readonly string[] = [
		"Outbox",
		"Postvak UIT",
		"Boîte d'envoi",
		"Postausgang",
		"Buzón de salida",
		"Posta in uscita",
		"送信トレイ",
		"送件匣",
		"发件箱",
		"Skrzynka nadawcza",
	];

	for (const name of localizedOutboxNames) {
		test(`drops localized Outbox "${name}"`, () => {
			const result = buildMoveTargets([
				make({ mailboxId: "inbox", fullPath: "INBOX" }),
				make({ mailboxId: "outbox", fullPath: name }),
			]);
			const ids = result.map((mailbox) => mailbox.mailboxId);
			assert.deepStrictEqual(ids, ["inbox"]);
		});
	}

	test("matches Outbox locale names case-insensitively", () => {
		const result = buildMoveTargets([
			make({ mailboxId: "inbox", fullPath: "INBOX" }),
			make({ mailboxId: "m1", fullPath: "POSTVAK UIT" }),
			make({ mailboxId: "m2", fullPath: "postausgang" }),
			make({ mailboxId: "m3", fullPath: "BOÎTE D'ENVOI" }),
		]);
		const ids = result.map((mailbox) => mailbox.mailboxId);
		assert.deepStrictEqual(ids, ["inbox"]);
	});

	test("matches Outbox locale names with surrounding whitespace", () => {
		const result = buildMoveTargets([
			make({ mailboxId: "inbox", fullPath: "INBOX" }),
			make({ mailboxId: "m1", fullPath: "  Outbox  " }),
			make({ mailboxId: "m2", fullPath: " Postvak UIT " }),
		]);
		const ids = result.map((mailbox) => mailbox.mailboxId);
		assert.deepStrictEqual(ids, ["inbox"]);
	});

	test("does not over-match unrelated mailbox names", () => {
		const result = buildMoveTargets([
			make({ mailboxId: "inbox", fullPath: "INBOX" }),
			make({ mailboxId: "trash", fullPath: "Trash" }),
			make({ mailboxId: "custom", fullPath: "Custom Folder" }),
			// Substring of a locale name must not trigger the filter — only
			// the exact normalized leaf matches.
			make({ mailboxId: "outboxy", fullPath: "Outbox Archive" }),
		]);
		const ids = result.map((mailbox) => mailbox.mailboxId).sort();
		assert.deepStrictEqual(ids, ["custom", "inbox", "outboxy", "trash"]);
	});
});

describe("filterMoveTargetsByQuery — always-on filter (#236)", () => {
	test("matches against full path and leaf name, case-insensitive", () => {
		const targets = [
			make({ mailboxId: "m1", fullPath: "INBOX" }),
			make({ mailboxId: "m2", fullPath: "Project Alpha" }),
			make({ mailboxId: "m3", fullPath: "Receipts/2025" }),
		];
		assert.deepStrictEqual(
			filterMoveTargetsByQuery(targets, "alpha").map((m) => m.mailboxId),
			["m2"],
		);
		assert.deepStrictEqual(
			filterMoveTargetsByQuery(targets, "RECEIPTS").map((m) => m.mailboxId),
			["m3"],
		);
		assert.deepStrictEqual(
			filterMoveTargetsByQuery(targets, "2025").map((m) => m.mailboxId),
			["m3"],
		);
	});

	test("returns the full list when query is blank", () => {
		const targets = [
			make({ mailboxId: "m1", fullPath: "INBOX" }),
			make({ mailboxId: "m2", fullPath: "Spam" }),
		];
		assert.equal(filterMoveTargetsByQuery(targets, "").length, 2);
		assert.equal(filterMoveTargetsByQuery(targets, "   ").length, 2);
	});

	test("returns empty when nothing matches", () => {
		const targets = [
			make({ mailboxId: "m1", fullPath: "INBOX" }),
			make({ mailboxId: "m2", fullPath: "Receipts" }),
		];
		assert.deepStrictEqual(filterMoveTargetsByQuery(targets, "zzz"), []);
	});
});
