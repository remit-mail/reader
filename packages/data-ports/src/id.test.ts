import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	base36uuidv5,
	deriveAddressId,
	deriveBodyPartId,
	deriveCopyMessageId,
	deriveEnvelopeId,
	deriveMessageId,
	deriveMessageIdFromSource,
	deriveQuarantineId,
	deriveThreadId,
	normalizeMessageIdHeader,
	quarantineMessageIdHash,
	REMIT_NAMESPACE,
	ROOT_PART_PATH,
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

describe("derived ids are stored primary keys: a changed value orphans every row already written and needs a migration, never a new expectation here", () => {
	const ACCOUNT = "account-golden";
	const MESSAGE = "message-golden";
	const MAILBOX = "mailbox-golden";
	const ABSENT_HEADER_SOURCE = {
		messageId: undefined,
		mailboxId: MAILBOX,
		uid: 40217,
		date: "2026-08-23T00:00:00Z",
		subject: "Golden",
		fromMailbox: "golden",
		fromHost: "example.com",
	};

	it("REMIT_NAMESPACE is the seed of every derived id and can never change", () => {
		assert.equal(REMIT_NAMESPACE, "9e89694d-214b-4d9b-99f5-214b4d9b99f5");
	});

	it("base36uuidv5 pins the encoding every derivation below is built on", () => {
		assert.equal(
			base36uuidv5("golden-seed", REMIT_NAMESPACE),
			"67hxxs95ofdk5frbprqyrgwmo",
		);
	});

	it("deriveAddressId pins the address primary key, lowercased email included", () => {
		assert.equal(
			deriveAddressId(ACCOUNT, "Golden.User@Example.COM"),
			"dzu01kz6aj1ro8fr8l375tfbr",
		);
	});

	it("deriveMessageId pins the message primary key", () => {
		assert.equal(
			deriveMessageId(ACCOUNT, "<golden@example.com>"),
			"bfthbm5n4279aacb5a1q1c94h",
		);
	});

	it("normalizeMessageIdHeader pins the synthetic header that seeds a Message-ID-less message", () => {
		assert.equal(
			normalizeMessageIdHeader(ABSENT_HEADER_SOURCE),
			"generated:mailbox-golden:40217:2026-08-23T00:00:00Z:Golden:golden:example.com",
		);
	});

	it("deriveMessageIdFromSource pins the key of a message that declared no Message-ID", () => {
		assert.equal(
			deriveMessageIdFromSource(ACCOUNT, ABSENT_HEADER_SOURCE),
			"0rae70onzy4ufhlnndqe7lwml",
		);
	});

	it("deriveCopyMessageId pins the key of a message copied into another folder", () => {
		assert.equal(
			deriveCopyMessageId(MESSAGE, MAILBOX),
			"43cwqvpfh4o1fcbmaciabmqo3",
		);
	});

	it("deriveThreadId pins the thread primary key, lowercased root header included", () => {
		assert.equal(
			deriveThreadId(ACCOUNT, "<Golden.Root@Example.COM>"),
			"bcy76e2uat5yq3xd1p7j7z4pr",
		);
	});

	it("deriveEnvelopeId pins the envelope primary key", () => {
		assert.equal(deriveEnvelopeId(MESSAGE), "f1bngysevoxuqt625rd5hvtzt");
	});

	it("ROOT_PART_PATH is baked into stored body part keys and S3 keys", () => {
		assert.equal(ROOT_PART_PATH, "0");
	});

	it("deriveBodyPartId pins the body_part primary key", () => {
		assert.equal(deriveBodyPartId(MESSAGE, "1.2"), "363nl1jzgh77ki2ojk1hqvxxe");
	});

	it("deriveQuarantineId pins the quarantine primary key", () => {
		assert.equal(
			deriveQuarantineId(ACCOUNT, MAILBOX, 1_700_000_000, 40217),
			"4xg2y7x2j7nmvy0wtwgdq8b8p",
		);
	});

	it("quarantineMessageIdHash pins the stored Message-ID hash that correlates reports", () => {
		assert.equal(
			quarantineMessageIdHash("<golden@example.com>"),
			"sha256:5e888fd63760269e96a61e1a09b83ddec28556d0e3cda7e480897e58c8e6a2f5",
		);
	});
});
