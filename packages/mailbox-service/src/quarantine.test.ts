import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type {
	AccountItem,
	MailboxItem,
	MessageData,
	MessageItem,
	QuarantineItem,
} from "@remit/data-ports";
import {
	QuarantinedUids,
	QuarantineService,
	resolveMailboxRole,
	shapeFromMessageData,
} from "./quarantine.js";
import {
	openStore,
	seedAccount,
	seedMailbox,
	silentLog,
} from "./test-helpers/store.js";

const store = openStore();
let account: AccountItem;
let spam: MailboxItem;

before(async () => {
	account = await seedAccount(store);
	spam = await seedMailbox(store, account, "Spam", { specialUse: "Junk" });
});
after(() => store.close());

const service = new QuarantineService(
	store.quarantine,
	store.specialUse,
	"sha-abc",
	silentLog,
);

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

describe("QuarantinedUids", () => {
	const entries = [
		{ mailboxId: "mbx-1", uidValidity: 10, uid: 5 },
	] as QuarantineItem[];

	it("matches a uid on the same mailbox and UIDVALIDITY", () => {
		assert.equal(new QuarantinedUids(entries).has("mbx-1", 10, 5), true);
	});

	it("does not match the same uid on a new UIDVALIDITY, which is a different message", () => {
		assert.equal(new QuarantinedUids(entries).has("mbx-1", 11, 5), false);
	});

	it("does not match the same uid in another mailbox", () => {
		assert.equal(new QuarantinedUids(entries).has("mbx-2", 10, 5), false);
	});
});

describe("shapeFromMessageData", () => {
	const message = {
		rfc822Size: 2048,
		messageIdHeader: "<xyz@example.com>",
	} as MessageItem;

	const data = {
		bodyPart: [
			{
				bodyPartId: "bp-0",
				partPath: "0",
				mediaType: "multipart",
				mediaSubtype: "alternative",
				transferEncoding: "7bit",
			},
			{
				bodyPartId: "bp-1",
				partPath: "1",
				mediaType: "text",
				mediaSubtype: "plain",
				transferEncoding: "quoted-printable",
			},
		],
		bodyPartParameter: [
			{
				bodyPartId: "bp-0",
				parameterName: "charset",
				parameterValue: "iso-8859-1",
			},
		],
	} as unknown as MessageData;

	it("rebuilds the tree from the rows metadata sync already wrote", () => {
		assert.deepEqual(shapeFromMessageData(message, data).structure, [
			{ depth: 0, contentType: "multipart/alternative" },
			{ depth: 1, contentType: "text/plain" },
		]);
	});

	it("takes the root part's declared charset and encoding", () => {
		const shape = shapeFromMessageData(message, data);
		assert.equal(shape.charset, "iso-8859-1");
		assert.equal(shape.transferEncoding, "7bit");
		assert.equal(shape.contentType, "multipart/alternative");
	});
});
