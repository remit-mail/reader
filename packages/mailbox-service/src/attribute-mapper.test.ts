import assert from "node:assert";
import { describe, it } from "node:test";
import { MailboxSpecialUse } from "@remit/domain-enums";
import {
	hasChildren,
	isNoSelect,
	parseImapAttributes,
} from "./attribute-mapper.js";

describe("parseImapAttributes special-use", () => {
	it("maps an IMAP \\Junk attribute to the canonical bare enum value", () => {
		const parsed = parseImapAttributes(["\\Junk"]);
		assert.deepStrictEqual(parsed.specialUse, [MailboxSpecialUse.Junk]);
		assert.strictEqual(parsed.specialUse[0], "Junk");
	});

	it("normalizes case-insensitive special-use attributes", () => {
		const parsed = parseImapAttributes(["\\junk", "\\SENT", "\\Drafts"]);
		assert.deepStrictEqual(parsed.specialUse, [
			MailboxSpecialUse.Junk,
			MailboxSpecialUse.Sent,
			MailboxSpecialUse.Drafts,
		]);
	});

	it("emits every value in the bare form the runtime stores and the spec validates", () => {
		const parsed = parseImapAttributes([
			"\\All",
			"\\Archive",
			"\\Drafts",
			"\\Flagged",
			"\\Junk",
			"\\Sent",
			"\\Trash",
			"\\Important",
		]);
		assert.deepStrictEqual(parsed.specialUse, [
			"All",
			"Archive",
			"Drafts",
			"Flagged",
			"Junk",
			"Sent",
			"Trash",
			"Important",
		]);
		assert.ok(parsed.specialUse.every((v) => !v.startsWith("\\")));
	});

	it("separates standard attributes from special-use", () => {
		const parsed = parseImapAttributes(["\\HasChildren", "\\Sent"]);
		assert.deepStrictEqual(parsed.specialUse, [MailboxSpecialUse.Sent]);
		assert.deepStrictEqual(parsed.attributes, ["HasChildren"]);
	});

	it("collects unknown attributes without dropping them", () => {
		const parsed = parseImapAttributes(["\\Junk", "\\SomethingNovel"]);
		assert.deepStrictEqual(parsed.specialUse, [MailboxSpecialUse.Junk]);
		assert.deepStrictEqual(parsed.unknown, ["\\SomethingNovel"]);
	});

	it("yields no special-use for a plain folder", () => {
		const parsed = parseImapAttributes(["\\HasNoChildren"]);
		assert.deepStrictEqual(parsed.specialUse, []);
	});
});

describe("attribute predicates", () => {
	it("detects no-select mailboxes", () => {
		assert.strictEqual(isNoSelect(["\\Noselect"]), true);
		assert.strictEqual(isNoSelect(["\\HasChildren"]), false);
	});

	it("detects mailboxes with children", () => {
		assert.strictEqual(hasChildren(["\\HasChildren"]), true);
		assert.strictEqual(hasChildren(["\\HasNoChildren"]), false);
	});
});
