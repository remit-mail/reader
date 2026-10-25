/**
 * The read-path body backfill must run the account's standing filters through
 * the filter config `createRemitClient` hands its BodySyncService (issues
 * #223, #298).
 *
 * These drive the composed client — `createRemitClient(...).bodySync` — rather
 * than `buildReadPathFilterConfig` alone, so dropping that wiring fails here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	CreateMessageLabelInput,
	FilterItem,
	UpdateMessageInput,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import { FilterMatchOperator, FilterState } from "@remit/domain-enums";
import {
	type FilterMessage,
	type IImapConnection,
	NO_ACTION,
} from "@remit/mailbox-service";
import type { SecretsService } from "@remit/secrets-service";
import type { StorageService } from "@remit/storage-service";
import {
	createRemitClient,
	type RemitClientRepositories,
} from "./create-remit-client.js";

const MESSAGE: FilterMessage = {
	from: "billing@stripe.com",
	fromName: "Stripe",
	subject: "Your receipt",
	text: "Thanks for your payment",
	listId: "",
};

const eml = (message: FilterMessage): Buffer =>
	Buffer.from(
		[
			`From: ${message.fromName} <${message.from}>`,
			"To: me@example.com",
			`Subject: ${message.subject}`,
			"Content-Type: text/plain",
			"",
			message.text,
		].join("\r\n"),
	);

/**
 * A sender filter. Its action is a label, which the fake MessageLabel
 * repository below records.
 */
const senderFilter: FilterItem = {
	filterId: "flt-stripe",
	accountConfigId: "cfg-1",
	name: "receipts",
	scope: "Standing",
	state: FilterState.Active,
	ruleChangedAt: 1,
	matchOperator: FilterMatchOperator.Or,
	literalClauses: [{ field: "From", value: "billing@stripe.com" }],
	actionLabelId: "lbl-receipts",
	actionMailboxId: NO_ACTION,
	createdAt: 1,
	updatedAt: 1,
} as unknown as FilterItem;

const repositoriesWithFilter = (
	applied: CreateMessageLabelInput[] = [],
): RemitClientRepositories =>
	({
		filter: {
			listByAccountAndState: async () => [senderFilter],
			refreshExpiry: async (filter: FilterItem) => filter,
		},
		messageLabel: {
			apply: async (input: CreateMessageLabelInput) => {
				applied.push(input);
			},
		},
		message: {
			get: async (messageId: string) => ({
				messageId,
				mailboxId: "mb-inbox",
				uid: 1,
			}),
			update: async (_messageId: string, _input: UpdateMessageInput) => {},
		},
		threadMessage: {
			findAllByMessageId: async () => [
				{
					threadMessageId: "tm-1",
					sentDate: 1,
					mailboxId: "mb-inbox",
					isRead: false,
					isDeleted: false,
					hasStars: false,
					hasAttachment: false,
				},
			],
			update: async () => {},
		},
		address: {
			getAddress: async () => {
				throw new NotFoundError("Address not found");
			},
			incrementInboundCount: async () => {},
		},
		envelope: { listBodyParts: async () => [] },
		placementMove: {},
		mailboxSpecialUse: {},
	}) as unknown as RemitClientRepositories;

const storage = {
	storeMessageBody: async () => ({ uri: "s3://bodies/m-1" }),
	storeParsedBody: async () => {},
	listBodyParts: async () => [],
} as unknown as StorageService;

const readBodyThroughClient = async (
	repositories: RemitClientRepositories,
	message: FilterMessage,
): Promise<void> => {
	const client = createRemitClient({
		repositories,
		storage,
		secrets: {} as unknown as SecretsService,
		queues: {
			sync: recordingQueue(),
			accountFanout: recordingQueue(),
			smtp: recordingQueue(),
			messageManagement: recordingQueue(),
			body: recordingQueue(),
		},
	});
	const connection = {
		openBox: async () => {},
		fetchMessageBody: async () => eml(message),
	} as unknown as IImapConnection;

	await client.bodySync.fetchAndGetBody(
		"m-1",
		"acc-1",
		"cfg-1",
		{ mailboxId: "mb-inbox", fullPath: "INBOX", placement: "inbox" },
		async () => connection,
	);
};

describe("createRemitClient read-path filter config", () => {
	it("labels a message a standing filter matches on a read-path backfill", async () => {
		const applied: CreateMessageLabelInput[] = [];

		await readBodyThroughClient(repositoriesWithFilter(applied), MESSAGE);

		assert.deepEqual(
			applied.map(({ labelId, appliedByFilterId }) => ({
				labelId,
				appliedByFilterId,
			})),
			[{ labelId: "lbl-receipts", appliedByFilterId: "flt-stripe" }],
		);
	});

	it("leaves a message the filter does not match unlabelled", async () => {
		const applied: CreateMessageLabelInput[] = [];

		await readBodyThroughClient(repositoriesWithFilter(applied), {
			...MESSAGE,
			from: "status@example.com",
			fromName: "Status",
		});

		assert.deepEqual(applied, []);
	});
});
