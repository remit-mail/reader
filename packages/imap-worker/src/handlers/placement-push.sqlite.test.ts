/**
 * The two pushes body sync leaves behind: a placement move (Junk, a filter's
 * folder) and a flag (auto-mark-read). They ride different queues, so either
 * can reach the server first, and the flag must never land on the uid of a
 * move that has not settled (#496).
 */
import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import type { MailboxItem } from "@remit/data-ports";
import {
	MailboxCursorState,
	MailboxSpecialUse,
	MessageStatus,
} from "@remit/domain-enums";
import { PlacementMoveService } from "@remit/mailbox-service";
import type { FlagPushEvent, PlacementMovePushEvent } from "../events.js";
import {
	openStore,
	type SeededMessage,
	type World,
} from "../test-helpers/test-world.js";
import { FLAG_PUSH_DEFER_MAX_MS, handleFlagPush } from "./flag-push.js";
import { handlePlacementMovePush } from "./placement-move-push.js";

const SEEN = "\\Seen";

let store: Awaited<ReturnType<typeof openStore>>;

before(async () => {
	store = await openStore();
});

after(() => store.close());

interface Arranged {
	w: World;
	inbox: MailboxItem;
	junk: MailboxItem;
	message: SeededMessage;
	placement: PlacementMoveService;
}

const arrange = async (): Promise<Arranged> => {
	const w = await store.world();
	const inbox = await w.folder("INBOX");
	const junk = await w.folder("Junk", { specialUse: MailboxSpecialUse.Junk });
	const message = await w.message(inbox);
	const placement = new PlacementMoveService({
		messageService: w.client.message,
		threadMessageService: w.client.threadMessage,
		markerService: w.client.placementMove,
		addressService: w.client.address,
		mailboxSpecialUseService: w.client.mailboxSpecialUse,
		sqsQueueUrl: process.env.SQS_QUEUE_URL_MESSAGE_MGMT ?? "",
	});
	return { w, inbox, junk, message, placement };
};

const queuedOf = <T>(w: World, type: string): T => {
	const event = w
		.queued()
		.filter((body) => body.type === type)
		.at(-1) as T | undefined;
	assert.ok(event, `a ${type} was enqueued`);
	return event;
};

const markAsRead = async (a: Arranged): Promise<FlagPushEvent> => {
	await a.w.client.flagQueue.markAsRead(
		a.w.account.accountConfigId,
		a.message.messageId,
		a.w.account.accountId,
	);
	return queuedOf<FlagPushEvent>(a.w, "FLAG_PUSH");
};

const moveToJunk = async (a: Arranged): Promise<PlacementMovePushEvent> => {
	await a.placement.moveMessage(
		a.w.account.accountConfigId,
		a.message.messageId,
		a.junk.mailboxId,
		a.w.account.accountId,
	);
	return queuedOf<PlacementMovePushEvent>(a.w, "PLACEMENT_MOVE_PUSH");
};

const pushFlag = (a: Arranged, event: FlagPushEvent, receiveCount = 1) =>
	handleFlagPush(event, a.w.log, receiveCount, a.w.scope);

const pushMove = (
	a: Arranged,
	event: PlacementMovePushEvent,
	receiveCount = 1,
) => handlePlacementMovePush(event, a.w.log, receiveCount, a.w.scope);

const seenOnServer = (a: Arranged, path: string): boolean[] =>
	a.w.imap
		.messages(path)
		.filter((m) => m.messageIdHeader === a.message.messageIdHeader)
		.map((m) => m.flags.includes(SEEN));

describe("a flag push", () => {
	it("stores the flag on the server and clears its marker", async () => {
		const a = await arrange();
		const event = await markAsRead(a);

		await pushFlag(a, event);

		assert.deepEqual(seenOnServer(a, "INBOX"), [true]);
		assert.equal(
			await a.w.client.flagPush.find(a.message.messageId, SEEN),
			null,
		);
	});

	it("waits, without connecting, while the message's placement move has not settled", async () => {
		const a = await arrange();
		await moveToJunk(a);
		const event = await markAsRead(a);

		await pushFlag(a, event);

		assert.equal(a.w.imap.connections, 0);
		assert.equal(
			(await a.w.client.flagPush.find(a.message.messageId, SEEN))?.state,
			"pending",
		);
		assert.deepEqual(seenOnServer(a, "INBOX"), [false]);
	});

	it("lands on the moved message once the placement move has settled", async () => {
		const a = await arrange();
		const move = await moveToJunk(a);
		const flag = await markAsRead(a);
		await pushFlag(a, flag);

		await pushMove(a, move);
		await pushFlag(a, flag);

		assert.deepEqual(a.w.imap.uids("INBOX"), []);
		assert.deepEqual(seenOnServer(a, "Junk"), [true]);
		assert.equal(
			await a.w.client.flagPush.find(a.message.messageId, SEEN),
			null,
		);
	});

	// A move that never settles would otherwise park the flag forever, one
	// queue round trip per sync tick.
	it("drops the marker without connecting once the move has been stuck past the window", async (t) => {
		const a = await arrange();
		await moveToJunk(a);
		const event = await markAsRead(a);
		mock.timers.enable({
			apis: ["Date"],
			now: Date.now() + FLAG_PUSH_DEFER_MAX_MS + 1,
		});
		t.after(() => mock.timers.reset());

		await pushFlag(a, event);

		assert.equal(a.w.imap.connections, 0);
		assert.equal(
			await a.w.client.flagPush.find(a.message.messageId, SEEN),
			null,
		);
		assert.deepEqual(seenOnServer(a, "INBOX"), [false]);
	});

	it("drops the marker without connecting when the mailbox was deleted", async () => {
		const a = await arrange();
		const event = await markAsRead(a);
		await a.w.client.mailbox.delete(a.w.account.accountId, a.inbox.mailboxId);

		await pushFlag(a, event);

		assert.equal(a.w.imap.connections, 0);
		assert.equal(
			await a.w.client.flagPush.find(a.message.messageId, SEEN),
			null,
		);
	});

	it("drops the marker without connecting when the message row is gone", async () => {
		const a = await arrange();
		const event = await markAsRead(a);
		await a.w.client.message.delete(a.message.messageId);

		await pushFlag(a, event);

		assert.equal(a.w.imap.connections, 0);
		assert.equal(
			await a.w.client.flagPush.find(a.message.messageId, SEEN),
			null,
		);
	});

	it("keeps the marker and stores nothing while the cursor is rebuilding", async () => {
		const a = await arrange();
		const event = await markAsRead(a);
		await a.w.client.mailbox.update(a.w.account.accountId, a.inbox.mailboxId, {
			cursorState: MailboxCursorState.rebuilding,
		});

		await pushFlag(a, event);

		assert.equal(a.w.imap.connections, 0);
		assert.ok(await a.w.client.flagPush.find(a.message.messageId, SEEN));
	});

	it("stores nothing when the mailbox's UIDVALIDITY changed under it", async () => {
		const a = await arrange();
		const event = await markAsRead(a);
		a.w.imap.setUidValidity("INBOX", 2);

		await pushFlag(a, event);

		assert.deepEqual(a.w.imap.commands("STORE"), []);
		assert.ok(await a.w.client.flagPush.find(a.message.messageId, SEEN));
	});

	it("keeps the marker and redelivers when the connection drops", async () => {
		const a = await arrange();
		const event = await markAsRead(a);
		a.w.imap.failNext.STORE = new Error("Connection reset");

		await assert.rejects(pushFlag(a, event), /Connection reset/);

		assert.ok(await a.w.client.flagPush.find(a.message.messageId, SEEN));
	});
});

describe("a placement move push", () => {
	it("moves the message on the server, settles the row and clears the marker", async () => {
		const a = await arrange();
		const event = await moveToJunk(a);

		await pushMove(a, event);

		const [junkUid] = a.w.imap.uids("Junk", a.message.messageIdHeader);
		const row = await a.w.row(a.message.messageId);
		assert.equal(row?.mailboxId, a.junk.mailboxId);
		assert.equal(row?.uid, junkUid);
		assert.equal(row?.status, MessageStatus.active);
		assert.equal(
			await a.w.client.placementMove.find(a.message.messageId),
			null,
		);
	});

	it("drops the marker without connecting when a newer move took the message elsewhere", async () => {
		const a = await arrange();
		const event = await moveToJunk(a);
		const archive = await a.w.folder("Archive");
		await a.w.client.message.transitionPlacement(
			a.message.messageId,
			{ mailboxId: a.junk.mailboxId },
			{ mailboxId: archive.mailboxId },
		);

		await pushMove(a, event);

		assert.equal(a.w.imap.connections, 0);
		assert.equal(
			await a.w.client.placementMove.find(a.message.messageId),
			null,
		);
	});

	it("drops the marker without connecting when the destination mailbox was deleted", async () => {
		const a = await arrange();
		const event = await moveToJunk(a);
		await a.w.client.mailbox.delete(a.w.account.accountId, a.junk.mailboxId);

		await pushMove(a, event);

		assert.equal(a.w.imap.connections, 0);
		assert.equal(
			await a.w.client.placementMove.find(a.message.messageId),
			null,
		);
	});

	it("keeps the marker and moves nothing while the source cursor is rebuilding", async () => {
		const a = await arrange();
		const event = await moveToJunk(a);
		await a.w.client.mailbox.update(a.w.account.accountId, a.inbox.mailboxId, {
			cursorState: MailboxCursorState.rebuilding,
		});

		await pushMove(a, event);

		assert.equal(a.w.imap.connections, 0);
		assert.ok(await a.w.client.placementMove.find(a.message.messageId));
		assert.deepEqual(a.w.imap.uids("INBOX"), [a.message.uid]);
	});
});
