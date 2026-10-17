import assert from "node:assert";
import { describe, it } from "node:test";
import type { ThreadMessageItem } from "@remit/data-ports";
import {
	eml,
	FakeImapServer,
} from "@remit/mailbox-service/test-helpers/fake-imap";
import {
	buildThreadMessageMoveUpdate,
	probePausedPlacement,
	searchMailboxForHighestMessageIdUid,
} from "./message-move.js";

const sourceMailboxId = "source-mailbox-id-aaaaaaaaa";
const destinationMailboxId = "destination-mailbox-aaaaa";

const baseThreadMessage = {
	sentDate: 1700000000000,
	mailboxId: sourceMailboxId,
	isRead: true,
	isDeleted: false,
	hasStars: true,
	hasAttachment: false,
} satisfies Pick<
	ThreadMessageItem,
	| "sentDate"
	| "mailboxId"
	| "isRead"
	| "isDeleted"
	| "hasStars"
	| "hasAttachment"
>;

describe("buildThreadMessageMoveUpdate", () => {
	// Regression for the same composites-direction landmine PR #186 fixed in
	// `flag-queue.ts`. The CURRENT row state must go in `composites`; the NEW
	// values must go in `set`. Flipping any of these silently drops the
	// ThreadMessage local update on every IMAP MOVE — the row stays in the
	// source mailbox while the IMAP server thinks it moved.

	it("set carries the NEW uid, mailboxId, and isDeleted=false", () => {
		const args = buildThreadMessageMoveUpdate(
			baseThreadMessage,
			42,
			destinationMailboxId,
		);

		assert.strictEqual(args.set.uid, 42, "set.uid must be the NEW uid");
		assert.strictEqual(
			args.set.mailboxId,
			destinationMailboxId,
			"set.mailboxId must be the NEW destination mailbox",
		);
		assert.strictEqual(
			args.set.isDeleted,
			false,
			"set.isDeleted must be false (move is not a delete)",
		);
	});

	it("composites mirrors every CURRENT indexed attribute on the threadMessage", () => {
		const tm = {
			sentDate: 1700000000123,
			mailboxId: sourceMailboxId,
			isRead: false,
			isDeleted: true,
			hasStars: true,
			hasAttachment: true,
		};

		const args = buildThreadMessageMoveUpdate(tm, 99, destinationMailboxId);

		assert.deepStrictEqual(args.composites, {
			sentDate: tm.sentDate,
			mailboxId: tm.mailboxId,
			isRead: tm.isRead,
			isDeleted: tm.isDeleted,
			hasStars: tm.hasStars,
			hasAttachment: tm.hasAttachment,
		});
	});
});

const _accountId = "alice-account-aaaaaaaaaa";

describe("probePausedPlacement — which folder a paused mutation left the message in (#1203)", () => {
	const HEADER = "<paused@example.com>";

	const serverHolding = (holdings: Record<string, number[]>) => {
		const server = new FakeImapServer();
		server.addFolder("INBOX");
		server.addFolder("Archive");
		for (const [path, uids] of Object.entries(holdings)) {
			for (const uid of uids)
				server.deliver(path, eml({ "Message-ID": HEADER }), { uid: uid });
		}
		return server;
	};

	const opened = (server: FakeImapServer): string[] =>
		server.log
			.filter((line) => /^(SELECT|EXAMINE) /.test(line))
			.map((line) => line.split(" ")[1] ?? "");

	const probe = (
		server: FakeImapServer,
		input: Partial<Parameters<typeof probePausedPlacement>[1]> = {},
	) =>
		probePausedPlacement(server.connection(), {
			messageIdHeader: HEADER,
			sourceMailboxPath: "INBOX",
			destinationMailboxPath: "Archive",
			...input,
		});

	it("stops at the source and never asks the destination when the source still holds it", async () => {
		const server = serverHolding({ INBOX: [4], Archive: [12] });

		assert.deepStrictEqual(await probe(server), { kind: "at-source" });
		assert.deepStrictEqual(
			opened(server),
			["INBOX"],
			"a source hit ends it: with the mutation unrun, every destination hit is an older copy (#1122)",
		);
	});

	it("answers the destination's highest matching uid once the source has let go", async () => {
		const server = serverHolding({ Archive: [12, 77] });

		assert.deepStrictEqual(await probe(server), {
			kind: "at-destination",
			uid: 77,
		});
	});

	it("answers gone when neither folder holds it", async () => {
		assert.deepStrictEqual(await probe(serverHolding({})), { kind: "gone" });
	});

	it("answers gone, not at-source, when there is no destination to ask", async () => {
		const server = serverHolding({});

		assert.deepStrictEqual(
			await probe(server, { destinationMailboxPath: undefined }),
			{ kind: "gone" },
		);
		assert.deepStrictEqual(opened(server), ["INBOX"]);
	});

	// A row with no Message-ID header cannot be asked about, and the server's
	// silence is not an answer. `unprobeable` keeps that distinct from `gone`.
	it("asks nothing at all when the row carries no Message-ID header", async () => {
		const server = serverHolding({ INBOX: [4] });

		assert.deepStrictEqual(
			await probe(server, { messageIdHeader: undefined }),
			{
				kind: "unprobeable",
			},
		);
		assert.deepStrictEqual(server.log, []);
	});
});

describe("searchMailboxForHighestMessageIdUid — the probe that binds a move to a UID (#912)", () => {
	const archiveHolding = (messages: Array<[uid: number, header: string]>) => {
		const server = new FakeImapServer();
		server.addFolder("Archive");
		for (const [uid, header] of messages)
			server.deliver("Archive", eml({ "Message-ID": header }), { uid: uid });
		return server;
	};

	const search = (server: FakeImapServer, header: string) =>
		searchMailboxForHighestMessageIdUid(server.connection(), "Archive", header);

	it("asks the folder by Message-ID rather than by an interpolated string", async () => {
		const server = archiveHolding([]);
		const hostile = '<a"b@example.com>\r\nUID 1';

		await search(server, hostile);

		assert.deepStrictEqual(server.commands("SEARCH"), [
			`SEARCH Archive ${JSON.stringify([["HEADER", "Message-ID", hostile]])}`,
		]);
	});

	it("answers null, not another message's UID, when the folder holds no such message", async () => {
		const server = archiveHolding([
			[11, "<stranger-a@example.com>"],
			[12, "<stranger-b@example.com>"],
		]);

		assert.strictEqual(await search(server, "<moved@example.com>"), null);
	});

	it("answers the UID of the message carrying that Message-ID", async () => {
		const server = archiveHolding([
			[11, "<stranger-a@example.com>"],
			[12, "<moved@example.com>"],
		]);

		assert.strictEqual(await search(server, "<moved@example.com>"), 12);
	});

	// RFC 3501 does not order a SEARCH response, so the fresh copy is the
	// highest uid returned rather than the last one returned.
	it("takes the highest match whatever order the server lists them in", async () => {
		const server = archiveHolding([
			[40, "<moved@example.com>"],
			[12, "<moved@example.com>"],
		]);

		assert.strictEqual(await search(server, "<moved@example.com>"), 40);
	});
});
