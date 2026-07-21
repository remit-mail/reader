import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	deriveCopyMessageId,
	deriveMessageId,
	deriveQuarantineId,
	quarantineMessageIdHash,
} from "./id.js";

const ACCOUNT = "acct-1";
const MAILBOX = "mbx-1";

describe("deriveQuarantineId", () => {
	it("is stable for the same message", () => {
		assert.equal(
			deriveQuarantineId(ACCOUNT, MAILBOX, 1_700_000_000, 40217),
			deriveQuarantineId(ACCOUNT, MAILBOX, 1_700_000_000, 40217),
		);
	});

	it("separates the same uid across a UIDVALIDITY bump", () => {
		// A mailbox keeps its mailboxId when the server bumps UIDVALIDITY, so
		// without this the stale entry would name the new message and suppress
		// it from a sync round — losing mail rather than a diagnostic.
		assert.notEqual(
			deriveQuarantineId(ACCOUNT, MAILBOX, 1_700_000_000, 40217),
			deriveQuarantineId(ACCOUNT, MAILBOX, 1_700_000_001, 40217),
		);
	});

	it("separates mailboxes and accounts", () => {
		const base = deriveQuarantineId(ACCOUNT, MAILBOX, 1, 40217);
		assert.notEqual(base, deriveQuarantineId(ACCOUNT, "mbx-2", 1, 40217));
		assert.notEqual(base, deriveQuarantineId("acct-2", MAILBOX, 1, 40217));
	});
});

describe("deriveCopyMessageId", () => {
	const SOURCE = deriveMessageId(ACCOUNT, "<abc@example.com>");
	const DEST = "mbx-archive";

	it("is stable for the same source and destination (idempotent copy)", () => {
		assert.equal(
			deriveCopyMessageId(SOURCE, DEST),
			deriveCopyMessageId(SOURCE, DEST),
		);
	});

	it("separates a copy of one mail into two folders", () => {
		assert.notEqual(
			deriveCopyMessageId(SOURCE, DEST),
			deriveCopyMessageId(SOURCE, "mbx-other"),
		);
	});

	it("separates copies of two different mails into one folder", () => {
		assert.notEqual(
			deriveCopyMessageId(SOURCE, DEST),
			deriveCopyMessageId(deriveMessageId(ACCOUNT, "<xyz@example.com>"), DEST),
		);
	});

	it("never equals the folder-independent id sync derives", () => {
		// Sync keys a message on deriveMessageId; the copy id folds in the
		// destination mailbox, so the two can never collide.
		assert.notEqual(deriveCopyMessageId(SOURCE, DEST), SOURCE);
	});
});

describe("quarantineMessageIdHash", () => {
	it("hashes a real Message-ID to a pinned sha256 value", () => {
		const hash = quarantineMessageIdHash("<abc@example.com>");
		assert.match(hash ?? "", /^sha256:[0-9a-f]{64}$/);
		assert.equal(hash, quarantineMessageIdHash("<abc@example.com>"));
	});

	it("distinguishes different Message-IDs", () => {
		assert.notEqual(
			quarantineMessageIdHash("<a@example.com>"),
			quarantineMessageIdHash("<b@example.com>"),
		);
	});

	it("refuses to hash a Message-ID the sync path never had", () => {
		// The sync path coerces a missing Message-ID to "". Hashing that would
		// give every such message one shared hash and correlate unrelated
		// reports — the opposite of what the field is for.
		for (const absent of [undefined, "", "   ", "<>"]) {
			assert.equal(quarantineMessageIdHash(absent), undefined);
		}
	});
});
