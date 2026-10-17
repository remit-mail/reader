/**
 * A move whose event dies must not leave its row `moving`, and a row already
 * left there must be re-driven to whatever the server says (imap-mutations R1).
 * Only the queue (SDK mock) and the mail server (a connection that refuses to
 * open) are stood in for.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	SendMessageBatchCommand,
	SendMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "@remit/backend/client";
import type { AccountItem, MessageItem } from "@remit/data-ports";
import {
	AccountAuthType,
	ConnectionState,
	MailboxCursorState,
	MailboxSpecialUse,
} from "@remit/domain-enums";
import {
	AccountRepo,
	AddressRepo,
	DrizzleMessageRepository,
	DrizzleThreadMessageRepository,
	MailboxLockRepo,
	MailboxRepo,
	MailboxSpecialUseRepo,
	MessagePlacementMoveRepo,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import type { Logger } from "@remit/logger-lambda";
import {
	MessageMoveService,
	PlacementMoveService,
} from "@remit/mailbox-service";
import { mockClient } from "aws-sdk-client-mock";
import type { MessageMoveEvent, PlacementMovePushEvent } from "./events.js";
import {
	handleMessageMove,
	type MessageMoveDeps,
} from "./handlers/message-move.js";
import { handlePlacementMovePush } from "./handlers/placement-move-push.js";
import {
	redriveStrandedPlacements,
	STRANDED_PLACEMENT_AFTER_MILLIS,
	type StrandedPlacementEvent,
} from "./scheduler/stranded-placement-redrive.js";

const CONFIG = "cfg-stranded";
const SOURCE_UID = 42;
const MESSAGE_MGMT_QUEUE =
	"https://sqs.eu-west-1.amazonaws.com/0/test-message-mgmt";

const silentLogger: Logger = (() => {
	const noop = () => {};
	const stub = {
		info: noop,
		warn: noop,
		error: noop,
		debug: noop,
		fatal: noop,
		trace: noop,
		child: () => stub,
	};
	return stub as unknown as Logger;
})();

const sqsMock = mockClient(SQSClient);

interface World {
	client: RemitClient;
	mailboxes: MailboxRepo;
	messages: DrizzleMessageRepository;
	threadMessages: DrizzleThreadMessageRepository;
	markers: MessagePlacementMoveRepo;
	account: AccountItem;
	inbox: string;
	notifications: string;
	trash: string;
	siblingTravel: string;
	close: () => void;
}

let world: World;

const createAccount = (accounts: AccountRepo, email: string) =>
	accounts.create({
		accountConfigId: CONFIG,
		username: email,
		email,
		authType: AccountAuthType.Password,
		passwordHash: '{"ciphertext":"x"}',
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: ConnectionState.Authenticated,
	});

const createMailbox = async (
	mailboxes: MailboxRepo,
	accountId: string,
	fullPath: string,
): Promise<string> => {
	const created = await mailboxes.create({
		accountId,
		namespacePrefix: "",
		hierarchyDelimiter: "/",
		fullPath,
		uidValidity: 7,
		uidNext: 100,
		highestModseq: "1",
		messageCount: 0,
		unseenCount: 0,
		deletedCount: 0,
		totalSize: 0,
		lastSyncUid: 99,
		highWaterMarkUid: 99,
		lastMessageSyncAt: 1,
		cursorState: MailboxCursorState.normal,
	} as Parameters<MailboxRepo["create"]>[0]);
	if (created.outcome !== "Created") throw new Error(`${fullPath} taken`);
	return created.mailbox.mailboxId;
};

const buildWorld = async (): Promise<World> => {
	const store = createShippedSqliteDb();
	const accounts = new AccountRepo(store.db);
	const mailboxes = new MailboxRepo(store.db);
	const specialUse = new MailboxSpecialUseRepo(store.db);
	const messages = new DrizzleMessageRepository(store.db as never);
	const threadMessages = new DrizzleThreadMessageRepository(store.db as never);
	const markers = new MessagePlacementMoveRepo(store.db);
	const client = {
		account: accounts,
		address: new AddressRepo(store.db),
		mailbox: mailboxes,
		mailboxLock: new MailboxLockRepo(store.db),
		mailboxSpecialUse: specialUse,
		message: messages,
		placementMove: markers,
		threadMessage: threadMessages,
	} as unknown as RemitClient;
	setClient(client);

	const account = await createAccount(accounts, "me@example.com");
	const sibling = await createAccount(accounts, "me-too@example.com");
	const trash = await createMailbox(mailboxes, account.accountId, "Trash");
	await specialUse.create(trash, MailboxSpecialUse.Trash);
	return {
		client,
		mailboxes,
		messages,
		threadMessages,
		markers,
		account,
		inbox: await createMailbox(mailboxes, account.accountId, "INBOX"),
		notifications: await createMailbox(
			mailboxes,
			account.accountId,
			"INBOX/Notifications",
		),
		trash,
		siblingTravel: await createMailbox(
			mailboxes,
			sibling.accountId,
			"INBOX/Travel",
		),
		close: store.close,
	};
};

const seedMessage = async (mailboxId = world.inbox): Promise<string> => {
	const messageId = randomUUID();
	await world.messages.create({
		messageId,
		mailboxId,
		uid: SOURCE_UID,
		sequenceNumber: 1,
		rfc822Size: 10,
		internalDate: 1,
		envelopeId: randomUUID(),
		rootBodyPartId: randomUUID(),
		status: "active",
		syncStatus: "synced",
	});
	await world.threadMessages.create({
		accountConfigId: CONFIG,
		threadId: randomUUID(),
		messageId,
		mailboxId,
		uid: SOURCE_UID,
		referenceOrder: 0,
		internalDate: 1,
		sentDate: 1,
		subject: "s",
		fromEmail: "a@example.com",
		fromName: "A",
		snippet: "",
		isRead: false,
		isDeleted: false,
		hasAttachment: false,
		hasStars: false,
	});
	return messageId;
};

/**
 * The state the producer wrote before it refused foreign folders, and which
 * the production rows still carry: a filing into a sibling account's folder.
 */
const strandForeignFiling = async (
	messageId: string,
	marker: "with-marker" | "marker-dropped",
): Promise<void> => {
	if (marker === "with-marker") {
		await world.markers.put({
			messageId,
			accountId: world.account.accountId,
			accountConfigId: CONFIG,
			sourceMailboxId: world.inbox,
			destinationMailboxId: world.siblingTravel,
		});
	}
	await world.messages.transitionPlacement(
		messageId,
		{ status: "active", mailboxId: world.inbox, uid: SOURCE_UID },
		{
			mailboxId: world.siblingTravel,
			status: "moving",
			syncStatus: "pending",
			abandonedMutation: "none",
			originalMailboxId: world.inbox,
			originalUid: SOURCE_UID,
		},
	);
	const [listing] = await world.threadMessages.findAllByMessageId(
		CONFIG,
		messageId,
	);
	if (!listing) throw new Error("no listing row");
	await world.threadMessages.update(
		CONFIG,
		listing.threadMessageId,
		{ mailboxId: world.siblingTravel },
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

const placementMover = (): PlacementMoveService =>
	new PlacementMoveService({
		messageService: world.client.message,
		threadMessageService: world.client.threadMessage,
		markerService: world.client.placementMove,
		addressService: world.client.address,
		mailboxSpecialUseService: world.client.mailboxSpecialUse,
		mailboxService: world.client.mailbox,
		sqsQueueUrl: MESSAGE_MGMT_QUEUE,
	});

const userMover = (): MessageMoveService =>
	new MessageMoveService({
		messageService: world.client.message,
		mailboxService: world.client.mailbox,
		mailboxSpecialUseService: world.client.mailboxSpecialUse,
		threadMessageService: world.client.threadMessage,
		addressService: world.client.address,
		sqsQueueUrl: "https://sqs.eu-west-1.amazonaws.com/0/test-mailboxes.fifo",
	});

const placementOf = async (messageId: string) => {
	const [row] = await world.messages.get([messageId]);
	const listings = await world.threadMessages.findAllByMessageId(
		CONFIG,
		messageId,
	);
	return {
		status: row?.status,
		syncStatus: row?.syncStatus,
		mailboxId: row?.mailboxId,
		uid: row?.uid,
		listedIn: listings[0]?.mailboxId,
		listedDeleted: listings[0]?.isDeleted,
	};
};

const backInInbox = () => ({
	status: "active",
	syncStatus: "synced",
	mailboxId: world.inbox,
	uid: SOURCE_UID,
	listedIn: world.inbox,
	listedDeleted: false,
});

const gone = {
	status: undefined,
	syncStatus: undefined,
	mailboxId: undefined,
	uid: undefined,
	listedIn: undefined,
	listedDeleted: undefined,
};

const sentBodies = (): { type: string }[] =>
	sqsMock
		.commandCalls(SendMessageCommand)
		.map((call) => JSON.parse(call.args[0].input.MessageBody ?? "{}"));

const redriveLater = async (
	byMillis = STRANDED_PLACEMENT_AFTER_MILLIS + 60_000,
): Promise<StrandedPlacementEvent[]> => {
	const emitted: StrandedPlacementEvent[] = [];
	await redriveStrandedPlacements(
		{
			client: world.client,
			emit: async (event) => {
				emitted.push(event);
			},
			log: silentLogger,
		},
		world.account,
		Date.now() + byMillis,
	);
	return emitted;
};

const unreachableServer = (): MessageMoveDeps =>
	({
		getClient: async () => world.client,
		buildLifecycleDeps: () => ({}),
		withOAuthLifecycle: async (
			_deps: unknown,
			_account: unknown,
			_log: unknown,
			work: (credentials: unknown) => Promise<void>,
		) => work({}),
		createConnectionScope: () => ({
			getConnection: async () => {
				throw new Error("this outcome must not need the mail server");
			},
			disconnect: async () => undefined,
		}),
		emitEvent: async () => undefined,
	}) as unknown as MessageMoveDeps;

const stamped = <T>(event: StrandedPlacementEvent | undefined): T => {
	if (!event) throw new Error("nothing was re-driven");
	return { ...event, eventId: randomUUID(), timestamp: Date.now() } as T;
};

beforeEach(async () => {
	sqsMock.reset();
	sqsMock.on(SendMessageCommand).resolves({});
	sqsMock.on(SendMessageBatchCommand).resolves({ Successful: [], Failed: [] });
	world = await buildWorld();
});

afterEach(() => {
	_resetForTest();
	world.close();
});

describe("a move whose event dies leaves no row moving", () => {
	it("refuses a filing into another account's folder before any local write", async () => {
		const messageId = await seedMessage();

		const outcome = await placementMover().moveMessage(
			CONFIG,
			messageId,
			world.siblingTravel,
			world.account.accountId,
		);

		assert.equal(outcome, "refused");
		assert.deepEqual(await placementOf(messageId), backInInbox());
		assert.equal(await world.markers.find(messageId), null);
		assert.deepEqual(sentBodies(), []);
	});

	it("hands back a user move whose event the queue never took", async () => {
		const messageId = await seedMessage();
		sqsMock.on(SendMessageCommand).rejects(new Error("queue unreachable"));

		await assert.rejects(
			userMover().moveMessage(
				CONFIG,
				messageId,
				world.notifications,
				world.account.accountId,
			),
			/queue unreachable/,
		);

		assert.deepEqual(await placementOf(messageId), backInInbox());
	});

	it("hands back a move to Trash whose batch entry the queue refused", async () => {
		const messageId = await seedMessage();
		sqsMock.on(SendMessageBatchCommand).resolves({
			Successful: [],
			Failed: [{ Id: "0", Code: "InvalidParameterValue", SenderFault: true }],
		});

		await assert.rejects(
			userMover().deleteMessages(CONFIG, [messageId], world.account.accountId),
			/refused 1 of 1/,
		);

		assert.deepEqual(await placementOf(messageId), backInInbox());
	});

	it("puts Trash back when the queue never took its Empty Trash", async () => {
		const messageId = await seedMessage(world.trash);
		sqsMock.on(SendMessageCommand).rejects(new Error("queue unreachable"));

		await assert.rejects(
			userMover().emptyTrash(CONFIG, world.account.accountId),
			/queue unreachable/,
		);

		assert.deepEqual(await placementOf(messageId), {
			...backInInbox(),
			mailboxId: world.trash,
			listedIn: world.trash,
		});
	});

	it("leaves a row already being deleted as it was when Empty Trash never left", async () => {
		const pending = await seedMessage(world.trash);
		await world.messages.transitionPlacement(
			pending,
			{ status: "active", mailboxId: world.trash, uid: SOURCE_UID },
			{ status: "deleting", syncStatus: "failed" },
		);
		const [listing] = await world.threadMessages.findAllByMessageId(
			CONFIG,
			pending,
		);
		if (!listing) throw new Error("no listing row");
		await world.threadMessages.update(
			CONFIG,
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
		sqsMock.on(SendMessageCommand).rejects(new Error("queue unreachable"));

		await assert.rejects(
			userMover().emptyTrash(CONFIG, world.account.accountId),
			/queue unreachable/,
		);

		assert.deepEqual(await placementOf(pending), {
			status: "deleting",
			syncStatus: "failed",
			mailboxId: world.trash,
			uid: SOURCE_UID,
			listedIn: world.trash,
			listedDeleted: true,
		});
	});

	it("finishes the local removal of a permanent delete whose batch send failed", async () => {
		const messageId = await seedMessage();
		sqsMock.on(SendMessageBatchCommand).rejects(new Error("queue unreachable"));

		await assert.rejects(
			userMover().deleteMessages(CONFIG, [messageId], world.account.accountId, {
				permanent: true,
			}),
			/queue unreachable/,
		);

		assert.deepEqual(await placementOf(messageId), gone);
		assert.deepEqual(await redriveLater(), [], "nothing is left deleting");
	});

	it("reports both the queue's error and a hand-back that failed", async () => {
		const messageId = await seedMessage();
		sqsMock.on(SendMessageCommand).rejects(new Error("queue unreachable"));
		const mover = userMover();
		const original = world.client.message.transitionPlacement.bind(
			world.client.message,
		);
		let calls = 0;
		world.client.message.transitionPlacement = async (...args) => {
			calls += 1;
			if (calls > 1) throw new Error("SQLITE_BUSY");
			return original(...args);
		};

		await assert.rejects(
			mover.moveMessage(
				CONFIG,
				messageId,
				world.notifications,
				world.account.accountId,
			),
			(error: unknown) => {
				assert.ok(error instanceof AggregateError);
				assert.deepEqual(
					error.errors.map((inner: Error) => inner.message),
					["queue unreachable", "SQLITE_BUSY"],
				);
				return true;
			},
		);
	});

	it("drops the copy row when the queue never took its copy", async () => {
		const sourceId = await seedMessage();
		sqsMock.on(SendMessageCommand).rejects(new Error("queue unreachable"));

		await assert.rejects(
			userMover().copyMessage(
				CONFIG,
				sourceId,
				world.notifications,
				world.account.accountId,
			),
			/queue unreachable/,
		);

		assert.deepEqual(
			(await world.messages.listAllByMailbox(world.notifications)).length,
			0,
		);
		assert.deepEqual(await placementOf(sourceId), backInInbox());
	});
});

describe("the reconcile re-drives a move or delete already stranded", () => {
	it("re-sends the push for a filing whose push was never queued", async () => {
		const messageId = await seedMessage();
		sqsMock.on(SendMessageCommand).rejects(new Error("queue unreachable"));
		await assert.rejects(
			placementMover().moveMessage(
				CONFIG,
				messageId,
				world.notifications,
				world.account.accountId,
			),
		);
		assert.equal((await world.markers.find(messageId))?.state, "pending");

		assert.deepEqual(await redriveLater(), [
			{
				type: "PLACEMENT_MOVE_PUSH",
				accountId: world.account.accountId,
				accountConfigId: CONFIG,
				messageId,
			},
		]);
	});

	it("hands back a foreign filing through the push it re-sends", async () => {
		const messageId = await seedMessage();
		await strandForeignFiling(messageId, "with-marker");

		const [push] = await redriveLater();
		assert.equal(push?.type, "PLACEMENT_MOVE_PUSH");
		await handlePlacementMovePush(
			stamped<PlacementMovePushEvent>(push),
			silentLogger,
			1,
		);

		assert.deepEqual(await placementOf(messageId), backInInbox());
		assert.equal(await world.markers.find(messageId), null);
	});

	it("re-sends a move for a foreign filing whose marker is gone, and the move hands it back", async () => {
		const messageId = await seedMessage();
		await strandForeignFiling(messageId, "marker-dropped");

		const emitted = await redriveLater();
		assert.deepEqual(emitted, [
			{
				type: "MESSAGE_MOVE",
				schemaVersion: 3,
				accountId: world.account.accountId,
				messageId,
				sourceMailboxId: world.inbox,
				destinationMailboxId: world.siblingTravel,
				uid: SOURCE_UID,
			},
		]);

		await handleMessageMove(
			stamped<MessageMoveEvent>(emitted[0]),
			silentLogger,
			1,
			unreachableServer(),
		);

		assert.deepEqual(await placementOf(messageId), backInInbox());
	});

	it("reconciles a filing away when its source folder is gone", async () => {
		const messageId = await seedMessage();
		await strandForeignFiling(messageId, "with-marker");
		await world.mailboxes.delete(world.account.accountId, world.inbox);

		await handlePlacementMovePush(
			stamped<PlacementMovePushEvent>({
				type: "PLACEMENT_MOVE_PUSH",
				accountId: world.account.accountId,
				accountConfigId: CONFIG,
				messageId,
			}),
			silentLogger,
			1,
		);

		assert.deepEqual(await placementOf(messageId), gone);
		assert.equal(await world.markers.find(messageId), null);
	});

	it("reconciles a move away when its source folder is gone", async () => {
		const messageId = await seedMessage();
		await userMover().moveMessage(
			CONFIG,
			messageId,
			world.notifications,
			world.account.accountId,
		);
		await world.mailboxes.delete(world.account.accountId, world.inbox);

		await handleMessageMove(
			stamped<MessageMoveEvent>({
				type: "MESSAGE_MOVE",
				schemaVersion: 3,
				accountId: world.account.accountId,
				messageId,
				sourceMailboxId: world.inbox,
				destinationMailboxId: world.notifications,
				uid: SOURCE_UID,
			}),
			silentLogger,
			1,
			unreachableServer(),
		);

		assert.deepEqual(await placementOf(messageId), gone);
	});

	it("re-sends the delete for a move to Trash whose event was lost", async () => {
		const messageId = await seedMessage();
		await userMover().deleteMessages(
			CONFIG,
			[messageId],
			world.account.accountId,
		);
		assert.equal((await placementOf(messageId)).mailboxId, world.trash);

		assert.deepEqual(await redriveLater(), [
			{
				type: "MESSAGE_DELETE",
				schemaVersion: 3,
				accountId: world.account.accountId,
				messageId,
				mailboxId: world.inbox,
				uid: SOURCE_UID,
				operation: "move_to_trash",
				destinationMailboxId: world.trash,
			},
		]);
	});

	it("re-sends the expunge for a permanent delete whose event was lost", async () => {
		const messageId = await seedMessage();
		await userMover().deleteMessages(
			CONFIG,
			[messageId],
			world.account.accountId,
			{ permanent: true },
		);

		assert.deepEqual(await redriveLater(), [
			{
				type: "MESSAGE_DELETE",
				schemaVersion: 3,
				accountId: world.account.accountId,
				messageId,
				mailboxId: world.inbox,
				uid: SOURCE_UID,
				operation: "permanent_delete",
			},
		]);
	});

	it("passes over a move while a folder it touches awaits a cursor rebuild", async () => {
		const messageId = await seedMessage();
		await userMover().moveMessage(
			CONFIG,
			messageId,
			world.notifications,
			world.account.accountId,
		);
		await world.mailboxes.update(world.account.accountId, world.inbox, {
			cursorState: MailboxCursorState.rebuilding,
		});

		assert.deepEqual(await redriveLater(), []);

		await world.mailboxes.update(world.account.accountId, world.inbox, {
			cursorState: MailboxCursorState.normal,
		});
		assert.deepEqual(
			(await redriveLater()).map((event) => event.type),
			["MESSAGE_MOVE"],
		);
	});

	it("leaves a move inside its budget, a just re-driven move, and a copy alone", async () => {
		const moved = await seedMessage();
		await userMover().moveMessage(
			CONFIG,
			moved,
			world.notifications,
			world.account.accountId,
		);
		const copied = await seedMessage();
		await userMover().copyMessage(
			CONFIG,
			copied,
			world.notifications,
			world.account.accountId,
		);

		assert.deepEqual(await redriveLater(0), [], "inside the budget");
		assert.deepEqual(
			(await redriveLater()).map((event) => event.type),
			["MESSAGE_MOVE"],
			"the copy carries no source pair to re-drive",
		);
		assert.deepEqual(
			await redriveLater(STRANDED_PLACEMENT_AFTER_MILLIS / 2),
			[],
			"a re-driven row waits out the budget again",
		);
		const row: MessageItem = await world.messages.get(moved);
		assert.equal(row.status, "moving");
	});
});
