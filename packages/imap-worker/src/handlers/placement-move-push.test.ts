import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	eml,
	FakeImapServer,
} from "@remit/mailbox-service/test-helpers/fake-imap";
import { attemptMove } from "./placement-move-push.js";

const HEADER = "<abc@example.com>";

/** Junk holds the message at uid 42; INBOX is where the placement sends it. */
const arrange = (
	options: { inJunk?: boolean; inInbox?: boolean; inboxExists?: boolean } = {},
) => {
	const server = new FakeImapServer();
	server.addFolder("Junk");
	if (options.inboxExists !== false) server.addFolder("INBOX");
	if (options.inJunk !== false)
		server.deliver("Junk", eml({ "Message-ID": HEADER }), { uid: 42 });
	if (options.inInbox) server.deliver("INBOX", eml({ "Message-ID": HEADER }));
	return server;
};

const move = (
	server: FakeImapServer,
	header: string | undefined = HEADER,
	source = server.connection(),
) => attemptMove(source, server.connection(), "Junk", "INBOX", 42, header);

describe("attemptMove — the IMAP push (issue #1271)", () => {
	it("moves the message and returns the uid from the COPYUID map", async () => {
		const server = arrange();

		const outcome = await move(server);

		assert.deepEqual(outcome, {
			kind: "moved",
			newUid: server.uids("INBOX", HEADER)[0],
		});
		assert.deepEqual(server.uids("Junk"), []);
	});

	it("answers trycreate when the destination does not exist yet", async () => {
		const server = arrange({ inboxExists: false });

		assert.equal((await move(server)).kind, "trycreate");
	});

	it("propagates any other failure untouched for the caller to retry", async () => {
		const server = arrange();
		server.failNext.MOVE = new Error("ECONNRESET");

		await assert.rejects(move(server), /ECONNRESET/);
	});

	// PR #1289 review finding 2: neither a missing COPYUID entry nor an explicit
	// not-found is trusted without asking the server.
	it("confirms a move by Message-ID when the server sends no COPYUID", async () => {
		const server = arrange();
		server.uidplus = false;

		const outcome = await move(server);

		assert.deepEqual(outcome, {
			kind: "moved",
			newUid: server.uids("INBOX", HEADER)[0],
		});
	});

	it("confirms a move by Message-ID when the server answers NONEXISTENT for one that landed", async () => {
		const server = arrange({ inJunk: false, inInbox: true });
		server.failNext.MOVE = new Error(
			"Command failed: NONEXISTENT no such message",
		);

		const outcome = await move(server);

		assert.deepEqual(outcome, {
			kind: "moved",
			newUid: server.uids("INBOX", HEADER)[0],
		});
	});

	// Issue #1122: the destination already held an older copy, and the row must
	// bind to the one this MOVE delivered.
	it("binds to the newest copy when the destination already held an older one", async () => {
		const server = arrange({ inInbox: true });
		server.uidplus = false;

		const outcome = await move(server);

		assert.deepEqual(outcome, {
			kind: "moved",
			newUid: Math.max(...server.uids("INBOX", HEADER)),
		});
	});

	it("never settles a move the destination does not confirm while the source still holds it", async () => {
		const server = arrange();
		server.uidplus = false;
		server.ignoreNext.add("MOVE");

		await assert.rejects(move(server), /unresolved/);
	});

	it("never settles when the source FETCH drops the row for a message the server still lists", async () => {
		const server = arrange();
		server.uidplus = false;
		server.ignoreNext.add("MOVE");
		const source = server.connection();
		source.fetchMessages = async () => [];

		await assert.rejects(move(server, HEADER, source), /unresolved/);
	});

	it("answers not-found once neither folder holds the message", async () => {
		const server = arrange({ inJunk: false });
		server.uidplus = false;

		assert.equal((await move(server)).kind, "not-found");
	});

	it("falls back to the source alone without a Message-ID, and still never settles while it holds the message", async () => {
		const server = arrange();
		server.uidplus = false;
		server.ignoreNext.add("MOVE");

		await assert.rejects(move(server, undefined));
	});

	it("answers not-found without a Message-ID once the source no longer holds the message", async () => {
		const server = arrange({ inJunk: false });
		server.uidplus = false;

		assert.equal((await move(server, undefined)).kind, "not-found");
	});
});
