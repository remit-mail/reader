import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import type { RemitClient } from "@remit/backend/client";
import {
	buildOrganizeMatchDeps,
	type OrganizeMatchDeps,
	type OrganizeSemanticDeps,
} from "@remit/backend/organize";
import type { FilterAnchorItem, FilterItem } from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { DrizzleThreadMessageRepository } from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import { noopLogger } from "@remit/logger-lambda/noop-logger";
import type { OrganizeJobEvent } from "../events.js";
import {
	type ProcessOrganizeJobDeps,
	processOrganizeJob,
} from "./organize-job.js";

interface Update {
	state: string;
	errorMessage?: string;
	matchedCount?: number;
	appliedCount?: number;
	failedCount?: number;
}

const event: OrganizeJobEvent = {
	type: "OrganizeJob",
	accountConfigId: "cfg-1",
	organizeJobId: "job-1",
};

const jobClient = (
	updates: Update[],
	literalClauses: Array<{ field: string; value: string }>,
): RemitClient =>
	({
		organizeJobRequest: {
			get: async () => ({
				organizeJobId: "job-1",
				accountConfigId: "cfg-1",
				filterId: "None",
				anchorMessageId: "None",
				matchOperator: "And",
				literalClauses,
				similarityThreshold: 0.75,
				actionLabelId: "lbl-1",
				actionMailboxId: "None",
			}),
			update: async (_id: string, patch: Update) => {
				updates.push(patch);
			},
		},
	}) as unknown as RemitClient;

/**
 * Matcher deps whose corpus read is a landmine: reaching it at all means the
 * predicate was not refused up front, and the thrown error stands in for the
 * infrastructure-class failure a retry exists for.
 */
const explodingMatchDeps = (): OrganizeMatchDeps =>
	({
		semantic: () => {
			throw new Error("the vector pipeline must not be reached");
		},
		listAccountFilterMessages: async () => {
			throw new Error("SQLITE_BUSY");
		},
		filterAnchors: {
			get: async () => null,
			listByAccountConfig: async () => [],
			put: async () => {
				throw new Error("unreachable");
			},
		},
	}) as unknown as OrganizeMatchDeps;

describe("processOrganizeJob (reader #463)", () => {
	it("fails the job on a refused rule and acknowledges the record", async () => {
		const updates: Update[] = [];

		await processOrganizeJob(event, noopLogger, {
			client: jobClient(updates, [{ field: "HasWords", value: "invoice" }]),
			matchDeps: explodingMatchDeps(),
		});

		assert.deepEqual(
			updates.map((u) => u.state),
			["Running", "Failed"],
		);
		const failed = updates[1];
		assert.match(String(failed?.errorMessage), /HasWords/);
		assert.equal(failed?.matchedCount, 0);
		assert.equal(failed?.appliedCount, 0);
		assert.equal(failed?.failedCount, 0);
	});

	it("fails the job and propagates an infrastructure failure so the record retries", async () => {
		const updates: Update[] = [];

		await assert.rejects(
			processOrganizeJob(event, noopLogger, {
				client: jobClient(updates, [
					{ field: "Subject", value: "reservation" },
				]),
				matchDeps: explodingMatchDeps(),
			}),
			/SQLITE_BUSY/,
			"an SQS/DDB-class failure must stay loud so partial batch failure redelivers it",
		);

		assert.deepEqual(
			updates.map((u) => u.state),
			["Running", "Failed"],
		);
		assert.equal(updates[1]?.errorMessage, "SQLITE_BUSY");
	});
});

interface Move {
	messageId: string;
	destinationMailboxId: string;
}

const CONFIG = "cfg-1";
const INBOX = "mbx-inbox";
const ARCHIVE = "mbx-archive";

const standingFilter = (over: Partial<FilterItem> = {}): FilterItem => ({
	filterId: "flt-1",
	accountConfigId: CONFIG,
	name: "Invoices",
	scope: "Standing",
	state: "Active",
	disabledReason: "None",
	hasAnchor: false,
	ruleChangedAt: 1,
	actionChangedAt: 1,
	matchOperator: "And",
	literalClauses: [{ field: "From", value: "billing@example.com" }],
	actionLabelId: "None",
	actionMailboxId: "mbx-invoices",
	createdAt: 0,
	updatedAt: 0,
	...over,
});

/**
 * The thread rows live in the shipped SQLite schema, read through the real
 * repository, so the inbox narrowing is the store's own query. One invoice
 * sits in the inbox and one in the archive, both from the filter's sender
 * and both saying "overdue" in their preview.
 */
const seedThreads = async (
	threadMessage: DrizzleThreadMessageRepository,
): Promise<{ inbox: string; archive: string }> => {
	const seed = async (mailboxId: string, uid: number): Promise<string> => {
		const messageId = randomUUID();
		await threadMessage.create({
			accountConfigId: CONFIG,
			threadId: randomUUID(),
			messageId,
			mailboxId,
			uid,
			referenceOrder: 0,
			internalDate: uid,
			sentDate: uid,
			subject: "Your invoice",
			fromEmail: "billing@example.com",
			fromName: "Billing",
			snippet: "This invoice is overdue",
			isRead: false,
			isDeleted: false,
			hasAttachment: false,
			hasStars: false,
		});
		return messageId;
	};
	return { inbox: await seed(INBOX, 1), archive: await seed(ARCHIVE, 2) };
};

interface World {
	client: RemitClient;
	inbox: string;
	archive: string;
	updates: Update[];
	moves: Move[];
	labeled: string[];
	close: () => void;
}

const world = async (
	filters: FilterItem[],
	anchors: FilterAnchorItem[] = [],
): Promise<World> => {
	const store = createShippedSqliteDb();
	const threadMessage = new DrizzleThreadMessageRepository(store.db as never);
	const { inbox, archive } = await seedThreads(threadMessage);
	const updates: Update[] = [];
	const labeled: string[] = [];
	const mailboxOf: Record<string, string> = {
		[inbox]: INBOX,
		[archive]: ARCHIVE,
	};
	const client = {
		threadMessage,
		organizeJobRequest: {
			get: async () => ({
				organizeJobId: "job-1",
				accountConfigId: CONFIG,
				filterId: "flt-1",
				anchorMessageId: "None",
				matchOperator: "And",
				literalClauses: [],
				similarityThreshold: 0.75,
				actionLabelId: "None",
				actionMailboxId: "None",
			}),
			update: async (_id: string, patch: Update) => {
				updates.push(patch);
			},
		},
		filter: {
			get: async (_cfg: string, filterId: string) => {
				const found = filters.find((f) => f.filterId === filterId);
				if (!found) throw new NotFoundError(`Filter not found: ${filterId}`);
				return found;
			},
			refreshExpiry: async (filter: FilterItem) => filter,
			listByAccountAndState: async (_cfg: string, state: string) =>
				filters.filter((f) => f.state === state),
		},
		filterAnchor: {
			get: async (_cfg: string, filterId: string) =>
				anchors.find((anchor) => anchor.filterId === filterId) ?? null,
		},
		account: {
			listMailSourcesByAccountConfig: async () => [{ accountId: "acct-1" }],
		},
		mailboxSpecialUse: {
			findInboxMailbox: async () => ({ mailboxId: INBOX, fullPath: "INBOX" }),
		},
		message: {
			get: async (messageId: string) => ({
				messageId,
				mailboxId: mailboxOf[messageId],
			}),
		},
		mailbox: { resolveAccountId: async () => "acct-1" },
		messageLabel: {
			apply: async (input: { messageId: string }) => {
				labeled.push(input.messageId);
				return {};
			},
		},
	} as unknown as RemitClient;
	return {
		client,
		inbox,
		archive,
		updates,
		moves: [],
		labeled,
		close: store.close,
	};
};

const recordingMoves = (moves: Move[]) =>
	({
		moveMessage: async (
			_cfg: string,
			messageId: string,
			destinationMailboxId: string,
		) => {
			moves.push({ messageId, destinationMailboxId });
		},
	}) as unknown as NonNullable<ProcessOrganizeJobDeps["moveService"]>;

const runFilterJob = (w: World) =>
	processOrganizeJob(event, noopLogger, {
		client: w.client,
		matchDeps: buildOrganizeMatchDeps(w.client),
		moveService: recordingMoves(w.moves),
	});

const EMBEDDING_ID = "test-model@4";
const ANCHOR_VECTOR = [1, 0, 0, 0];
const ORTHOGONAL_VECTOR = [0, 1, 0, 0];

const persistedAnchor: FilterAnchorItem = {
	filterId: "flt-1",
	accountConfigId: CONFIG,
	anchorMessageId: "msg-anchor",
	anchorEmbedding: ANCHOR_VECTOR,
	anchorEmbeddingId: EMBEDDING_ID,
	anchorSourceText: "Your invoice",
	createdAt: 0,
	updatedAt: 0,
};

/**
 * The vector index answers the anchor with the inbox invoice, and only when
 * asked about the inbox: the kNN read is where a similarity filter finds its
 * candidates.
 */
const vectorMatchDeps = (w: World): OrganizeMatchDeps => ({
	...buildOrganizeMatchDeps(w.client),
	semantic: () => ({
		buildAnchor: async () => {
			throw new Error("a filter widens on its persisted anchor");
		},
		vectorStore: {
			query: async (query: { filter?: { mailboxId?: string } }) =>
				query.filter?.mailboxId === INBOX
					? [
							{
								chunkId: `${w.inbox}#body`,
								score: 0.9,
								metadata: { messageId: w.inbox, mailboxIds: [INBOX] },
							},
						]
					: [],
			getByMessage: async () => [],
		} as unknown as OrganizeSemanticDeps["vectorStore"],
		embed: async () => ANCHOR_VECTOR,
		embeddingId: EMBEDDING_ID,
	}),
});

describe("processOrganizeJob for a filter job (#1354)", () => {
	let current: World | undefined;
	afterEach(() => current?.close());

	it("moves the pre-existing matching inbox message and leaves the archive alone", async () => {
		current = await world([standingFilter()]);

		await runFilterJob(current);

		assert.deepEqual(current.moves, [
			{ messageId: current.inbox, destinationMailboxId: "mbx-invoices" },
		]);
		const done = current.updates.at(-1);
		assert.equal(done?.state, "Complete");
		assert.equal(done?.matchedCount, 1);
		assert.equal(done?.appliedCount, 1);
	});

	it("matches a free-text rule from search on the stored preview", async () => {
		current = await world([
			standingFilter({
				literalClauses: [{ field: "HasWords", value: "overdue" }],
			}),
		]);

		await runFilterJob(current);

		assert.deepEqual(current.moves, [
			{ messageId: current.inbox, destinationMailboxId: "mbx-invoices" },
		]);
		assert.equal(current.updates.at(-1)?.state, "Complete");
	});

	it("leaves the move to a newer filter that also matches, and still labels", async () => {
		current = await world([
			standingFilter({ actionLabelId: "lbl-bills" }),
			standingFilter({
				filterId: "flt-2",
				name: "Receipts",
				actionChangedAt: 2,
				actionMailboxId: "mbx-receipts",
			}),
		]);

		await runFilterJob(current);

		assert.deepEqual(current.moves, []);
		assert.deepEqual(current.labeled, [current.inbox]);
		assert.equal(current.updates.at(-1)?.state, "Complete");
	});

	it("fails the job without a retry when the filter is turned off", async () => {
		current = await world([
			standingFilter({ state: "Disabled", disabledReason: "UserDisabled" }),
		]);

		await runFilterJob(current);

		assert.deepEqual(current.moves, []);
		assert.equal(current.updates.at(-1)?.state, "Failed");
		assert.match(String(current.updates.at(-1)?.errorMessage), /turned off/);
	});

	it("fails the job without a retry when the filter was deleted", async () => {
		current = await world([]);

		await runFilterJob(current);

		assert.equal(current.updates.at(-1)?.state, "Failed");
		assert.match(String(current.updates.at(-1)?.errorMessage), /deleted/);
	});

	it("moves a message the vector query found, though the preview scores below the threshold", async () => {
		current = await world(
			[standingFilter({ hasAnchor: true, literalClauses: [] })],
			[persistedAnchor],
		);

		// The index-time evaluator embeds subject and preview; this embedder puts
		// that text orthogonal to the anchor, so evaluate alone would call the
		// message a miss. It only orders the move, so the vector match stands.
		await processOrganizeJob(event, noopLogger, {
			client: current.client,
			matchDeps: vectorMatchDeps(current),
			moveService: recordingMoves(current.moves),
			embedder: {
				embed: async () => ORTHOGONAL_VECTOR,
				embeddingId: EMBEDDING_ID,
			},
		});

		assert.deepEqual(current.moves, [
			{ messageId: current.inbox, destinationMailboxId: "mbx-invoices" },
		]);
		const done = current.updates.at(-1);
		assert.equal(done?.state, "Complete");
		assert.equal(done?.matchedCount, 1);
		assert.equal(done?.appliedCount, 1);
	});
});
