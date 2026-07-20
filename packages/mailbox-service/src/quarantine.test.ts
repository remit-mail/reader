import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IMailboxSpecialUseRepository,
	IQuarantineRepository,
	MessageData,
	MessageItem,
	QuarantineItem,
	QuarantineUpsertInput,
} from "@remit/data-ports";
import {
	QuarantinedUids,
	QuarantineService,
	resolveMailboxRole,
	shapeFromImapMessage,
	shapeFromMessageData,
} from "./quarantine.js";
import type { ImapMessage } from "./types.js";

const noopLog = { info: () => {}, warn: () => {} };

const buildService = (
	specialUse: string[] = [],
): {
	service: QuarantineService;
	writes: QuarantineUpsertInput[];
	listed: string[];
} => {
	const writes: QuarantineUpsertInput[] = [];
	const listed: string[] = [];
	const repository = {
		listByAccountConfigId: async (accountConfigId: string) => {
			listed.push(accountConfigId);
			return [] as QuarantineItem[];
		},
		upsert: async (input: QuarantineUpsertInput) => {
			writes.push(input);
		},
	} satisfies IQuarantineRepository;

	const mailboxSpecialUseService = {
		listByMailboxId: async () => specialUse.map((use) => ({ specialUse: use })),
	} as unknown as IMailboxSpecialUseRepository;

	return {
		service: new QuarantineService(
			repository,
			mailboxSpecialUseService,
			"sha-abc",
			noopLog,
		),
		writes,
		listed,
	};
};

const context = {
	accountId: "acct-1",
	accountConfigId: "cfg-1",
	mailboxId: "mbx-1",
	mailboxPath: "INBOX",
	uidValidity: 1_712_000_000,
	attempts: 2,
};

const failure = {
	stage: "BodyParse" as const,
	code: "UnreadableBody" as const,
	message: "the parser said no",
};

describe("QuarantineService.record", () => {
	it("stamps the worker build, not the client's", async () => {
		const { service, writes } = buildService();
		await service.record(context, 40217, failure);
		assert.equal(writes[0]?.workerVersion, "sha-abc");
	});

	it("names the message by mailbox, uidValidity and uid", async () => {
		const { service, writes } = buildService();
		await service.record(context, 40217, failure);
		assert.deepEqual(
			{
				mailboxId: writes[0]?.mailboxId,
				uidValidity: writes[0]?.uidValidity,
				uid: writes[0]?.uid,
			},
			{ mailboxId: "mbx-1", uidValidity: 1_712_000_000, uid: 40217 },
		);
	});

	it("supplies no quarantineId, so the random-id default is unreachable", async () => {
		const { service, writes } = buildService();
		await service.record(context, 40217, failure);
		assert.ok(!("quarantineId" in (writes[0] as object)));
	});

	it("omits an absent diagnostic rather than writing a null through", async () => {
		const { service, writes } = buildService();
		await service.record(
			{ ...context, mailboxPath: "Clients/Acme" },
			1,
			failure,
		);
		assert.ok(!("failurePartPath" in (writes[0] as object)));
		assert.ok(!("mailboxRole" in (writes[0] as object)));
	});

	it("reads the folder's role off the server's SPECIAL-USE", async () => {
		const { service, writes } = buildService(["Junk"]);
		await service.record({ ...context, mailboxPath: "Spam" }, 1, failure);
		assert.equal(writes[0]?.mailboxRole, "Junk");
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

describe("shapeFromImapMessage", () => {
	const msg = {
		uid: 1,
		seq: 1,
		flags: [],
		internalDate: new Date(0),
		size: 4096,
		envelope: { messageId: "<abc@example.com>" },
		bodyStructure: {
			type: "multipart/mixed",
			encoding: "7bit",
			parameters: { charset: "utf-8" },
			childNodes: [{ type: "text/plain" }, { type: "image/png" }],
		},
	} as unknown as ImapMessage;

	it("walks the MIME tree pre-order with an explicit depth", () => {
		assert.deepEqual(shapeFromImapMessage(msg).structure, [
			{ depth: 0, contentType: "multipart/mixed" },
			{ depth: 1, contentType: "text/plain" },
			{ depth: 1, contentType: "image/png" },
		]);
	});

	it("hashes the Message-ID rather than carrying it in the clear", () => {
		const { messageIdHash } = shapeFromImapMessage(msg);
		assert.ok(messageIdHash?.startsWith("sha256:"));
		assert.ok(!messageIdHash?.includes("example.com"));
	});

	it("carries no shape at all when the FETCH had no BODYSTRUCTURE", () => {
		const bare = { ...msg, bodyStructure: undefined, size: 0 };
		const shape = shapeFromImapMessage(bare as ImapMessage);
		assert.deepEqual(shape.structure, []);
		assert.equal(shape.contentType, undefined);
		assert.equal(shape.sizeBytes, undefined);
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
