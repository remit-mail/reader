import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import type { RemitClient } from "@remit/backend/client";
import {
	buildOrganizeMatchDeps,
	type OrganizeMatchDeps,
} from "@remit/backend/organize";
import {
	type CreateOrganizeJobRequestInput,
	type FilterClauses,
	type FilterItem,
	filterRuleFromClauses,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import {
	createSqliteRepositories,
	type DrizzleThreadMessageRepository,
	messageObjectsInMemory,
	NODE_SQLITE_LIMITS,
} from "@remit/drizzle-service";
import {
	createShippedSqliteDb,
	sharedDatabases,
} from "@remit/drizzle-service/test-sqlite";
import { noopLogger } from "@remit/logger";
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
	literalClauses: FilterClauses["literalClauses"],
): RemitClient =>
	({
		queues: { messageManagement: recordingQueue() },
		organizeJobRequest: {
			get: async () => ({
				organizeJobId: "job-1",
				accountConfigId: "cfg-1",
				filterId: "None",
				matchOperator: "And",
				literalClauses,
				rule: filterRuleFromClauses({ matchOperator: "And", literalClauses }),
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
		listAccountFilterMessages: async () => {
			throw new Error("SQLITE_BUSY");
		},
	}) as OrganizeMatchDeps;

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
	ruleChangedAt: 1,
	actionChangedAt: 1,
	priority: 0,
	stop: false,
	rule: filterRuleFromClauses({
		matchOperator: "And",
		literalClauses: [{ field: "From", value: "billing@example.com" }],
	}),
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
	filterUpdates: Array<{ filterId: string; patch: Record<string, unknown> }>;
	moves: Move[];
	labeled: string[];
	close: () => void;
}

const world = async (filters: FilterItem[]): Promise<World> => {
	const store = createShippedSqliteDb();
	const threadMessage = createSqliteRepositories(
		sharedDatabases(store),
		NODE_SQLITE_LIMITS,
		messageObjectsInMemory(),
	).threadMessage;
	const { inbox, archive } = await seedThreads(threadMessage);
	const updates: Update[] = [];
	const filterUpdates: World["filterUpdates"] = [];
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
				matchOperator: "And",
				literalClauses: [],
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
			update: async (
				_cfg: string,
				filterId: string,
				patch: Record<string, unknown>,
			) => {
				filterUpdates.push({ filterId, patch });
				return {};
			},
		},
		account: {
			listMailSourcesByAccountConfig: async () => [{ accountId: "acct-1" }],
			get: async (accountId: string) => ({
				accountId,
				email: accountId === "acct-1" ? "me@example.com" : "me-too@example.com",
			}),
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
		mailbox: {
			resolveAccountId: async (mailboxId: string) =>
				mailboxId === "mbx-gone"
					? null
					: mailboxId === "mbx-sibling-travel"
						? "acct-2"
						: "acct-1",
			get: async (_accountId: string, mailboxId: string) => ({
				mailboxId,
				fullPath: mailboxId === "mbx-sibling-travel" ? "Travel" : "Invoices",
			}),
		},
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
		filterUpdates,
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
				rule: filterRuleFromClauses({
					matchOperator: "And",
					literalClauses: [{ field: "HasWords", value: "overdue" }],
				}),
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

	it("skips another account's mail, as if the filter had not matched", async () => {
		current = await world([
			standingFilter({
				actionLabelId: "lbl-trips",
				actionMailboxId: "mbx-sibling-travel",
			}),
		]);

		await runFilterJob(current);

		assert.deepEqual(current.moves, []);
		assert.deepEqual(current.labeled, []);
		assert.deepEqual(current.filterUpdates, []);
		const done = current.updates.at(-1);
		assert.equal(done?.state, "Complete");
		assert.equal(done?.appliedCount, 0);
		assert.equal(done?.failedCount, 0);
	});

	it("turns the filter off and fails the job when no account holds its folder", async () => {
		current = await world([standingFilter({ actionMailboxId: "mbx-gone" })]);

		await runFilterJob(current);

		assert.deepEqual(current.moves, []);
		assert.deepEqual(current.filterUpdates, [
			{
				filterId: "flt-1",
				patch: { state: "Disabled", disabledReason: "FolderMissing" },
			},
		]);
		const done = current.updates.at(-1);
		assert.equal(done?.state, "Failed");
		assert.match(String(done?.errorMessage), /no longer exists/);
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
});

describe("processOrganizeJob for a source-folder job", () => {
	let close: (() => void) | undefined;
	afterEach(() => close?.());

	const OLD = Date.parse("2026-01-10T09:00:00+01:00");
	const RECENT = Date.parse("2026-10-10T09:00:00+02:00");

	const runSourceFolderJob = async (
		range: Pick<CreateOrganizeJobRequestInput, "sentAfter" | "sentBefore">,
	) => {
		const store = createShippedSqliteDb();
		close = store.close;
		const repos = createSqliteRepositories(
			sharedDatabases(store),
			NODE_SQLITE_LIMITS,
			messageObjectsInMemory(),
		);
		const config = await repos.accountConfig.create({
			userId: "user-1",
			name: "Me",
		});
		const accountConfigId = config.accountConfigId;
		const account = await repos.account.create({
			accountConfigId,
			username: "me@example.com",
			email: "me@example.com",
			authType: "password",
			passwordHash: '{"ciphertext":"x"}',
			imapHost: "imap.example.com",
			imapPort: 993,
			imapTls: true,
			imapStartTls: false,
			isActive: true,
			connectionState: "authenticated",
		});
		const folder = async (fullPath: string): Promise<string> => {
			const created = await repos.mailbox.create({
				accountId: account.accountId,
				namespacePrefix: "",
				hierarchyDelimiter: "/",
				fullPath,
				uidValidity: 7,
				uidNext: 1,
				highestModseq: "0",
				messageCount: 0,
				unseenCount: 0,
				deletedCount: 0,
				totalSize: 0,
				lastSyncUid: 0,
				highWaterMarkUid: 0,
				lastMessageSyncAt: 0,
			});
			assert.equal(created.outcome, "Created");
			return created.mailbox.mailboxId;
		};
		const source = await folder("Promoties");
		const target = await folder("remit/Promotions");
		for (const [uid, sentDate] of [
			[1, OLD],
			[2, RECENT],
		]) {
			const message = await repos.message.create({
				messageId: randomUUID(),
				mailboxId: source,
				uid,
				sequenceNumber: uid,
				rfc822Size: 100,
				internalDate: uid,
				status: "active",
				syncStatus: "synced",
			});
			await repos.threadMessage.create({
				accountConfigId,
				threadId: message.messageId,
				messageId: message.messageId,
				mailboxId: source,
				uid,
				referenceOrder: 0,
				internalDate: uid,
				sentDate,
				subject: `Offer ${uid}`,
				isRead: false,
				isDeleted: false,
				hasAttachment: false,
				hasStars: false,
			});
		}
		const job = await repos.organizeJobRequest.create({
			accountConfigId,
			userId: "user-1",
			filterId: "None",
			rule: filterRuleFromClauses({ matchOperator: "And", literalClauses: [] }),
			actionLabelId: "None",
			actionMailboxId: target,
			sourceMailboxId: source,
			...range,
			ttl: 0,
		});
		const client = {
			...repos,
			queues: { messageManagement: recordingQueue() },
		} as unknown as RemitClient<"messageManagement">;

		await processOrganizeJob(
			{
				type: "OrganizeJob",
				accountConfigId,
				organizeJobId: job.organizeJobId,
			},
			noopLogger,
			{ client },
		);

		const inFolder = async (mailboxId: string) =>
			(
				await repos.threadMessage.listByMailbox(accountConfigId, mailboxId, {
					excludeDeleted: true,
				})
			).items.length;
		const done = await repos.organizeJobRequest.get(job.organizeJobId);
		return {
			inSource: await inFolder(source),
			inTarget: await inFolder(target),
			state: done.state,
			appliedCount: done.appliedCount,
		};
	};

	it("moves every message out of the source folder into the target", async () => {
		assert.deepEqual(
			await runSourceFolderJob({ sentAfter: "None", sentBefore: "None" }),
			{ inSource: 0, inTarget: 2, state: "Complete", appliedCount: 2 },
		);
	});

	it("moves only the messages dated before the job's cutoff", async () => {
		assert.deepEqual(
			await runSourceFolderJob({
				sentAfter: "None",
				sentBefore: "2026-08-13T00:00:00+02:00",
			}),
			{ inSource: 1, inTarget: 1, state: "Complete", appliedCount: 1 },
		);
	});
});
