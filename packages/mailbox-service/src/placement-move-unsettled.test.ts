/**
 * Issue #496's rule applied to the placement move's own re-entry: a second
 * verdict, for a different destination, arriving while the first move is still
 * unconfirmed. The row then names the first destination but still carries the
 * uid of the folder before it, so binding a fresh marker to that pair sends the
 * reconciler to move the destination folder's OWN message at that uid.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { SQSClient } from "@aws-sdk/client-sqs";
import type {
	IMessagePlacementMoveRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
	MessagePlacementMoveItem,
	PutMessagePlacementMoveInput,
	UpdateMessageMoveInput,
} from "@remit/data-ports";
import { PlacementMoveService } from "./placement-move.js";

const ACCOUNT_ID = "acc-pm";
const ACCOUNT_CONFIG_ID = "cfg-pm";
const MESSAGE_ID = "msg-pm";
const INBOX_ID = "mbx-inbox";
const ARCHIVE_ID = "mbx-archive";
const JUNK_ID = "mbx-junk";
const INBOX_UID = 42;

interface Harness {
	service: PlacementMoveService;
	row: MessageItem;
	puts: PutMessagePlacementMoveInput[];
	marker: MessagePlacementMoveItem | null;
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

	const puts: PutMessagePlacementMoveInput[] = [];
	const harness = { row, puts, marker: null } as Harness;

	const messageService = {
		get: async () => row,
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
			threadMessageId: "tm-pm",
			sentDate: 1,
			mailboxId: row.mailboxId,
			isRead: false,
			isDeleted: false,
			hasStars: false,
			hasAttachment: false,
		}),
		update: async () => {},
	} as unknown as IThreadMessageRepository;

	const markerService = {
		put: async (input: PutMessagePlacementMoveInput) => {
			puts.push(input);
			harness.marker = {
				...input,
				state: "pending",
				createdAt: Date.now(),
			} as unknown as MessagePlacementMoveItem;
			return harness.marker;
		},
		find: async () => harness.marker,
		updateState: async (
			_messageId: string,
			state: MessagePlacementMoveItem["state"],
		) => {
			if (!harness.marker) throw new Error("no marker");
			harness.marker.state = state;
			return harness.marker;
		},
		delete: async () => {
			harness.marker = null;
		},
	} as unknown as IMessagePlacementMoveRepository;

	harness.service = new PlacementMoveService({
		messageService,
		threadMessageService,
		markerService,
		sqsQueueUrl: "https://sqs.eu-west-1.amazonaws.com/000/message-mgmt",
		moveSettleTimeoutMs: 200,
		moveSettlePollMs: 10,
	});

	return harness;
};

describe("PlacementMoveService — a second destination while the first move is unsettled (#496)", () => {
	let harness: Harness;

	beforeEach(() => {
		mock.method(SQSClient.prototype, "send", async () => ({}));
		harness = buildHarness();
	});

	afterEach(() => mock.restoreAll());

	it("binds to the settled row once the earlier move confirms", async () => {
		await harness.service.moveMessage(
			ACCOUNT_CONFIG_ID,
			MESSAGE_ID,
			ARCHIVE_ID,
			ACCOUNT_ID,
		);
		assert.equal(harness.row.status, "moving");
		assert.equal(harness.row.uid, INBOX_UID);

		// What the reconciler writes when the IMAP move lands: Archive's own
		// COPYUID, and the status back to active.
		setTimeout(() => {
			Object.assign(harness.row, { uid: 907, status: "active" });
			harness.marker = null;
		}, 30);

		await harness.service.moveMessage(
			ACCOUNT_CONFIG_ID,
			MESSAGE_ID,
			JUNK_ID,
			ACCOUNT_ID,
		);

		assert.equal(harness.puts.length, 2);
		assert.equal(
			harness.puts[1]?.sourceMailboxId,
			ARCHIVE_ID,
			"the source is where the confirmed move left the message",
		);
		assert.equal(harness.row.originalUid, 907, "and its confirmed uid");
	});

	it("does not apply the move when the earlier one never settles", async () => {
		await harness.service.moveMessage(
			ACCOUNT_CONFIG_ID,
			MESSAGE_ID,
			ARCHIVE_ID,
			ACCOUNT_ID,
		);

		await assert.rejects(
			() =>
				harness.service.moveMessage(
					ACCOUNT_CONFIG_ID,
					MESSAGE_ID,
					JUNK_ID,
					ACCOUNT_ID,
				),
			/has not settled/,
		);

		assert.equal(harness.puts.length, 1, "no second marker was written");
		assert.equal(
			harness.puts[0]?.sourceMailboxId,
			INBOX_ID,
			"the surviving marker still names the folder the message is actually in",
		);
		assert.equal(harness.marker?.destinationMailboxId, ARCHIVE_ID);
	});

	it("drives a surviving pending marker for the same destination forward", async () => {
		await harness.service.moveMessage(
			ACCOUNT_CONFIG_ID,
			MESSAGE_ID,
			ARCHIVE_ID,
			ACCOUNT_ID,
		);
		// The enqueue failed on the earlier call, so the marker never advanced.
		if (harness.marker) harness.marker.state = "pending";

		await harness.service.moveMessage(
			ACCOUNT_CONFIG_ID,
			MESSAGE_ID,
			ARCHIVE_ID,
			ACCOUNT_ID,
		);

		assert.equal(harness.puts.length, 1, "the local move is never re-derived");
		assert.equal(harness.marker?.state, "queued");
	});

	it("moves a settled row normally", async () => {
		await harness.service.moveMessage(
			ACCOUNT_CONFIG_ID,
			MESSAGE_ID,
			ARCHIVE_ID,
			ACCOUNT_ID,
		);
		Object.assign(harness.row, { uid: 907, status: "active" });
		harness.marker = null;

		await harness.service.moveMessage(
			ACCOUNT_CONFIG_ID,
			MESSAGE_ID,
			JUNK_ID,
			ACCOUNT_ID,
		);

		assert.equal(harness.puts.length, 2);
		assert.equal(harness.puts[1]?.sourceMailboxId, ARCHIVE_ID);
		assert.equal(harness.puts[1]?.destinationMailboxId, JUNK_ID);
	});
});
