/**
 * A move whose event dies must not leave its row `moving`, and a row already
 * left there must be re-driven to whatever the server says (imap-mutations R1).
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import {
	SendMessageBatchCommand,
	SendMessageCommand,
} from "@aws-sdk/client-sqs";
import type { MailboxItem, MessageItem } from "@remit/data-ports";
import {
	MailboxCursorState,
	MailboxSpecialUse,
	MessageMutation,
	MessageStatus,
	MessageSyncStatus,
} from "@remit/domain-enums";
import { PlacementMoveService } from "@remit/mailbox-service";
import type { MessageMoveEvent, PlacementMovePushEvent } from "./events.js";
import { handleMessageMove } from "./handlers/message-move.js";
import { handlePlacementMovePush } from "./handlers/placement-move-push.js";
import {
	redriveStrandedPlacements,
	STRANDED_PLACEMENT_AFTER_MILLIS,
	type StrandedPlacementEvent,
} from "./scheduler/stranded-placement-redrive.js";
import {
	openStore,
	type SeededMessage,
	type World,
} from "./test-helpers/test-world.js";

let store: Awaited<ReturnType<typeof openStore>>;

before(async () => {
	store = await openStore();
});

after(() => store.close());

interface Arranged {
	w: World;
	inbox: MailboxItem;
	notifications: MailboxItem;
	trash: MailboxItem;
	siblingTravel: MailboxItem;
	message: SeededMessage;
	seededSyncStatus: MessageItem["syncStatus"] | undefined;
}

const arrange = async (
	seedIn: "inbox" | "trash" = "inbox",
): Promise<Arranged> => {
	const w = await store.world();
	const inbox = await w.folder("INBOX");
	const notifications = await w.folder("INBOX/Notifications");
	const trash = await w.folder("Trash", {
		specialUse: MailboxSpecialUse.Trash,
	});
	const siblingTravel = await w.siblingFolder("INBOX/Travel");
	const message = await w.message(seedIn === "inbox" ? inbox : trash);
	const seeded = await w.row(message.messageId);
	return {
		w,
		inbox,
		notifications,
		trash,
		siblingTravel,
		message,
		seededSyncStatus: seeded?.syncStatus,
	};
};

const placementMover = (w: World): PlacementMoveService =>
	new PlacementMoveService({
		messageService: w.client.message,
		threadMessageService: w.client.threadMessage,
		markerService: w.client.placementMove,
		addressService: w.client.address,
		mailboxSpecialUseService: w.client.mailboxSpecialUse,
		mailboxService: w.client.mailbox,
		sqsQueueUrl: process.env.SQS_QUEUE_URL_MESSAGE_MGMT ?? "",
	});

const placementOf = async (a: Arranged) => {
	const row = await a.w.row(a.message.messageId);
	const [listing] = await a.w.threadRows(a.message.messageId);
	return {
		status: row?.status,
		syncStatus: row?.syncStatus,
		mailboxId: row?.mailboxId,
		uid: row?.uid,
		listedIn: listing?.mailboxId,
		listedDeleted: listing?.isDeleted,
	};
};

const backIn = (a: Arranged, mailbox: MailboxItem) => ({
	status: MessageStatus.active,
	syncStatus: MessageSyncStatus.synced,
	mailboxId: mailbox.mailboxId,
	uid: a.message.uid,
	listedIn: mailbox.mailboxId,
	listedDeleted: false,
});

/** As the sync left it, before any mutation touched it. */
const untouched = (a: Arranged, mailbox: MailboxItem) => ({
	...backIn(a, mailbox),
	syncStatus: a.seededSyncStatus,
});

const gone = {
	status: undefined,
	syncStatus: undefined,
	mailboxId: undefined,
	uid: undefined,
	listedIn: undefined,
	listedDeleted: undefined,
};

const queueRefuses = (w: World): void => {
	w.queue.on(SendMessageCommand).rejects(new Error("queue unreachable"));
	w.queue.on(SendMessageBatchCommand).rejects(new Error("queue unreachable"));
};

const queueTakes = (w: World): void => {
	w.queue.on(SendMessageCommand).resolves({});
	w.queue.on(SendMessageBatchCommand).resolves({ Failed: [] });
};

const redriveLater = async (
	a: Arranged,
	byMillis = STRANDED_PLACEMENT_AFTER_MILLIS + 60_000,
): Promise<StrandedPlacementEvent[]> => {
	const emitted: StrandedPlacementEvent[] = [];
	await redriveStrandedPlacements(
		{
			client: a.w.client,
			emit: async (event) => {
				emitted.push(event);
			},
			log: a.w.log,
		},
		a.w.account,
		Date.now() + byMillis,
	);
	return emitted;
};

const stamped = <T>(event: StrandedPlacementEvent | undefined): T => {
	if (!event) throw new Error("nothing was re-driven");
	return { ...event, eventId: randomUUID(), timestamp: Date.now() } as T;
};

/**
 * The state the producer wrote before it checked whose folder it was filing
 * into, and which the production rows still carry.
 */
const strandForeignFiling = async (
	a: Arranged,
	marker: "with-marker" | "marker-dropped",
): Promise<void> => {
	const { w, message, inbox, siblingTravel } = a;
	if (marker === "with-marker") {
		await w.client.placementMove.put({
			messageId: message.messageId,
			accountId: w.account.accountId,
			accountConfigId: w.account.accountConfigId,
			sourceMailboxId: inbox.mailboxId,
			destinationMailboxId: siblingTravel.mailboxId,
		});
	}
	await w.client.message.transitionPlacement(
		message.messageId,
		{
			status: MessageStatus.active,
			mailboxId: inbox.mailboxId,
			uid: message.uid,
		},
		{
			mailboxId: siblingTravel.mailboxId,
			status: MessageStatus.moving,
			syncStatus: MessageSyncStatus.pending,
			abandonedMutation: MessageMutation.none,
			originalMailboxId: inbox.mailboxId,
			originalUid: message.uid,
		},
	);
	const listing = await w.client.threadMessage.getByMessageId(
		w.account.accountConfigId,
		message.messageId,
	);
	await w.client.threadMessage.update(
		listing.accountConfigId,
		listing.threadMessageId,
		{ mailboxId: siblingTravel.mailboxId },
		{
			composites: {
				sentDate: listing.sentDate,
				mailboxId: listing.mailboxId,
				isRead: listing.isRead,
				isDeleted: listing.isDeleted,
				hasStars: listing.hasStars,
				hasAttachment: listing.hasAttachment,
			},
		},
	);
};

describe("a move whose event dies leaves no row moving", () => {
	it("refuses a filing into another account's folder before any local write", async () => {
		const a = await arrange();

		const outcome = await placementMover(a.w).moveMessage(
			a.w.account.accountConfigId,
			a.message.messageId,
			a.siblingTravel.mailboxId,
			a.w.account.accountId,
		);

		assert.equal(outcome, "refused");
		assert.deepEqual(await placementOf(a), untouched(a, a.inbox));
		assert.equal(
			await a.w.client.placementMove.find(a.message.messageId),
			null,
		);
		assert.deepEqual(
			a.w.queued().filter((event) => event.type === "PLACEMENT_MOVE_PUSH"),
			[],
		);
	});

	it("hands back a user move whose event the queue never took", async () => {
		const a = await arrange();
		queueRefuses(a.w);

		await assert.rejects(
			a.w.client.messageMove.moveMessage(
				a.w.account.accountConfigId,
				a.message.messageId,
				a.notifications.mailboxId,
				a.w.account.accountId,
			),
			/queue unreachable/,
		);

		assert.deepEqual(await placementOf(a), backIn(a, a.inbox));
	});

	it("hands back a move to Trash whose batch entry the queue refused", async () => {
		const a = await arrange();
		a.w.queue.on(SendMessageBatchCommand).resolves({
			Failed: [{ Id: "0", Code: "InvalidParameterValue", SenderFault: true }],
		});

		await assert.rejects(
			a.w.client.messageMove.deleteMessages(
				a.w.account.accountConfigId,
				[a.message.messageId],
				a.w.account.accountId,
			),
			/refused 1 of 1/,
		);

		assert.deepEqual(await placementOf(a), backIn(a, a.inbox));
	});

	it("finishes the local removal of a permanent delete whose batch send failed", async () => {
		const a = await arrange();
		queueRefuses(a.w);

		await assert.rejects(
			a.w.client.messageMove.deleteMessages(
				a.w.account.accountConfigId,
				[a.message.messageId],
				a.w.account.accountId,
				{ permanent: true },
			),
			/queue unreachable/,
		);

		assert.deepEqual(await placementOf(a), gone);
		assert.deepEqual(await redriveLater(a), [], "nothing is left deleting");
	});

	it("puts Trash back when the queue never took its Empty Trash", async () => {
		const a = await arrange("trash");
		queueRefuses(a.w);

		await assert.rejects(
			a.w.client.messageMove.emptyTrash(
				a.w.account.accountConfigId,
				a.w.account.accountId,
			),
			/queue unreachable/,
		);

		assert.deepEqual(await placementOf(a), untouched(a, a.trash));
	});

	it("leaves a row already being deleted as it was when Empty Trash never left", async () => {
		const a = await arrange("trash");
		await a.w.client.message.transitionPlacement(
			a.message.messageId,
			{ status: MessageStatus.active, mailboxId: a.trash.mailboxId },
			{ status: MessageStatus.deleting, syncStatus: MessageSyncStatus.failed },
		);
		const listing = await a.w.client.threadMessage.getByMessageId(
			a.w.account.accountConfigId,
			a.message.messageId,
		);
		await a.w.client.threadMessage.update(
			listing.accountConfigId,
			listing.threadMessageId,
			{ isDeleted: true },
			{
				composites: {
					sentDate: listing.sentDate,
					mailboxId: listing.mailboxId,
					isRead: listing.isRead,
					isDeleted: listing.isDeleted,
					hasStars: listing.hasStars,
					hasAttachment: listing.hasAttachment,
				},
			},
		);
		queueRefuses(a.w);

		await assert.rejects(
			a.w.client.messageMove.emptyTrash(
				a.w.account.accountConfigId,
				a.w.account.accountId,
			),
			/queue unreachable/,
		);

		assert.deepEqual(await placementOf(a), {
			status: MessageStatus.deleting,
			syncStatus: MessageSyncStatus.failed,
			mailboxId: a.trash.mailboxId,
			uid: a.message.uid,
			listedIn: a.trash.mailboxId,
			listedDeleted: true,
		});
	});

	it("drops the copy row when the queue never took its copy", async () => {
		const a = await arrange();
		queueRefuses(a.w);

		await assert.rejects(
			a.w.client.messageMove.copyMessage(
				a.w.account.accountConfigId,
				a.message.messageId,
				a.notifications.mailboxId,
				a.w.account.accountId,
			),
			/queue unreachable/,
		);

		assert.deepEqual(
			await a.w.client.message.listAllByMailbox(a.notifications.mailboxId),
			[],
		);
		assert.deepEqual(await placementOf(a), untouched(a, a.inbox));
	});

	it("reports both the queue's error and a hand-back that failed", async () => {
		const a = await arrange();
		queueRefuses(a.w);
		const repo = a.w.client.message;
		const original = repo.transitionPlacement;
		let calls = 0;
		repo.transitionPlacement = async (...args) => {
			calls += 1;
			if (calls > 1) throw new Error("SQLITE_BUSY");
			return original.apply(repo, args);
		};

		await assert
			.rejects(
				a.w.client.messageMove.moveMessage(
					a.w.account.accountConfigId,
					a.message.messageId,
					a.notifications.mailboxId,
					a.w.account.accountId,
				),
				(error: unknown) => {
					assert.ok(error instanceof AggregateError);
					assert.deepEqual(
						error.errors.map((inner: Error) => inner.message),
						["queue unreachable", "SQLITE_BUSY"],
					);
					return true;
				},
			)
			.finally(() => {
				repo.transitionPlacement = original;
			});
	});
});

describe("the reconcile re-drives a move or delete already stranded", () => {
	it("re-sends the push for a filing whose push was never queued", async () => {
		const a = await arrange();
		queueRefuses(a.w);
		await assert.rejects(
			placementMover(a.w).moveMessage(
				a.w.account.accountConfigId,
				a.message.messageId,
				a.notifications.mailboxId,
				a.w.account.accountId,
			),
		);
		assert.equal(
			(await a.w.client.placementMove.find(a.message.messageId))?.state,
			"pending",
		);

		assert.deepEqual(await redriveLater(a), [
			{
				type: "PLACEMENT_MOVE_PUSH",
				accountId: a.w.account.accountId,
				accountConfigId: a.w.account.accountConfigId,
				messageId: a.message.messageId,
			},
		]);
	});

	it("files a stranded move on the server through the move it re-sends", async () => {
		const a = await arrange();
		queueTakes(a.w);
		await a.w.client.messageMove.moveMessage(
			a.w.account.accountConfigId,
			a.message.messageId,
			a.notifications.mailboxId,
			a.w.account.accountId,
		);

		const [move] = await redriveLater(a);
		assert.equal(move?.type, "MESSAGE_MOVE");
		await handleMessageMove(
			stamped<MessageMoveEvent>(move),
			a.w.log,
			1,
			a.w.scope,
		);

		const settled = await a.w.row(a.message.messageId);
		assert.equal(settled?.status, MessageStatus.active);
		assert.equal(settled?.mailboxId, a.notifications.mailboxId);
		assert.equal(
			a.w.imap.uids(a.notifications.fullPath).includes(settled?.uid ?? -1),
			true,
		);
	});

	it("hands back a foreign filing through the push it re-sends", async () => {
		const a = await arrange();
		await strandForeignFiling(a, "with-marker");

		const [push] = await redriveLater(a);
		assert.equal(push?.type, "PLACEMENT_MOVE_PUSH");
		await handlePlacementMovePush(
			stamped<PlacementMovePushEvent>(push),
			a.w.log,
			1,
			a.w.scope,
		);

		assert.deepEqual(await placementOf(a), backIn(a, a.inbox));
		assert.equal(
			await a.w.client.placementMove.find(a.message.messageId),
			null,
		);
	});

	it("re-sends a move for a foreign filing whose marker is gone, and the move hands it back", async () => {
		const a = await arrange();
		await strandForeignFiling(a, "marker-dropped");

		const emitted = await redriveLater(a);
		assert.deepEqual(emitted, [
			{
				type: "MESSAGE_MOVE",
				schemaVersion: 3,
				accountId: a.w.account.accountId,
				messageId: a.message.messageId,
				sourceMailboxId: a.inbox.mailboxId,
				destinationMailboxId: a.siblingTravel.mailboxId,
				uid: a.message.uid,
			},
		]);

		await handleMessageMove(
			stamped<MessageMoveEvent>(emitted[0]),
			a.w.log,
			1,
			a.w.scope,
		);

		assert.deepEqual(await placementOf(a), backIn(a, a.inbox));
	});

	it("reconciles a filing away when its source folder is gone", async () => {
		const a = await arrange();
		await strandForeignFiling(a, "with-marker");
		await a.w.client.mailbox.delete(a.w.account.accountId, a.inbox.mailboxId);

		await handlePlacementMovePush(
			stamped<PlacementMovePushEvent>({
				type: "PLACEMENT_MOVE_PUSH",
				accountId: a.w.account.accountId,
				accountConfigId: a.w.account.accountConfigId,
				messageId: a.message.messageId,
			}),
			a.w.log,
			1,
			a.w.scope,
		);

		assert.deepEqual(await placementOf(a), gone);
		assert.equal(
			await a.w.client.placementMove.find(a.message.messageId),
			null,
		);
	});

	it("re-sends the delete for a move to Trash whose event was lost", async () => {
		const a = await arrange();
		queueTakes(a.w);
		await a.w.client.messageMove.deleteMessages(
			a.w.account.accountConfigId,
			[a.message.messageId],
			a.w.account.accountId,
		);

		assert.deepEqual(await redriveLater(a), [
			{
				type: "MESSAGE_DELETE",
				schemaVersion: 3,
				accountId: a.w.account.accountId,
				messageId: a.message.messageId,
				mailboxId: a.inbox.mailboxId,
				uid: a.message.uid,
				operation: "move_to_trash",
				destinationMailboxId: a.trash.mailboxId,
			},
		]);
	});

	it("re-sends the expunge for a permanent delete whose event was lost", async () => {
		const a = await arrange();
		queueTakes(a.w);
		await a.w.client.messageMove.deleteMessages(
			a.w.account.accountConfigId,
			[a.message.messageId],
			a.w.account.accountId,
			{ permanent: true },
		);

		assert.deepEqual(await redriveLater(a), [
			{
				type: "MESSAGE_DELETE",
				schemaVersion: 3,
				accountId: a.w.account.accountId,
				messageId: a.message.messageId,
				mailboxId: a.inbox.mailboxId,
				uid: a.message.uid,
				operation: "permanent_delete",
			},
		]);
	});

	it("passes over a move while a folder it touches awaits a cursor rebuild", async () => {
		const a = await arrange();
		queueTakes(a.w);
		await a.w.client.messageMove.moveMessage(
			a.w.account.accountConfigId,
			a.message.messageId,
			a.notifications.mailboxId,
			a.w.account.accountId,
		);
		await a.w.client.mailbox.update(a.w.account.accountId, a.inbox.mailboxId, {
			cursorState: MailboxCursorState.rebuilding,
		});

		assert.deepEqual(await redriveLater(a), []);

		await a.w.client.mailbox.update(a.w.account.accountId, a.inbox.mailboxId, {
			cursorState: MailboxCursorState.normal,
		});
		assert.deepEqual(
			(await redriveLater(a)).map((event) => event.type),
			["MESSAGE_MOVE"],
		);
	});

	it("leaves a move inside its budget, a just re-driven move, and a copy alone", async () => {
		const a = await arrange();
		queueTakes(a.w);
		await a.w.client.messageMove.moveMessage(
			a.w.account.accountConfigId,
			a.message.messageId,
			a.notifications.mailboxId,
			a.w.account.accountId,
		);
		const copied = await a.w.message(a.inbox);
		await a.w.client.messageMove.copyMessage(
			a.w.account.accountConfigId,
			copied.messageId,
			a.notifications.mailboxId,
			a.w.account.accountId,
		);

		assert.deepEqual(await redriveLater(a, 0), [], "inside the budget");
		assert.deepEqual(
			(await redriveLater(a)).map((event) => event.type),
			["MESSAGE_MOVE"],
			"the copy carries no source pair to re-drive",
		);
		assert.deepEqual(
			await redriveLater(a, STRANDED_PLACEMENT_AFTER_MILLIS / 2),
			[],
			"a re-driven row waits out the budget again",
		);
		assert.equal(
			(await a.w.row(a.message.messageId))?.status,
			MessageStatus.moving,
		);
	});
});
