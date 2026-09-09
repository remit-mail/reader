/**
 * Issue #1011: a forced body re-sync must not re-fire standing rules on an
 * already-seen message.
 *
 * The two re-entrant paths — `fetchAndGetBody`'s `NoSuchKey` IMAP fallback, and
 * `syncBodies(..., force: true)` (the read-miss re-arm cue) — both re-fetch a
 * body whose row already carries `bodyStorageKey`. That is a body-only fetch:
 * the decision pass (placement, filters, classification) already ran when the
 * body first landed. Re-running it now would move mail the user has since filed
 * by hand, re-fire the engagement counter, re-apply labels, and rewrite the
 * write-once category.
 *
 * Each test below presets a message whose body was already stored and whose
 * headers WOULD trigger a confident placement demote or a standing filter move
 * if the decision pass ran fresh. A regression that drops the `isReStore` skip
 * shows up as an unwanted move, not as a passing test relying on the heuristics
 * happening to agree.
 */

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it, mock } from "node:test";
import type {
	AddressItem,
	FilterItem,
	IAddressRepository,
	IEnvelopeRepository,
	IFilterAnchorRepository,
	IFilterRepository,
	IMessageLabelRepository,
	IMessageRepository,
	IMailboxSpecialUseRepository,
	IThreadMessageRepository,
	MessageItem,
	UpdateMessageInput,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import {
	FilterClauseField,
	FilterMatchOperator,
	FilterState,
	MessageCategory,
} from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import { BodySyncService } from "./body-sync.js";
import { NO_ACTION } from "./filters/match.js";
import type { FilterConfig } from "./filters/pipeline.js";
import type { PlacementConfig } from "./body-sync.js";
import type { PlacementMoveService } from "./placement-move.js";
import type { IImapConnection } from "./types.js";

const MAILBOXES = {
	inbox: { mailboxId: "mb-inbox", fullPath: "INBOX" },
	junk: { mailboxId: "mb-junk", fullPath: "Junk" },
	travel: { mailboxId: "mb-travel", fullPath: "Travel" },
};

/**
 * Demote headers: DKIM domain mismatches From, dmarc=fail, untrusted sender.
 * `classifyPlacement`'s demote branch (inbox → junk, HIGH bar) confidently acts
 * on this set when the message currently sits in Inbox.
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

/**
 * A standing literal filter that matches subjects containing "invitation" and
 * moves them to `destinationMailboxId`. Used to assert that a re-store does not
 * re-fire the filter on an already-seen message.
 */
const buildInvitationFilter = (destinationMailboxId: string): FilterItem =>
	({
		filterId: "flt-invite",
		accountConfigId: "cfg-1",
		name: "Invitations",
		scope: "Standing",
		state: FilterState.Active,
		hasAnchor: false,
		ruleChangedAt: 1,
		matchOperator: FilterMatchOperator.And,
		literalClauses: [
			{ field: FilterClauseField.Subject, value: "invitation" },
		],
		actionLabelId: NO_ACTION,
		actionMailboxId: destinationMailboxId,
		createdAt: 1,
		updatedAt: 1,
	}) as unknown as FilterItem;

const INVITATION_EML = Buffer.from(
	[
		"From: Someone <someone@example.com>",
		"To: me@example.com",
		"Subject: You have a new invitation to Travel",
		"Content-Type: text/plain",
		"",
		"details",
	].join("\r\n"),
);

interface Harness {
	service: BodySyncService;
	message: MessageItem;
	messageUpdates: Array<{ messageId: string; input: UpdateMessageInput }>;
	moves: Array<{ messageId: string; destinationMailboxId: string }>;
}

const noSuchKeyError = () =>
	Object.assign(new Error("missing"), { name: "NoSuchKey" });

/**
 * Build a BodySyncService harness with both placement and filter configs wired,
 * so we can assert that neither fires during a re-store.
 */
const buildHarness = (
	message: Partial<MessageItem> & Pick<MessageItem, "messageId">,
	retrieve: () => Promise<Buffer>,
	filter: FilterItem | null,
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
		get: async (messageId: string) =>
			messageId === message.messageId ? messageRow : undefined,
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
		getAddress: async () => {
			throw new NotFoundError("Address not found");
		},
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

	const filterConfig: FilterConfig | undefined = filter
		? {
				filterService: {
					listByAccountAndState: async () => [filter],
					refreshExpiry: async (f: FilterItem) => f,
				} as unknown as IFilterRepository,
				filterAnchorService: {
					get: async () => undefined,
				} as unknown as IFilterAnchorRepository,
				messageLabelService: {
					apply: async () => {},
				} as unknown as IMessageLabelRepository,
				placementMoveService,
			}
		: undefined;

	const service = new BodySyncService(
		messageService,
		storageService,
		threadMessageService,
		addressService,
		envelopeService,
		{ info: () => {}, error: () => {}, debug: () => {}, warn: () => {} },
		placementConfig,
		filterConfig,
	);

	return { service, message: messageRow, messageUpdates, moves };
};

const noSuchKeyConn = (body: Buffer): IImapConnection =>
	({
		openBox: async () => {},
		fetchMessageBody: async () => body,
	}) as unknown as IImapConnection;

const streamBody = (body: Buffer): Readable =>
	Readable.from([body]) as unknown as Readable;

describe("issue #1011: forced re-store does not re-fire standing rules", () => {
	it("syncBodies(force: true) does not re-evaluate placement on a stored message", async () => {
		const harness = buildHarness(
			{
				messageId: "m-1",
				mailboxId: MAILBOXES.inbox.mailboxId,
				bodyStorageKey: "s3://bodies/m-1",
				// Already classified and placed — category and placementDecidedAt
				// set by a prior, genuine first-store pass.
				category: MessageCategory.personal,
				placementDecidedAt: 500,
			},
			async () => {
				throw new Error("force path must not retrieve from storage");
			},
			null, // no filter config
		);

		const connection = {
			openBox: async () => {},
			async *fetchMessageBodies(uids: number[]) {
				for (const uid of uids) {
					yield { uid, source: streamBody(DEMOTE_EML) };
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

		assert.deepEqual(result.syncedMessageIds, ["m-1"], "message is synced");

		// No placement move — a hand-rescued message stays where the user put it.
		assert.deepEqual(
			harness.moves,
			[],
			"a forced re-store must not re-decide placement, even though headers would demote",
		);
		assert.equal(harness.message.mailboxId, MAILBOXES.inbox.mailboxId);

		// The update writes only bodyStorageKey — no placement or category churn.
		const update = harness.messageUpdates[0];
		assert.equal(update?.input.movedByRemit, undefined);
		assert.equal(update?.input.placementVerdict, undefined);
		assert.equal(update?.input.placementDecidedAt, undefined);
		assert.equal(update?.input.category, undefined);
		assert.deepEqual(
			Object.keys(update?.input ?? {}).sort(),
			["bodyStorageKey"],
			"re-store must write only bodyStorageKey",
		);
	});

	it("syncBodies(force: true) does not re-fire a standing filter on a stored message", async () => {
		const harness = buildHarness(
			{
				messageId: "m-1",
				mailboxId: MAILBOXES.travel.mailboxId,
				bodyStorageKey: "s3://bodies/m-1",
				category: MessageCategory.personal,
			},
			async () => {
				throw new Error("force path must not retrieve from storage");
			},
			buildInvitationFilter(MAILBOXES.junk.mailboxId),
		);

		const connection = {
			openBox: async () => {},
			async *fetchMessageBodies(uids: number[]) {
				for (const uid of uids) {
					yield { uid, source: streamBody(INVITATION_EML) };
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

		// No filter move — the message already sits in its filter destination
		// (Travel) and a re-store must not re-fire the filter.
		assert.deepEqual(
			harness.moves,
			[],
			"a forced re-store must not re-fire standing filters",
		);
		// The update writes only bodyStorageKey — no filterMove marker.
		const update = harness.messageUpdates[0];
		assert.equal(update?.input.filterMove, undefined);
		assert.equal(update?.input.movedByRemit, undefined);
		assert.deepEqual(
			Object.keys(update?.input ?? {}).sort(),
			["bodyStorageKey"],
			"re-store must write only bodyStorageKey",
		);
	});

	it("fetchAndGetBody NoSuchKey fallback does not re-fire placement or filters", async () => {
		const harness = buildHarness(
			{
				messageId: "m-1",
				mailboxId: MAILBOXES.inbox.mailboxId,
				bodyStorageKey: "s3://bodies/m-1",
				category: MessageCategory.personal,
				placementDecidedAt: 500,
			},
			async () => {
				throw noSuchKeyError();
			},
			buildInvitationFilter(MAILBOXES.junk.mailboxId),
		);

		await harness.service.fetchAndGetBody(
			"m-1",
			"acc-1",
			"cfg-1",
			"INBOX",
			async () => noSuchKeyConn(DEMOTE_EML),
		);

		assert.deepEqual(
			harness.moves,
			[],
			"the NoSuchKey fallback must not re-decide placement or re-fire filters",
		);
		assert.equal(harness.message.mailboxId, MAILBOXES.inbox.mailboxId);

		const update = harness.messageUpdates[0];
		assert.equal(update?.input.movedByRemit, undefined);
		assert.equal(update?.input.placementVerdict, undefined);
		assert.equal(update?.input.filterMove, undefined);
		assert.deepEqual(
			Object.keys(update?.input ?? {}).sort(),
			["bodyStorageKey"],
			"re-store must write only bodyStorageKey",
		);
	});

	it("a first-store via fetchAndGetBody (no bodyStorageKey) still runs placement and filters", async () => {
		// Regression guard: the re-store skip must not disable decisions on a
		// genuine first store that happens to arrive via the read path.
		const harness = buildHarness(
			{
				messageId: "m-1",
				mailboxId: MAILBOXES.inbox.mailboxId,
				// No bodyStorageKey — a genuine first store.
			},
			async () => {
				throw new Error("must not retrieve from storage on a first store");
			},
			buildInvitationFilter(MAILBOXES.travel.mailboxId),
		);

		await harness.service.fetchAndGetBody(
			"m-1",
			"acc-1",
			"cfg-1",
			"INBOX",
			async () => noSuchKeyConn(INVITATION_EML),
		);

		// The filter fires — it is a first store, not a re-store.
		assert.deepEqual(
			harness.moves,
			[{ messageId: "m-1", destinationMailboxId: MAILBOXES.travel.mailboxId }],
			"a genuine first store must run the standing filter",
		);
		const update = harness.messageUpdates[0];
		assert.equal(update?.input.filterMove?.filterId, "flt-invite");
		assert.equal(update?.input.movedByRemit, true);
	});

	it("a forced batch re-stores a stored message (bytes only) but first-stores a never-stored one", async () => {
		// A forced batch may contain both never-stored messages (first store —
		// full decisions) and already-stored ones (re-store — bytes only).
		const storedMessage = {
			messageId: "m-stored",
			mailboxId: MAILBOXES.inbox.mailboxId,
			uid: 1,
			bodyStorageKey: "s3://bodies/m-stored",
			category: MessageCategory.personal,
		} as unknown as MessageItem;
		const newMessage = {
			messageId: "m-new",
			mailboxId: MAILBOXES.inbox.mailboxId,
			uid: 2,
		} as unknown as MessageItem;

		const messageUpdates: Array<{
			messageId: string;
			input: UpdateMessageInput;
		}> = [];
		const moves: Array<{ messageId: string; destinationMailboxId: string }> = [];

		const messageService = {
			get: async (messageId: string) =>
				messageId === "m-stored"
					? storedMessage
					: messageId === "m-new"
						? newMessage
						: undefined,
			update: async (id: string, input: UpdateMessageInput) => {
				messageUpdates.push({ messageId: id, input });
				const row = id === "m-stored" ? storedMessage : newMessage;
				Object.assign(row, input);
			},
		} as unknown as IMessageRepository;

		const threadMessageService = {
			findAllByMessageId: async (
				_accountConfigId: string,
				messageId: string,
			) => [
				{
					threadMessageId: "tm-" + messageId,
					messageId,
					mailboxId:
						messageId === "m-stored"
							? storedMessage.mailboxId
							: newMessage.mailboxId,
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
			retrieve: async () => {
				throw new Error("must not retrieve on force path");
			},
			storeMessageBodyStream: async () => ({
				uri: "s3://bodies/m",
			}),
			storeParsedBody: async () => {},
			listBodyParts: async () => [],
		} as unknown as StorageService;

		const addressService = {
			getAddress: async () => {
				throw new NotFoundError("not found");
			},
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
			},
		} as unknown as PlacementMoveService;

		const filterConfig: FilterConfig = {
			filterService: {
				listByAccountAndState: async () => [
					buildInvitationFilter(MAILBOXES.junk.mailboxId),
				],
				refreshExpiry: async (f: FilterItem) => f,
			} as unknown as IFilterRepository,
			filterAnchorService: {
				get: async () => undefined,
			} as unknown as IFilterAnchorRepository,
			messageLabelService: {
				apply: async () => {},
			} as unknown as IMessageLabelRepository,
			placementMoveService,
		};

		const service = new BodySyncService(
			messageService,
			storageService,
			threadMessageService,
			addressService,
			envelopeService,
			{ info: () => {}, error: () => {}, debug: () => {}, warn: () => {} },
			{ mailboxSpecialUseService, placementMoveService },
			filterConfig,
		);

		// UID 1 is the stored message, UID 2 is new. fetchMessageBodies yields
		// in order; the stored one (DEMOTE_EML) would demote if placement ran,
		// the new one (INVITATION_EML) would trigger the filter.
		const connection = {
			openBox: async () => {},
			async *fetchMessageBodies() {
				yield { uid: 1, source: streamBody(DEMOTE_EML) };
				yield { uid: 2, source: streamBody(INVITATION_EML) };
			},
		} as unknown as IImapConnection;

		const result = await service.syncBodies(
			["m-stored", "m-new"],
			"acc-1",
			"cfg-1",
			"INBOX",
			async () => connection,
			true,
		);

		// Both messages were handled.
		assert.deepEqual(result.syncedMessageIds.sort(), ["m-new", "m-stored"]);

		// The stored message is a re-store: no placement move, no filter run.
		const storedUpdate = messageUpdates.find((u) => u.messageId === "m-stored");
		assert.equal(storedUpdate?.input.movedByRemit, undefined);
		assert.equal(storedUpdate?.input.filterMove, undefined);
		assert.deepEqual(
			Object.keys(storedUpdate?.input ?? {}).sort(),
			["bodyStorageKey"],
			"stored message in a forced batch must re-store (bytes only)",
		);

		// The new message is a first-store: the filter fires.
		assert.deepEqual(
			moves,
			[
				{
					messageId: "m-new",
					destinationMailboxId: MAILBOXES.junk.mailboxId,
				},
			],
			"only the never-stored message in the forced batch takes the decision pass",
		);
		const newUpdate = messageUpdates.find((u) => u.messageId === "m-new");
		assert.equal(newUpdate?.input.movedByRemit, true);
		assert.equal(newUpdate?.input.filterMove?.filterId, "flt-invite");
	});
});
