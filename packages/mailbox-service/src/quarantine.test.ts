import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import {
	QuarantineService,
	resolveMailboxRole,
	shapeFromMessageData,
} from "./quarantine.js";
import { eml, FakeImapServer } from "./test-helpers/fake-imap.js";
import {
	arriveAt,
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
	silentLog,
} from "./test-helpers/store.js";

let store: Store;
let account: AccountItem;
let spam: MailboxItem;
let service: QuarantineService;

beforeEach(async () => {
	store = await openStore();
	account = await seedAccount(store);
	spam = await seedMailbox(store, account, "Spam", { specialUse: "Junk" });
	service = new QuarantineService(
		store.quarantine,
		store.mailboxSpecialUse,
		"sha-abc",
		silentLog,
	);
});

afterEach(() => store.close());

const failure = {
	stage: "BodyParse" as const,
	code: "UnreadableBody" as const,
	message: "the parser said no",
};

const record = (uid: number, mailboxPath = "Spam") =>
	service.record(
		{
			accountId: account.accountId,
			accountConfigId: account.accountConfigId,
			mailboxId: spam.mailboxId,
			mailboxPath,
			uidValidity: 1_712_000_000,
			attempts: 2,
		},
		uid,
		failure,
	);

const rows = () =>
	store.quarantine.listByAccountConfigId(account.accountConfigId);

describe("QuarantineService.record", () => {
	it("keeps one record per uid however often the message is set aside", async () => {
		await record(40217);
		await record(40217);

		const recorded = (await rows()).filter((row) => row.uid === 40217);
		assert.equal(recorded.length, 1);
		assert.equal(recorded[0].uidValidity, 1_712_000_000);
		assert.equal(recorded[0].workerVersion, "sha-abc");
		assert.equal(recorded[0].failurePartPath, undefined);
	});

	it("reads the folder's role off the server's SPECIAL-USE", async () => {
		await record(7);

		const [row] = (await rows()).filter((entry) => entry.uid === 7);
		assert.equal(row.mailboxRole, "Junk");
	});

	it("loads what it recorded as the set a sync round skips", async () => {
		await record(8);

		const loaded = await service.load(account.accountConfigId);
		assert.ok(loaded.has(spam.mailboxId, 1_712_000_000, 8));
		assert.ok(!loaded.has(spam.mailboxId, 1_712_000_001, 8));
	});
});

describe("resolveMailboxRole", () => {
	it("gives INBOX its role without a SPECIAL-USE flag, which it never has", () => {
		assert.equal(resolveMailboxRole("INBOX", []), "Inbox");
	});

	it("leaves a plain folder roleless instead of inventing one", () => {
		assert.equal(resolveMailboxRole("Clients/Acme", []), undefined);
	});

	it("drops a SPECIAL-USE that is not a canonical role", () => {
		assert.equal(resolveMailboxRole("Priority", ["Important"]), undefined);
	});
});

describe("shapeFromMessageData", () => {
	it("describes the message from the rows metadata sync wrote", async () => {
		const imap = new FakeImapServer();
		imap.addFolder("Spam");
		const raw = eml({
			"Message-ID": "<xyz@example.com>",
			"Content-Type": "text/plain; charset=iso-8859-1",
			"Content-Transfer-Encoding": "quoted-printable",
		});
		const messageId = await arriveAt(store, imap, account, spam, raw);

		const shape = shapeFromMessageData(
			await store.message.get(messageId),
			await store.envelope.getMessageData(messageId),
		);

		assert.equal(shape.structure.length, 1);
		assert.equal(shape.structure[0].depth, 0);
		assert.match(shape.structure[0].contentType, /^text\/plain$/i);
		assert.equal(shape.charset, "iso-8859-1");
		assert.equal(shape.transferEncoding?.toLowerCase(), "quoted-printable");
		assert.equal(shape.sizeBytes, raw.length);
	});
});
