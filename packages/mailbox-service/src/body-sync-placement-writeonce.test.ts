/**
 * RFC 039 Non-goals / issues #383, #1011: placement is meant to run once per
 * message. The two re-entrant paths — `fetchAndGetBody`'s `NoSuchKey` fallback
 * and `syncBodies(..., force: true)` — are now marked as re-stores by
 * `applyPostStoreSteps(isReStore: true)`, which skips the entire decision pass
 * (placement, filters, classification) and writes only `bodyStorageKey`. This
 * replaces the old per-field guards (`hasDecidedPlacement`,
 * `hasDecidedCategory`, `hasClassifiedBody`) that each individual derivation
 * carried.
 *
 * The last test below previously asserted that a legacy row (movedByRemit: true,
 * no placementDecidedAt) gets backfilled with placementDecidedAt on re-enter —
 * that behavior is gone by design: re-stores never re-decide placement, so a
 * pre-#1011 row that never got placementDecidedAt simply keeps not having it
 * (and never gets moved by Remit either).
 */

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import type {
	AddressItem,
	IAddressRepository,
	IEnvelopeRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
	UpdateMessageInput,
} from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";
import type { PlacementConfig } from "./body-sync.js";
import { BodySyncService } from "./body-sync.js";
import type { PlacementMoveService } from "./placement-move.js";
import type { IImapConnection } from "./types.js";

const MAILBOXES = {
	inbox: { mailboxId: "mb-inbox", fullPath: "INBOX" },
	junk: { mailboxId: "mb-junk", fullPath: "Junk" },
};

/**
 * DKIM signing domain mismatches the From domain, dmarc=fail, sender
 * untrusted, a provider-spam header present (any value) — exactly the
 * deterministic signal set `classifyPlacement`'s demote branch (inbox → junk,
 * HIGH bar) confidently acts on when the message currently sits in Inbox.
 */
const DEMOTE_EML = Buffer.from(
	[
		"From: Support <support@evil-mimic.example>",
		"To: me@example.com",
		"Subject: Verify your account",
		"Authentication-Results: mx.example.com; dmarc=fail",
		"DKIM-Signature: v=1; a=rsa-sha256; d=relay.example.net; s=sel; b=xxx",
		"X-Spam-Status: No, score=0.1",
		"Content-Type: text/plain",
		"",
		"body",
	].join("\r\n"),
);

interface Harness {
	service: BodySyncService;
	message: MessageItem;
	messageUpdates: Array<{ messageId: string; input: UpdateMessageInput }>;
	moves: Array<{ messageId: string; destinationMailboxId: string }>;
}

const buildHarness = (
	message: Partial<MessageItem> & Pick<MessageItem, "messageId">,
	retrieve: () => Promise<Buffer>,
): Harness => {
	const messageUpdates: Array<{
		messageId: string;
		input: UpdateMessageInput;
	}> = [];
	const moves: Array<{ messageId: string; destinationMailboxId: string }> = [];

	const messageRow = {
		uid: 1,
		mailboxId: MAILBOXES.inbox.mailboxId,
		...message,
	} as unknown as MessageItem;

	const messageService = {
		get: async () => messageRow,
		update: async (messageId: string, input: UpdateMessageInput) => {
			messageUpdates.push({ messageId, input });
			Object.assign(messageRow, input);
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => [
			{
				threadMessageId: "tm-1",
				messageId: message.messageId,
				mailboxId: messageRow.mailboxId,
				sentDate: 1,
				isRead: false,
				isDeleted: false,
				hasStars: false,
				hasAttachment: false,
			},
		],
		update: async () => {},
	} as unknown as IThreadMessageRepository;

	const storageService = {
		retrieve,
		storeMessageBody: async () => ({ uri: `s3://bodies/${message.messageId}` }),
		storeMessageBodyStream: async () => ({
			uri: `s3://bodies/${message.messageId}`,
		}),
		storeParsedBody: async () => {},
		listBodyParts: async () => [],
	} as unknown as StorageService;

	const addressService = {
		getAddress: async () => ({ flags: {} }) as unknown as AddressItem,
		incrementInboundCount: async () => {},
	} as unknown as IAddressRepository;

	const envelopeService = {
		listBodyParts: async () => [],
	} as unknown as IEnvelopeRepository;

	const mailboxSpecialUseService = {
		findJunkMailbox: async () => MAILBOXES.junk,
		findArchiveMailbox: async () => null,
		findInboxMailbox: async () => MAILBOXES.inbox,
	} as unknown as IMailboxSpecialUseRepository;

	const placementMoveService = {
		moveMessage: async (
			_accountConfigId: string,
			messageId: string,
			destinationMailboxId: string,
		) => {
			moves.push({ messageId, destinationMailboxId });
			messageRow.mailboxId = destinationMailboxId;
		},
	} as unknown as PlacementMoveService;

	const placementConfig: PlacementConfig = {
		mailboxSpecialUseService,
		placementMoveService,
	};

	const service = new BodySyncService(
		messageService,
		storageService,
		threadMessageService,
		addressService,
		envelopeService,
		{ info: () => {}, error: () => {} },
		placementConfig,
	);

	return { service, message: messageRow, messageUpdates, moves };
};

const noSuchKeyError = () =>
	Object.assign(new Error("missing"), { name: "NoSuchKey" });

describe("placement survives a re-entrant computePlacement pass (issue #383)", () => {
	it("keeps a user-rescued message in Inbox through the NoSuchKey IMAP re-fetch", async () => {
		const harness = buildHarness(
			{
				messageId: "m-1",
				mailboxId: MAILBOXES.inbox.mailboxId,
				bodyStorageKey: "s3://bodies/m-1",
				movedByRemit: false,
				placementDecidedAt: 500,
			},
			async () => {
				throw noSuchKeyError();
			},
		);

		const connection = {
			openBox: async () => {},
			fetchMessageBody: async () => DEMOTE_EML,
		} as unknown as IImapConnection;

		await harness.service.fetchAndGetBody(
			"m-1",
			"acc-1",
			"cfg-1",
			"INBOX",
			async () => connection,
		);

		assert.deepEqual(
			harness.moves,
			[],
			"an already-decided placement must not be re-evaluated, even though these headers would confidently demote if classifyPlacement ran fresh",
		);
		assert.equal(harness.message.mailboxId, MAILBOXES.inbox.mailboxId);
		assert.equal(harness.messageUpdates[0]?.input.movedByRemit, undefined);
		assert.equal(harness.messageUpdates[0]?.input.placementVerdict, undefined);
		// The re-store wrote only bodyStorageKey — no placement fields.
		assert.equal(harness.messageUpdates[0]?.input.placementDecidedAt, undefined);
	});

	it("keeps a user-rescued message in Inbox when syncBodies re-fetches with force", async () => {
		const harness = buildHarness(
			{
				messageId: "m-1",
				mailboxId: MAILBOXES.inbox.mailboxId,
				bodyStorageKey: "s3://bodies/m-1",
				movedByRemit: false,
				placementDecidedAt: 500,
			},
			async () => {
				throw new Error("force path must not retrieve from storage");
			},
		);

		const connection = {
			openBox: async () => {},
			async *fetchMessageBodies(uids: number[]) {
				for (const uid of uids) {
					yield { uid, source: Readable.from([DEMOTE_EML]) };
				}
			},
		} as unknown as IImapConnection;

		const result = await harness.service.syncBodies(
			["m-1"],
			"acc-1",
			"cfg-1",
			"INBOX",
			async () => connection,
			true,
		);

		assert.deepEqual(result.syncedMessageIds, ["m-1"]);
		assert.deepEqual(
			harness.moves,
			[],
			"a forced re-sync must not re-decide an already-decided placement",
		);
		assert.equal(harness.message.mailboxId, MAILBOXES.inbox.mailboxId);
	});

	it("still evaluates and can confidently move a message that has never been placement-classified", async () => {
		const harness = buildHarness(
			{
				messageId: "m-1",
				mailboxId: MAILBOXES.inbox.mailboxId,
				movedByRemit: false,
			},
			async () => {
				throw new Error("no body stored yet; must not retrieve");
			},
		);

		const connection = {
			openBox: async () => {},
			fetchMessageBody: async () => DEMOTE_EML,
		} as unknown as IImapConnection;

		await harness.service.fetchAndGetBody(
			"m-1",
			"acc-1",
			"cfg-1",
			"INBOX",
			async () => connection,
		);

		assert.deepEqual(harness.moves, [
			{ messageId: "m-1", destinationMailboxId: MAILBOXES.junk.mailboxId },
		]);
		assert.equal(harness.messageUpdates[0]?.input.movedByRemit, true);
		assert.ok(
			typeof harness.messageUpdates[0]?.input.placementDecidedAt === "number",
			"a genuine first evaluation must record placementDecidedAt",
		);
	});

	it("a legacy row with movedByRemit: true and no placementDecidedAt is not re-decided on re-store", async () => {
		const harness = buildHarness(
			{
				messageId: "m-1",
				mailboxId: MAILBOXES.inbox.mailboxId,
				bodyStorageKey: "s3://bodies/m-1",
				movedByRemit: true,
				// No placementDecidedAt and no category — a legacy row synced before
				// the write-once guards existed. Under #1011 a re-store skips the
				// decision pass entirely, so placement is never re-evaluated and the
				// row's missing fields are never backfilled — the re-store writes only
				// bodyStorageKey.
			},
			async () => {
				throw noSuchKeyError();
			},
		);

		const connection = {
			openBox: async () => {},
			fetchMessageBody: async () => DEMOTE_EML,
		} as unknown as IImapConnection;

		await harness.service.fetchAndGetBody(
			"m-1",
			"acc-1",
			"cfg-1",
			"INBOX",
			async () => connection,
		);

		assert.deepEqual(
			harness.moves,
			[],
			"movedByRemit must keep protecting a legacy row with no placementDecidedAt of its own",
		);
		// The re-store wrote only bodyStorageKey — no placement fields were
		// re-decided or backfilled.
		assert.equal(harness.message.mailboxId, MAILBOXES.inbox.mailboxId);
		assert.equal(harness.messageUpdates[0]?.input.placementDecidedAt, undefined);
		assert.equal(harness.messageUpdates[0]?.input.movedByRemit, undefined);
		assert.equal(harness.messageUpdates[0]?.input.placementVerdict, undefined);
		// The only field written is bodyStorageKey.
		assert.equal(
			Object.keys(harness.messageUpdates[0]?.input ?? {}).length,
			1,
			"re-store must write only bodyStorageKey",
		);
	});
});
