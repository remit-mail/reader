import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	MailboxAttribute,
	MessageKeywordFlag,
	MessageSystemFlag,
} from "@remit/domain-enums";

/**
 * RFC 9051 §2.3.2 system flags and §7.3.1 mailbox attributes are
 * backslash-prefixed on the wire, and these enum values reach an IMAP server
 * verbatim: `handleFlagPush` passes a marker's `flagName` straight to
 * `ImapFlowConnection.addFlags`/`removeFlags`. A value that has lost its
 * backslash is still a legal STORE argument — the server takes it as a custom
 * keyword — so the push silently sets the wrong thing rather than failing.
 *
 * These enums are generated, and the emitter writes their values into
 * JavaScript source where an unescaped `\S` collapses to `S` (issue #64).
 * Pin the exact bytes so a regression fails here instead of on a real
 * mailbox.
 */
const SYSTEM_FLAG_WIRE_FORMAT = {
	Seen: "\\Seen",
	Answered: "\\Answered",
	Flagged: "\\Flagged",
	Deleted: "\\Deleted",
	Draft: "\\Draft",
} as const;

const MAILBOX_ATTRIBUTE_WIRE_FORMAT = {
	NonExistent: "\\NonExistent",
	NoInferiors: "\\Noinferiors",
	NoSelect: "\\Noselect",
	HasChildren: "\\HasChildren",
	HasNoChildren: "\\HasNoChildren",
	Marked: "\\Marked",
	Unmarked: "\\Unmarked",
	Subscribed: "\\Subscribed",
	Remote: "\\Remote",
} as const;

describe("IMAP system flag wire format (issue #64)", () => {
	it("carries the RFC 9051 backslash prefix on every member", () => {
		assert.deepEqual({ ...MessageSystemFlag }, { ...SYSTEM_FLAG_WIRE_FORMAT });
	});

	for (const [name, wireValue] of Object.entries(SYSTEM_FLAG_WIRE_FORMAT)) {
		it(`${name} is one backslash followed by the flag name`, () => {
			assert.equal(wireValue.charCodeAt(0), 0x5c);
			assert.equal(wireValue.slice(1), name);
			assert.equal(wireValue.length, name.length + 1);
		});
	}

	it("leaves keyword flags unprefixed", () => {
		for (const wireValue of Object.values(MessageKeywordFlag)) {
			assert.equal(wireValue.startsWith("\\"), false);
			assert.equal(wireValue.startsWith("$"), true);
		}
	});
});

describe("IMAP mailbox attribute wire format (issue #64)", () => {
	it("carries the RFC 9051 backslash prefix on every member", () => {
		assert.deepEqual(
			{ ...MailboxAttribute },
			{ ...MAILBOX_ATTRIBUTE_WIRE_FORMAT },
		);
	});

	it("prefixes every value with exactly one backslash", () => {
		for (const wireValue of Object.values(MailboxAttribute)) {
			assert.equal(wireValue.charCodeAt(0), 0x5c);
			assert.equal(wireValue.charCodeAt(1) === 0x5c, false);
		}
	});
});
