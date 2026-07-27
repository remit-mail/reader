/**
 * The read path (describeMessage / getRawMessage → fetchAndGetBody) and the
 * imap-worker sync path share BodySyncService.applyPostStoreSteps, so a body
 * materialized by a read must run the account's standing filters — the same
 * move and marker the sync path writes. The backend wires `filterConfig` into
 * its BodySyncService for exactly this (create-remit-client.ts); without it a
 * message opened before background body-sync is classified but never
 * filter-moved (issue #223).
 *
 * These drive fetchAndGetBody with a matching literal filter and assert the
 * move and the `filterMove` marker — and that the marker is written only for a
 * real relocation: a message already sitting in the filter's destination
 * matches by content but was not moved by Remit, so it must get no marker (and
 * no spurious "Moved by Remit" badge with a no-op Undo).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	FilterItem,
	IAddressRepository,
	IEnvelopeRepository,
	IFilterAnchorRepository,
	IFilterRepository,
	IMessageLabelRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
	UpdateMessageInput,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import {
	FilterClauseField,
	FilterMatchOperator,
	FilterState,
} from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import { BodySyncService } from "./body-sync.js";
import { NO_ACTION } from "./filters/match.js";
import type { FilterConfig } from "./filters/pipeline.js";
import type { PlacementMoveService } from "./placement-move.js";
import type { IImapConnection } from "./types.js";

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

interface MoveCall {
	messageId: string;
	destinationMailboxId: string;
}

interface Harness {
	service: BodySyncService;
	messageUpdates: Array<{ messageId: string; input: UpdateMessageInput }>;
	moves: MoveCall[];
}

/** A standing literal filter that moves subjects containing "invitation" to `destinationMailboxId`. */
const buildFilter = (destinationMailboxId: string): FilterItem =>
	({
		filterId: "flt-1",
		accountConfigId: "cfg-1",
		name: "Invitations",
		scope: "Standing",
		state: FilterState.Active,
		hasAnchor: false,
		ruleChangedAt: 1,
		matchOperator: FilterMatchOperator.And,
		literalClauses: [{ field: FilterClauseField.Subject, value: "invitation" }],
		actionLabelId: NO_ACTION,
		actionMailboxId: destinationMailboxId,
		createdAt: 1,
		updatedAt: 1,
	}) as unknown as FilterItem;

const buildHarness = (
	message: Pick<MessageItem, "messageId" | "mailboxId">,
	filter: FilterItem,
): Harness => {
	const messageUpdates: Array<{
		messageId: string;
		input: UpdateMessageInput;
	}> = [];
	const moves: MoveCall[] = [];

	const messageService = {
		get: async (messageId: string) => ({
			messageId,
			mailboxId: message.mailboxId,
			uid: 1,
		}),
		update: async (messageId: string, input: UpdateMessageInput) => {
			messageUpdates.push({ messageId, input });
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => [
			{
				threadMessageId: "tm-1",
				sentDate: 1,
				mailboxId: message.mailboxId,
				isRead: false,
				isDeleted: false,
				hasStars: false,
				hasAttachment: false,
			},
		],
		update: async () => {},
	} as unknown as IThreadMessageRepository;

	const storageService = {
		storeMessageBody: async () => ({ uri: "s3://bodies/m-1" }),
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
	};

	const service = new BodySyncService(
		messageService,
		storageService,
		threadMessageService,
		addressService,
		envelopeService,
		{ info: () => {} },
		undefined,
		filterConfig,
	);

	return { service, messageUpdates, moves };
};

const readBody = async (service: BodySyncService, mailboxPath = "INBOX") => {
	const connection = {
		openBox: async () => {},
		fetchMessageBody: async () => INVITATION_EML,
	} as unknown as IImapConnection;
	return service.fetchAndGetBody(
		"m-1",
		"acc-1",
		"cfg-1",
		mailboxPath,
		async () => connection,
	);
};

describe("body-sync read-path standing filter", () => {
	it("runs the standing filter on a read-path body backfill and records the move + marker", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", mailboxId: "mb-inbox" },
			buildFilter("mb-travel"),
		);

		await readBody(harness.service);

		// (a) the move fired to the filter's destination
		assert.deepEqual(harness.moves, [
			{ messageId: "m-1", destinationMailboxId: "mb-travel" },
		]);

		// (b) the emitted update carries the marker with the correct source/dest
		assert.equal(harness.messageUpdates.length, 1);
		const { input } = harness.messageUpdates[0];
		assert.equal(input.movedByRemit, true);
		assert.deepEqual(
			{
				filterId: input.filterMove?.filterId,
				sourceMailboxId: input.filterMove?.sourceMailboxId,
				destinationMailboxId: input.filterMove?.destinationMailboxId,
			},
			{
				filterId: "flt-1",
				sourceMailboxId: "mb-inbox",
				destinationMailboxId: "mb-travel",
			},
		);
	});

	it("writes no marker when the message already sits in the filter's destination", async () => {
		// Matches the filter by content, but is already in the destination (a
		// server-side rule delivered it there, or the user filed it). Remit moved
		// nothing — no marker, no movedByRemit, so no badge and no no-op Undo.
		const harness = buildHarness(
			{ messageId: "m-1", mailboxId: "mb-travel" },
			buildFilter("mb-travel"),
		);

		await readBody(harness.service);

		assert.equal(harness.messageUpdates.length, 1);
		const { input } = harness.messageUpdates[0];
		assert.equal(input.filterMove, undefined);
		assert.equal(input.movedByRemit, undefined);
	});
});
