/**
 * Issue #496: auto-mark-read and the placement move are enqueued from the same
 * body-sync pass onto two different queues, so the flag push can reach the
 * server first. It must not, because the row it would resolve against names the
 * destination mailbox while still carrying the source folder's uid — a STORE
 * there lands on the destination's OWN message at that uid.
 *
 * These tests drive the REAL `PlacementMoveService` and `FlagQueueService` to
 * produce the row and the marker, rather than hand-writing the shape the
 * handler guards on. A change that stops `PlacementMoveService` marking the row
 * `moving` reopens the defect while a hand-written fixture stays green.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { SQSClient } from "@aws-sdk/client-sqs";
import { getClient, type RemitClient, setClient } from "@remit/backend/client";
import type {
	IAddressRepository,
	IMessageFlagPushRepository,
	IMessageFlagRepository,
	IMessagePlacementMoveRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MessageFlagPushItem,
	MessageItem,
	MessagePlacementMoveItem,
	UpdateMessageMoveInput,
} from "@remit/data-ports";
import type { Logger } from "@remit/logger-lambda";
import {
	FlagPushService,
	FlagQueueService,
	PlacementMoveService,
} from "@remit/mailbox-service";
import type { FlagPushEvent } from "../events.js";
import { handleFlagPush } from "./flag-push.js";

const ACCOUNT_ID = "acc-496";
const ACCOUNT_CONFIG_ID = "cfg-496";
const MESSAGE_ID = "msg-496";
const INBOX_ID = "mbx-inbox";
const ARCHIVE_ID = "mbx-archive";
/** The newsletter's uid in INBOX — and, on a real server, some unrelated message's uid in Archive. */
const INBOX_UID = 42;
const SEEN = "\\Seen";

const silentLogger = (() => {
	const noop = () => {};
	const log = {
		info: noop,
		warn: noop,
		error: noop,
		debug: noop,
		fatal: noop,
		trace: noop,
		child: () => log,
	} as unknown as Logger;
	return log;
})();

interface Harness {
	row: MessageItem;
	flagMarkers: Map<string, MessageFlagPushItem>;
	placementMarkers: Map<string, MessagePlacementMoveItem>;
	placementMoveService: PlacementMoveService;
	flagQueueService: FlagQueueService;
}

const buildHarness = (): Harness => {
	const row = {
		messageId: MESSAGE_ID,
		accountConfigId: ACCOUNT_CONFIG_ID,
		mailboxId: INBOX_ID,
		uid: INBOX_UID,
		status: "active",
		syncStatus: "synced",
	} as unknown as MessageItem;

	const flagMarkers = new Map<string, MessageFlagPushItem>();
	const placementMarkers = new Map<string, MessagePlacementMoveItem>();
	const localFlags = new Set<string>();

	const messageService = {
		get: async (messageId: string) => {
			assert.equal(messageId, MESSAGE_ID);
			return row;
		},
		updateForMove: async (
			_messageId: string,
			input: UpdateMessageMoveInput,
		) => {
			Object.assign(row, input);
			return row;
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		getByMessageId: async () => ({
			accountConfigId: ACCOUNT_CONFIG_ID,
			threadMessageId: "tm-496",
			sentDate: 1,
			mailboxId: row.mailboxId,
			isRead: false,
			isDeleted: false,
			hasStars: false,
			hasAttachment: false,
		}),
		findAllByMessageId: async () => [],
		update: async () => {},
	} as unknown as IThreadMessageRepository;

	const placementMarkerService = {
		put: async (input: { messageId: string }) => {
			const marker = {
				...input,
				state: "pending",
				createdAt: Date.now(),
			} as unknown as MessagePlacementMoveItem;
			placementMarkers.set(input.messageId, marker);
			return marker;
		},
		find: async (messageId: string) => placementMarkers.get(messageId) ?? null,
		updateState: async (
			messageId: string,
			state: MessagePlacementMoveItem["state"],
		) => {
			const marker = placementMarkers.get(messageId);
			if (!marker) throw new Error(`no placement marker for ${messageId}`);
			marker.state = state;
			return marker;
		},
		delete: async (messageId: string) => {
			placementMarkers.delete(messageId);
		},
	} as unknown as IMessagePlacementMoveRepository;

	const flagMarkerService = {
		put: async (input: { messageId: string; flagName: string }) => {
			const marker = {
				...input,
				state: "pending",
				createdAt: Date.now(),
			} as unknown as MessageFlagPushItem;
			flagMarkers.set(`${input.messageId}:${input.flagName}`, marker);
			return marker;
		},
		find: async (messageId: string, flagName: string) =>
			flagMarkers.get(`${messageId}:${flagName}`) ?? null,
		updateState: async (
			messageId: string,
			flagName: string,
			state: MessageFlagPushItem["state"],
		) => {
			const marker = flagMarkers.get(`${messageId}:${flagName}`);
			if (!marker) throw new Error(`no flag marker for ${messageId}`);
			marker.state = state;
			return marker;
		},
		delete: async (messageId: string, flagName: string) => {
			flagMarkers.delete(`${messageId}:${flagName}`);
		},
	} as unknown as IMessageFlagPushRepository;

	const messageFlagService = {
		hasFlag: async (_messageId: string, flagName: string) =>
			localFlags.has(flagName),
		addFlag: async (_messageId: string, flagName: string) => {
			localFlags.add(flagName);
			return {} as never;
		},
		removeFlag: async (_messageId: string, flagName: string) => {
			localFlags.delete(flagName);
		},
	} as unknown as IMessageFlagRepository;

	const placementMoveService = new PlacementMoveService({
		messageService,
		threadMessageService,
		markerService: placementMarkerService,
		addressService: {
			reconcileJunkOnlyForMessage: async () => {},
		} as unknown as IAddressRepository,
		sqsQueueUrl: "https://sqs.eu-west-1.amazonaws.com/000/message-mgmt",
	});

	const flagQueueService = new FlagQueueService({
		messageFlagService,
		messageService,
		threadMessageService,
		flagPushService: new FlagPushService({
			markerService: flagMarkerService,
			sqsQueueUrl: "https://sqs.eu-west-1.amazonaws.com/000/messages",
		}),
	});

	return {
		row,
		flagMarkers,
		placementMarkers,
		placementMoveService,
		flagQueueService,
	};
};

const event: FlagPushEvent = {
	type: "FLAG_PUSH",
	accountId: ACCOUNT_ID,
	accountConfigId: ACCOUNT_CONFIG_ID,
	messageId: MESSAGE_ID,
	flagName: SEEN,
} as FlagPushEvent;

describe("auto-mark-read racing the placement move (#496)", () => {
	let harness: Harness;

	beforeEach(async () => {
		mock.method(SQSClient.prototype, "send", async () => ({}));
		harness = buildHarness();

		setClient({
			account: { get: async () => undefined },
			message: { get: async () => undefined },
			mailbox: { get: async () => undefined },
			flagPush: {
				find: async () => undefined,
				updateState: async () => undefined,
				delete: async () => undefined,
			},
		} as unknown as RemitClient);
	});

	afterEach(() => mock.restoreAll());

	it("leaves the row naming the destination while it still carries the source uid", async () => {
		await harness.placementMoveService.moveMessage(
			ACCOUNT_CONFIG_ID,
			MESSAGE_ID,
			ARCHIVE_ID,
			ACCOUNT_ID,
		);

		assert.equal(harness.row.mailboxId, ARCHIVE_ID);
		assert.equal(
			harness.row.uid,
			INBOX_UID,
			"the uid still belongs to INBOX — this pair is what any dependent push would resolve",
		);
		assert.equal(harness.row.status, "moving");
	});

	it("never pushes the flag while the move that row is waiting on has not settled", async () => {
		await harness.placementMoveService.moveMessage(
			ACCOUNT_CONFIG_ID,
			MESSAGE_ID,
			ARCHIVE_ID,
			ACCOUNT_ID,
		);
		await harness.flagQueueService.markAsRead(
			ACCOUNT_CONFIG_ID,
			MESSAGE_ID,
			ACCOUNT_ID,
		);

		const marker = harness.flagMarkers.get(`${MESSAGE_ID}:${SEEN}`);
		assert.ok(marker, "the auto-read wrote a pending flag-push marker");
		assert.equal(
			(marker as unknown as { mailboxId: string }).mailboxId,
			ARCHIVE_ID,
			"the marker names the destination the unsettled move wrote",
		);

		const client = await getClient();
		mock.method(client.account, "get", async () => ({
			accountId: ACCOUNT_ID,
			accountConfigId: ACCOUNT_CONFIG_ID,
		}));
		mock.method(client.message, "get", async () => [harness.row]);
		const mailboxGet = mock.method(client.mailbox, "get", async () => ({
			mailboxId: ARCHIVE_ID,
			fullPath: "Archive",
		}));
		mock.method(client.flagPush, "find", async () => marker);
		const updateState = mock.method(
			client.flagPush,
			"updateState",
			async () => {},
		);
		const deleteMarker = mock.method(client.flagPush, "delete", async () => {});

		// Captured rather than awaited bare: unguarded, the handler walks on to
		// borrow a connection and fails there, which would mask the assertion
		// below that says why it should never have got that far.
		const fault = await handleFlagPush(event, silentLogger, 1).then(
			() => undefined,
			(error: unknown) => error,
		);

		assert.equal(
			mailboxGet.mock.calls.length,
			0,
			"returns before resolving Archive — nothing reaches the server against uid 42",
		);
		assert.equal(fault, undefined, "the deferral acks, it does not fault");
		assert.equal(
			deleteMarker.mock.calls.length,
			0,
			"the read intent survives the deferral",
		);
		assert.deepEqual(updateState.mock.calls[0]?.arguments, [
			MESSAGE_ID,
			SEEN,
			"pending",
		]);
	});

	it("pushes once the move has settled and the row's uid matches its mailbox", async () => {
		await harness.placementMoveService.moveMessage(
			ACCOUNT_CONFIG_ID,
			MESSAGE_ID,
			ARCHIVE_ID,
			ACCOUNT_ID,
		);
		await harness.flagQueueService.markAsRead(
			ACCOUNT_CONFIG_ID,
			MESSAGE_ID,
			ACCOUNT_ID,
		);

		// What `updateUid` writes when the IMAP move confirms: the destination's
		// own COPYUID, and the status back to active.
		Object.assign(harness.row, {
			uid: 907,
			mailboxId: ARCHIVE_ID,
			status: "active",
			syncStatus: "synced",
		});

		const client = await getClient();
		mock.method(client.account, "get", async () => ({
			accountId: ACCOUNT_ID,
			accountConfigId: ACCOUNT_CONFIG_ID,
		}));
		mock.method(client.message, "get", async () => [harness.row]);
		const mailboxGet = mock.method(client.mailbox, "get", async () => {
			throw Object.assign(new Error("stop before connecting"), {
				name: "NotFoundError",
			});
		});
		mock.method(client.flagPush, "find", async () =>
			harness.flagMarkers.get(`${MESSAGE_ID}:${SEEN}`),
		);
		mock.method(client.flagPush, "updateState", async () => {});
		mock.method(client.flagPush, "delete", async () => {});

		await handleFlagPush(event, silentLogger, 1);

		assert.equal(
			mailboxGet.mock.calls.length,
			1,
			"the deferral is not permanent — a settled row resolves its mailbox and proceeds",
		);
	});
});
