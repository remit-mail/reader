import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FilterItem } from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { FilterMatchOperator, FilterState } from "@remit/domain-enums";
import type { RemitClient } from "./data-client.js";
import {
	applyOrganize,
	BODY_CONTENT_REJECTION_MESSAGE,
	matchOrganize,
	ORGANIZE_MATCH_LIMIT,
	type OrganizeCandidate,
	type OrganizeMatchDeps,
	type OrganizeMatched,
	type OrganizePredicate,
} from "./organize.js";

const ACCOUNT_CONFIG_ID = "cfg-1";

const predicate = (
	over: Partial<OrganizePredicate> = {},
): OrganizePredicate => ({
	matchOperator: FilterMatchOperator.And,
	literalClauses: [],
	actionLabelId: "None",
	actionMailboxId: "None",
	...over,
});

/** A predicate that matches every corpus row whose subject says "reservation". */
const reservations = (
	over: Partial<OrganizePredicate> = {},
): OrganizePredicate =>
	predicate({
		literalClauses: [{ field: "Subject", value: "reservation" }],
		...over,
	});

/**
 * Run the matcher and assert it accepted the predicate, so every test that only
 * cares about the matched set reads the accepted arm directly. A rejection is a
 * result, not a throw (reader #463), so without this the two would be silently
 * interchangeable at the call site.
 */
const matchAccepted = async (
	...args: Parameters<typeof matchOrganize>
): Promise<OrganizeMatched> => {
	const result = await matchOrganize(...args);
	assert.ok(
		result.rejected === null,
		`expected an accepted match, got: ${result.rejected?.message}`,
	);
	return result;
};

/** A standing filter fixture — the account's already-existing rules. */
const filterItem = (over: Partial<FilterItem> = {}): FilterItem => ({
	filterId: "filter-other",
	accountConfigId: ACCOUNT_CONFIG_ID,
	name: "other filter",
	scope: "Standing",
	state: FilterState.Active,
	disabledReason: "None",
	ruleChangedAt: 0,
	actionChangedAt: 0,
	matchOperator: FilterMatchOperator.And,
	literalClauses: [],
	actionLabelId: "None",
	actionMailboxId: "None",
	createdAt: 0,
	updatedAt: 0,
	...over,
});

/**
 * A client that records MessageLabel writes and blows up if the back-apply path
 * ever writes a Filter — the RFC 034 guardrail: this scope never
 * persists a standing rule.
 *
 * `activeFilters`/`threadMessages` model the account's
 * *other*, already-existing standing filters and message rows. A back-apply
 * never arbitrates against them (reader #497), so `filterReads` pins that the
 * Active filter set is not even consulted.
 */
const trackingClient = (
	seed: {
		activeFilters?: FilterItem[];
		threadMessages?: Record<
			string,
			{ fromEmail?: string; fromName?: string; subject?: string }
		>;
	} = {},
) => {
	const labeled: Array<{ messageId: string; labelId: string }> = [];
	let filterWrites = 0;
	let filterReads = 0;
	const activeFilters = seed.activeFilters ?? [];
	const threadMessages = seed.threadMessages ?? {};
	const client = {
		messageLabel: {
			apply: async (input: {
				messageId: string;
				labelId: string;
				accountConfigId: string;
				appliedByFilterId?: string;
			}) => {
				assert.equal(
					input.appliedByFilterId,
					undefined,
					"back-apply must never attribute a filter",
				);
				labeled.push({ messageId: input.messageId, labelId: input.labelId });
				return {} as never;
			},
		},
		message: {
			get: async (messageId: string) => ({ messageId, mailboxId: "mbox-src" }),
		},
		mailbox: {
			resolveAccountId: async () => "acct-1",
		},
		threadMessage: {
			get: async (_accountConfigId: string, messageId: string) => {
				const row = threadMessages[messageId];
				if (!row) {
					throw new NotFoundError("ThreadMessage not found");
				}
				return {
					threadMessageId: messageId,
					fromEmail: row.fromEmail,
					fromName: row.fromName,
					subject: row.subject,
				} as never;
			},
		},
		filter: {
			create: async () => {
				filterWrites += 1;
				return {} as never;
			},
			listByAccountAndState: async () => {
				filterReads += 1;
				return activeFilters;
			},
			refreshExpiry: async (filter: FilterItem) => filter,
		},
	} as unknown as RemitClient;
	return {
		client,
		labeled,
		filterWrites: () => filterWrites,
		filterReads: () => filterReads,
	};
};

/**
 * A stand-in for the local-first placement mover. `moveMessage` is idempotent
 * on the (messageId, destination) pair — mirroring the real
 * `PlacementMoveService` marker engine (#1297) — so a redelivered back-apply
 * re-issues the same move without double-enqueuing. Records every call and the
 * final resting mailbox per message.
 */
const trackingMoveService = () => {
	const moves: Array<{
		messageId: string;
		destinationMailboxId: string;
		accountId: string;
	}> = [];
	const destinationOf = new Map<string, string>();
	let enqueues = 0;
	return {
		moveService: {
			moveMessage: async (
				_accountConfigId: string,
				messageId: string,
				destinationMailboxId: string,
				accountId: string,
			): Promise<void> => {
				moves.push({ messageId, destinationMailboxId, accountId });
				if (destinationOf.get(messageId) === destinationMailboxId) return;
				destinationOf.set(messageId, destinationMailboxId);
				enqueues += 1;
			},
		} as unknown as import("@remit/mailbox-service").PlacementMoveService,
		moves,
		enqueues: () => enqueues,
		destinations: () => destinationOf,
	};
};

const candidate = (
	messageId: string,
	over: Partial<OrganizeCandidate["message"]> = {},
): OrganizeCandidate => ({
	messageId,
	message: {
		from: "",
		fromName: "",
		subject: "",
		text: "",
		listId: "",
		...over,
	},
});

const reservation = (messageId: string): OrganizeCandidate =>
	candidate(messageId, { subject: "Dinner reservation" });

/** Deps that serve the given corpus as one page. */
const corpusDeps = (corpus: OrganizeCandidate[]): OrganizeMatchDeps => ({
	listAccountFilterMessages: async () => ({ items: corpus }),
});

describe("matchOrganize", () => {
	it("matches nothing when the predicate has no clause", async () => {
		const { messageIds } = await matchAccepted(
			corpusDeps([reservation("msg-1")]),
			ACCOUNT_CONFIG_ID,
			predicate(),
		);

		assert.deepEqual(messageIds, []);
	});

	it("matches a literal predicate against the corpus", async () => {
		const { messageIds } = await matchAccepted(
			corpusDeps([
				candidate("msg-1", { subject: "Dinner reservation" }),
				candidate("msg-2", { subject: "Weekly newsletter" }),
				candidate("msg-3", { subject: "Table reservation confirmed" }),
			]),
			ACCOUNT_CONFIG_ID,
			reservations(),
		);

		assert.deepEqual(messageIds, ["msg-1", "msg-3"]);
	});

	it("refuses a body-content (HasWords) clause as a result rather than matching it against a preview", async () => {
		const result = await matchOrganize(
			corpusDeps([reservation("msg-1")]),
			ACCOUNT_CONFIG_ID,
			predicate({ literalClauses: [{ field: "HasWords", value: "invoice" }] }),
		);

		assert.deepEqual(result.rejected, {
			reason: "BodyContentUnsupported",
			message: BODY_CONTENT_REJECTION_MESSAGE,
		});
	});

	it("propagates a failed corpus read loudly", async () => {
		await assert.rejects(
			() =>
				matchOrganize(
					{
						listAccountFilterMessages: async () => {
							throw new Error("SQLITE_BUSY");
						},
					},
					ACCOUNT_CONFIG_ID,
					reservations(),
				),
			/SQLITE_BUSY/,
		);
	});
});

describe("back-apply pipeline (matchOrganize -> applyOrganize)", () => {
	const matching = ["msg-1", "msg-2", "msg-3"];
	const corpus = (): OrganizeCandidate[] => [
		...matching.map((id) => reservation(id)),
		candidate("msg-miss", { subject: "Weekly newsletter" }),
	];

	it("applies the label to all N matches in one pass and writes zero Filter rows", async () => {
		const p = reservations({ actionLabelId: "lbl-1" });

		// The preview and the apply share the same matcher — the previewed set is
		// exactly what gets applied.
		const previewed = await matchAccepted(
			corpusDeps(corpus()),
			ACCOUNT_CONFIG_ID,
			p,
		);
		const applied = await matchAccepted(
			corpusDeps(corpus()),
			ACCOUNT_CONFIG_ID,
			p,
		);
		assert.deepEqual(previewed, applied);

		const tracked = trackingClient();
		const result = await applyOrganize(
			{
				client: tracked.client,
				moveService: trackingMoveService().moveService,
			},
			ACCOUNT_CONFIG_ID,
			applied.messageIds,
			p,
		);

		assert.equal(result.applied, matching.length);
		assert.equal(result.failed, 0);
		assert.deepEqual(
			tracked.labeled.map((row) => row.messageId).sort(),
			matching,
		);
		assert.ok(
			tracked.labeled.every((row) => row.labelId === "lbl-1"),
			"every matching message gets the requested label",
		);
		assert.equal(tracked.filterWrites(), 0, "no Filter row is ever created");
	});

	it("moves every match through the wired move service and writes zero Filter rows", async () => {
		const p = reservations({ actionMailboxId: "mbox-target" });

		const { messageIds: matched } = await matchAccepted(
			corpusDeps(corpus()),
			ACCOUNT_CONFIG_ID,
			p,
		);
		const tracked = trackingClient();
		const mover = trackingMoveService();
		const result = await applyOrganize(
			{ client: tracked.client, moveService: mover.moveService },
			ACCOUNT_CONFIG_ID,
			matched,
			p,
		);

		assert.equal(result.applied, matching.length);
		assert.equal(result.failed, 0);
		assert.deepEqual(
			mover.moves.map((m) => m.messageId).sort(),
			matching,
			"every matched message is moved once",
		);
		assert.ok(
			mover.moves.every((m) => m.destinationMailboxId === "mbox-target"),
			"every move targets the requested mailbox",
		);
		assert.equal(
			tracked.labeled.length,
			0,
			"a move-only action applies no label",
		);
		assert.equal(tracked.filterWrites(), 0, "no Filter row is ever created");
	});

	it("applies both a label and a move when both actions are requested", async () => {
		const p = reservations({
			actionLabelId: "lbl-1",
			actionMailboxId: "mbox-target",
		});

		const { messageIds: matched } = await matchAccepted(
			corpusDeps([reservation("msg-1")]),
			ACCOUNT_CONFIG_ID,
			p,
		);
		const tracked = trackingClient();
		const mover = trackingMoveService();
		const result = await applyOrganize(
			{ client: tracked.client, moveService: mover.moveService },
			ACCOUNT_CONFIG_ID,
			matched,
			p,
		);

		assert.equal(result.applied, 1);
		assert.equal(result.failed, 0);
		assert.deepEqual(tracked.labeled, [
			{ messageId: "msg-1", labelId: "lbl-1" },
		]);
		assert.deepEqual(
			mover.moves.map((m) => m.messageId),
			["msg-1"],
		);
	});

	it("is idempotent on redelivery: a re-run re-issues the same move without double-enqueuing", async () => {
		const twice = ["msg-1", "msg-2"];
		const p = reservations({ actionMailboxId: "mbox-target" });

		const { messageIds: matched } = await matchAccepted(
			corpusDeps(twice.map((id) => reservation(id))),
			ACCOUNT_CONFIG_ID,
			p,
		);
		const tracked = trackingClient();
		const mover = trackingMoveService();

		const first = await applyOrganize(
			{ client: tracked.client, moveService: mover.moveService },
			ACCOUNT_CONFIG_ID,
			matched,
			p,
		);
		const second = await applyOrganize(
			{ client: tracked.client, moveService: mover.moveService },
			ACCOUNT_CONFIG_ID,
			matched,
			p,
		);

		assert.equal(first.applied, twice.length);
		assert.equal(second.applied, twice.length);
		assert.equal(
			mover.enqueues(),
			twice.length,
			"the second pass drives the marker forward without a fresh enqueue",
		);
		assert.deepEqual(
			[...mover.destinations().entries()].sort(),
			twice.map((id): [string, string] => [id, "mbox-target"]),
			"each message rests in the requested mailbox exactly once",
		);
	});
});

/**
 * A standing filter acts when a message is first seen and when the user presses
 * "run rules now", and holds no claim afterwards. A later apply is the newer
 * event, so it moves the mail — and because nothing is suppressed, `applied`
 * counts moves that happened rather than moves that were skipped (reader #497).
 */
describe("a user-initiated apply outranks every standing filter (reader #497)", () => {
	it("moves a hand-picked selection a standing filter claims for a different mailbox", async () => {
		const picked = ["msg-1", "msg-2", "msg-3"];
		const p = reservations({ actionMailboxId: "mbox-projects" });
		// The standing rule that filed all three into Archive in the first place —
		// moving them back out is the whole point of the button.
		const standing = filterItem({
			filterId: "filter-github",
			ruleChangedAt: 1_000,
			actionChangedAt: 1_000,
			actionMailboxId: "mbox-archive",
			literalClauses: [{ field: "Subject", value: "reservation" }],
		});

		const { messageIds: matched } = await matchAccepted(
			corpusDeps(picked.map((id) => reservation(id))),
			ACCOUNT_CONFIG_ID,
			p,
		);
		const tracked = trackingClient({
			activeFilters: [standing],
			threadMessages: Object.fromEntries(
				picked.map((id) => [id, { subject: "Dinner reservation" }]),
			),
		});
		const mover = trackingMoveService();
		const result = await applyOrganize(
			{ client: tracked.client, moveService: mover.moveService },
			ACCOUNT_CONFIG_ID,
			matched,
			p,
		);

		assert.deepEqual(
			mover.moves.map((move) => move.messageId).sort(),
			picked,
			"every hand-picked message moves",
		);
		assert.ok(
			mover.moves.every(
				(move) => move.destinationMailboxId === "mbox-projects",
			),
			"the destination is the one the user picked, not the standing filter's",
		);
		assert.equal(
			result.applied,
			mover.moves.length,
			"the reported count equals the moves that actually happened",
		);
		assert.equal(result.failed, 0);
		assert.equal(
			tracked.filterReads(),
			0,
			"the account's standing filters are not consulted at all",
		);
	});
});

describe("matchOrganize with ListId and FromDomain clauses", () => {
	it("matches a ListId clause exactly off the thread rows", async () => {
		const deps = corpusDeps([
			candidate("msg-1", { listId: "weekly.news.example.com" }),
			candidate("msg-2", { listId: "news.example.com" }),
			candidate("msg-3", {}),
		]);

		const { messageIds } = await matchAccepted(deps, ACCOUNT_CONFIG_ID, {
			...predicate(),
			literalClauses: [{ field: "ListId", value: "weekly.news.example.com" }],
		});

		assert.deepEqual(messageIds, ["msg-1"]);
	});

	it("matches a FromDomain clause public-suffix aware off the thread rows", async () => {
		const deps = corpusDeps([
			candidate("msg-1", { from: "notifications@github.com" }),
			candidate("msg-2", { from: "ci@sub.github.com" }),
			candidate("msg-3", { from: "attacker@github.com.evil.example" }),
		]);

		const { messageIds } = await matchAccepted(deps, ACCOUNT_CONFIG_ID, {
			...predicate(),
			literalClauses: [{ field: "FromDomain", value: "github.com" }],
		});

		assert.deepEqual(messageIds, ["msg-1", "msg-2"]);
	});

	it("applies a ListId predicate to exactly the previewed set (preview == apply)", async () => {
		const deps = corpusDeps([
			candidate("msg-1", { listId: "weekly.news.example.com" }),
			candidate("msg-2", { listId: "weekly.news.example.com" }),
			candidate("msg-3", { listId: "other.example.com" }),
		]);
		const p = predicate({
			actionLabelId: "lbl-list",
			literalClauses: [{ field: "ListId", value: "weekly.news.example.com" }],
		});

		const previewed = await matchAccepted(deps, ACCOUNT_CONFIG_ID, p);
		const applied = await matchAccepted(deps, ACCOUNT_CONFIG_ID, p);
		assert.deepEqual(previewed, applied);
		assert.deepEqual(previewed.messageIds, ["msg-1", "msg-2"]);

		const tracked = trackingClient();
		const result = await applyOrganize(
			{
				client: tracked.client,
				moveService: trackingMoveService().moveService,
			},
			ACCOUNT_CONFIG_ID,
			applied.messageIds,
			p,
		);

		assert.equal(result.applied, 2);
		assert.equal(result.failed, 0);
		assert.deepEqual(tracked.labeled.map((row) => row.messageId).sort(), [
			"msg-1",
			"msg-2",
		]);
	});
});

/**
 * The corpus read a real deployment gets: the store evaluates the terms and
 * the caller pages the MATCHES. Modelled here rather than stubbed with a fixed
 * array so a matcher that reads only the newest page cannot pass.
 */
const storeBackedDeps = (
	rows: readonly OrganizeCandidate[],
): OrganizeMatchDeps & { pagesRead: () => number } => {
	let pagesRead = 0;
	const termMatches = (
		term: { field: string; contains: string },
		row: OrganizeCandidate,
	): boolean => {
		const needle = term.contains.toLowerCase();
		if (term.field === "subject") {
			return row.message.subject.toLowerCase().includes(needle);
		}
		if (term.field === "listId") {
			return row.message.listId.toLowerCase().includes(needle);
		}
		return `${row.message.fromName} ${row.message.from}`
			.toLowerCase()
			.includes(needle);
	};
	return {
		listAccountFilterMessages: async (_accountConfigId, query) => {
			pagesRead += 1;
			const narrowed = rows.filter((row) =>
				query.terms.length === 0
					? true
					: query.operator === "or"
						? query.terms.some((term) => termMatches(term, row))
						: query.terms.every((term) => termMatches(term, row)),
			);
			const offset = query.continuationToken
				? Number(query.continuationToken)
				: 0;
			const items = narrowed.slice(offset, offset + query.limit);
			const next = offset + items.length;
			return {
				items,
				continuationToken: next < narrowed.length ? String(next) : undefined,
			};
		},
		pagesRead: () => pagesRead,
	};
};

describe("literal matching bounds the result, not the corpus (reader #459)", () => {
	const quietSender = candidate("quiet-sender", {
		from: "noreply@bank.example",
		fromName: "Statements",
		subject: "Your March statement",
	});
	const newerNoise = Array.from({ length: ORGANIZE_MATCH_LIMIT + 1 }, (_, i) =>
		candidate(`noise-${i}`, {
			from: "digest@other.example",
			fromName: "Digest",
			subject: `Daily digest ${i}`,
		}),
	);

	it("matches a domain rule against mail older than a whole page of newer misses", async () => {
		const deps = storeBackedDeps([...newerNoise, quietSender]);

		const { messageIds } = await matchAccepted(
			deps,
			ACCOUNT_CONFIG_ID,
			predicate({
				literalClauses: [{ field: "FromDomain", value: "bank.example" }],
			}),
		);

		assert.deepEqual(messageIds, ["quiet-sender"]);
	});

	it("reads one narrowed page rather than paging the whole mailbox", async () => {
		const deps = storeBackedDeps([...newerNoise, quietSender]);

		await matchAccepted(
			deps,
			ACCOUNT_CONFIG_ID,
			predicate({
				literalClauses: [{ field: "From", value: "noreply@bank.example" }],
			}),
		);

		assert.equal(deps.pagesRead(), 1);
	});

	it("still refines what the store returned: a term is a narrowing, not the verdict", async () => {
		const deps = storeBackedDeps([
			candidate("spoofed", { from: "billing@bank.example.evil.test" }),
			quietSender,
		]);

		const { messageIds } = await matchAccepted(
			deps,
			ACCOUNT_CONFIG_ID,
			predicate({
				literalClauses: [{ field: "FromDomain", value: "bank.example" }],
			}),
		);

		assert.deepEqual(messageIds, ["quiet-sender"]);
	});

	it("caps the matches at the limit when more of the corpus matches", async () => {
		const matching = Array.from({ length: ORGANIZE_MATCH_LIMIT * 2 }, (_, i) =>
			candidate(`hit-${i}`, { from: "noreply@bank.example" }),
		);
		const deps = storeBackedDeps(matching);

		const { messageIds } = await matchAccepted(
			deps,
			ACCOUNT_CONFIG_ID,
			predicate({
				literalClauses: [{ field: "FromDomain", value: "bank.example" }],
			}),
		);

		assert.equal(messageIds.length, ORGANIZE_MATCH_LIMIT);
	});

	it("never queries for clauses nothing can satisfy", async () => {
		const deps = storeBackedDeps([quietSender]);

		const { messageIds } = await matchAccepted(
			deps,
			ACCOUNT_CONFIG_ID,
			predicate({
				literalClauses: [{ field: "From", value: "   " }],
			}),
		);

		assert.deepEqual(messageIds, []);
		assert.equal(deps.pagesRead(), 0);
	});

	it("counts one match for mail filed in two folders", async () => {
		const deps = storeBackedDeps([
			candidate("filed-twice", { from: "noreply@bank.example" }),
			candidate("filed-twice", { from: "noreply@bank.example" }),
		]);

		const { messageIds } = await matchAccepted(
			deps,
			ACCOUNT_CONFIG_ID,
			predicate({
				literalClauses: [{ field: "FromDomain", value: "bank.example" }],
			}),
		);

		assert.deepEqual(messageIds, ["filed-twice"]);
	});
});
