/**
 * The read-path body backfill must run a semantic (anchor-only) standing filter,
 * which needs the env-selected embedder wired into the filter config
 * `createRemitClient` hands its BodySyncService (issue #298).
 *
 * These drive the composed client — `createRemitClient(...).bodySync` — rather
 * than `buildReadPathFilterConfig` alone, so replacing that call with an inline
 * filter-config literal (which carries no embedder) fails here.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
	CreateMessageLabelInput,
	FilterAnchorItem,
	FilterItem,
	UpdateMessageInput,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { FilterMatchOperator, FilterState } from "@remit/domain-enums";
import {
	buildMatchText,
	type FilterMessage,
	type IImapConnection,
	NO_ACTION,
} from "@remit/mailbox-service";
import type { SearchService } from "@remit/search-service";
import { buildEmbeddingServiceFromEnv } from "@remit/search-service/from-env";
import type { SecretsService } from "@remit/secrets-service";
import type { StorageService } from "@remit/storage-service";
import {
	buildReadPathFilterConfig,
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
 * Anchor-only: no literal clauses, so it matches on the embedding alone. Its
 * action is a label, which the fake MessageLabel repository below records —
 * a move would run the real PlacementMoveService against SQS.
 */
const anchorOnlyFilter: FilterItem = {
	filterId: "flt-semantic",
	accountConfigId: "cfg-1",
	name: "receipts",
	scope: "Standing",
	state: FilterState.Active,
	hasAnchor: true,
	ruleChangedAt: 1,
	matchOperator: FilterMatchOperator.Or,
	literalClauses: [],
	actionLabelId: "lbl-receipts",
	actionMailboxId: NO_ACTION,
	createdAt: 1,
	updatedAt: 1,
} as unknown as FilterItem;

// The read path must embed a candidate message under the same model that wrote
// the anchors, so an anchor written from this text matches it exactly.
const anchorFor = async (message: FilterMessage): Promise<FilterAnchorItem> => {
	const embedding = buildEmbeddingServiceFromEnv();
	const [anchorEmbedding] = await embedding.embed([buildMatchText(message)]);
	return {
		accountConfigId: "cfg-1",
		filterId: "flt-semantic",
		anchorEmbedding,
		anchorEmbeddingId: embedding.embeddingId,
		anchorSourceText: buildMatchText(message),
		anchorMessageId: "m-anchor",
	} as unknown as FilterAnchorItem;
};

const repositoriesWithAnchor = (
	anchor: FilterAnchorItem,
	applied: CreateMessageLabelInput[] = [],
): RemitClientRepositories =>
	({
		filter: {
			listByAccountAndState: async () => [anchorOnlyFilter],
			refreshExpiry: async (filter: FilterItem) => filter,
		},
		filterAnchor: { get: async () => anchor },
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
		search: {} as unknown as SearchService,
		secrets: {} as unknown as SecretsService,
		sqsQueueUrl: "https://sqs.eu-west-1.amazonaws.com/0/test",
		sqsSmtpQueueUrl: "https://sqs.eu-west-1.amazonaws.com/0/test-smtp",
	});
	const connection = {
		openBox: async () => {},
		fetchMessageBody: async () => eml(message),
	} as unknown as IImapConnection;

	await client.bodySync.fetchAndGetBody(
		"m-1",
		"acc-1",
		"cfg-1",
		"INBOX",
		async () => connection,
	);
};

describe("createRemitClient read-path filter config", () => {
	let previousQueueUrl: string | undefined;

	beforeEach(() => {
		previousQueueUrl = process.env.SQS_QUEUE_URL_MESSAGE_MGMT;
		process.env.SQS_QUEUE_URL_MESSAGE_MGMT =
			"https://sqs.eu-west-1.amazonaws.com/0/test-message-mgmt";
	});

	afterEach(() => {
		if (previousQueueUrl === undefined) {
			delete process.env.SQS_QUEUE_URL_MESSAGE_MGMT;
			return;
		}
		process.env.SQS_QUEUE_URL_MESSAGE_MGMT = previousQueueUrl;
	});

	it("labels a message an anchor-only filter matches on a read-path backfill", async () => {
		const applied: CreateMessageLabelInput[] = [];

		await readBodyThroughClient(
			repositoriesWithAnchor(await anchorFor(MESSAGE), applied),
			MESSAGE,
		);

		assert.deepEqual(
			applied.map(({ labelId, appliedByFilterId }) => ({
				labelId,
				appliedByFilterId,
			})),
			[{ labelId: "lbl-receipts", appliedByFilterId: "flt-semantic" }],
		);
	});

	it("leaves a message the anchor does not match unlabelled", async () => {
		const applied: CreateMessageLabelInput[] = [];

		await readBodyThroughClient(
			repositoriesWithAnchor(
				await anchorFor({
					...MESSAGE,
					subject: "Scheduled maintenance window",
					text: "Our service will be unavailable on Sunday",
				}),
				applied,
			),
			MESSAGE,
		);

		assert.deepEqual(applied, []);
	});
});

describe("buildReadPathFilterConfig", () => {
	it("keeps filters off when the message-management queue is unset", async () => {
		const previous = process.env.SQS_QUEUE_URL_MESSAGE_MGMT;
		delete process.env.SQS_QUEUE_URL_MESSAGE_MGMT;
		try {
			assert.equal(
				buildReadPathFilterConfig(
					repositoriesWithAnchor(await anchorFor(MESSAGE)),
				),
				undefined,
			);
		} finally {
			if (previous !== undefined) {
				process.env.SQS_QUEUE_URL_MESSAGE_MGMT = previous;
			}
		}
	});
});
