import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitClient } from "@remit/backend/client";
import type { OrganizeMatchDeps } from "@remit/backend/organize";
import type { FilterItem } from "@remit/data-ports";
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

const INBOX = "mbx-inbox";
const ARCHIVE = "mbx-archive";

const standingFilter = (over: Partial<FilterItem> = {}): FilterItem => ({
	filterId: "flt-1",
	accountConfigId: "cfg-1",
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
 * One account whose inbox holds `msg-inbox` and whose archive holds
 * `msg-archive`, both from the filter's sender, plus the account's standing
 * filters. The job row names `flt-1`.
 */
const filterJobClient = (
	updates: Update[],
	labeled: string[],
	filters: FilterItem[],
): RemitClient => {
	const mailboxOf: Record<string, string> = {
		"msg-inbox": INBOX,
		"msg-archive": ARCHIVE,
	};
	return {
		organizeJobRequest: {
			get: async () => ({
				organizeJobId: "job-1",
				accountConfigId: "cfg-1",
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
				if (!found) throw new Error(`no filter ${filterId}`);
				return found;
			},
			refreshExpiry: async (filter: FilterItem) => filter,
			listByAccountAndState: async () => filters,
		},
		filterAnchor: { get: async () => null },
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
};

/** The literal corpus, honouring the mailbox narrowing the way the store does. */
const corpusMatchDeps = (): OrganizeMatchDeps =>
	({
		semantic: () => {
			throw new Error("a literal filter must not reach the vector pipeline");
		},
		listAccountFilterMessages: async (
			_cfg: string,
			query: { mailboxIds?: readonly string[] },
		) => ({
			items: [
				{ messageId: "msg-inbox", mailbox: INBOX },
				{ messageId: "msg-archive", mailbox: ARCHIVE },
			]
				.filter(
					(row) => !query.mailboxIds || query.mailboxIds.includes(row.mailbox),
				)
				.map((row) => ({
					messageId: row.messageId,
					message: {
						from: "billing@example.com",
						fromName: "Billing",
						subject: "Your invoice",
						text: "",
						listId: "",
					},
				})),
		}),
		filterAnchors: {
			get: async () => null,
			listByAccountConfig: async () => [],
			put: async () => {
				throw new Error("unreachable");
			},
		},
	}) as unknown as OrganizeMatchDeps;

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

describe("processOrganizeJob for a filter job (#1354)", () => {
	it("moves a pre-existing matching inbox message into the filter's folder", async () => {
		const updates: Update[] = [];
		const moves: Move[] = [];

		await processOrganizeJob(event, noopLogger, {
			client: filterJobClient(updates, [], [standingFilter()]),
			matchDeps: corpusMatchDeps(),
			moveService: recordingMoves(moves),
		});

		assert.deepEqual(moves, [
			{ messageId: "msg-inbox", destinationMailboxId: "mbx-invoices" },
		]);
		const done = updates.at(-1);
		assert.equal(done?.state, "Complete");
		assert.equal(done?.matchedCount, 1);
		assert.equal(done?.appliedCount, 1);
	});

	it("leaves the move to a newer filter that also matches, and still labels", async () => {
		const updates: Update[] = [];
		const moves: Move[] = [];
		const labeled: string[] = [];
		const filters = [
			standingFilter({ actionLabelId: "lbl-bills" }),
			standingFilter({
				filterId: "flt-2",
				name: "Receipts",
				actionChangedAt: 2,
				actionMailboxId: "mbx-receipts",
			}),
		];

		await processOrganizeJob(event, noopLogger, {
			client: filterJobClient(updates, labeled, filters),
			matchDeps: corpusMatchDeps(),
			moveService: recordingMoves(moves),
		});

		assert.deepEqual(moves, []);
		assert.deepEqual(labeled, ["msg-inbox"]);
		assert.equal(updates.at(-1)?.state, "Complete");
	});

	it("fails the job without a retry when the filter is turned off", async () => {
		const updates: Update[] = [];
		const moves: Move[] = [];

		await processOrganizeJob(event, noopLogger, {
			client: filterJobClient(
				updates,
				[],
				[standingFilter({ state: "Disabled", disabledReason: "UserDisabled" })],
			),
			matchDeps: corpusMatchDeps(),
			moveService: recordingMoves(moves),
		});

		assert.deepEqual(moves, []);
		assert.equal(updates.at(-1)?.state, "Failed");
		assert.match(String(updates.at(-1)?.errorMessage), /turned off/);
	});
});
