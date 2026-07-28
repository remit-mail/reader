import type {
	CreateFilterInput,
	FilterItem,
	IFilterRepository,
	ResultList,
	UpdateFilterInput,
} from "@remit/data-ports";
import {
	FilterMatchOperator,
	FilterScope,
	FilterState,
} from "@remit/domain-enums";
import { and, asc, eq, gt, or } from "drizzle-orm";
import type { Db } from "../db.js";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { decodeToken, resultList } from "../pagination.js";
import { filterTable } from "../schema.js";

type DB = Db<Record<string, unknown>>;

const RULE_ASSERTION_FIELDS = [
	"hasAnchor",
	"matchOperator",
	"literalClauses",
	"actionLabelId",
	"actionMailboxId",
	"scope",
	"expiresAt",
] as const satisfies readonly (keyof UpdateFilterInput)[];

/**
 * The subset of {@link RULE_ASSERTION_FIELDS} that changes what a filter
 * matches or what it does — excluding `scope`/`expiresAt`, which only change
 * how long the filter runs. Backs `actionChangedAt` (reader #384), the
 * narrower signal `selectMoveWinner` reads for exclusive-move precedence.
 */
const ACTION_ASSERTION_FIELDS = [
	"hasAnchor",
	"matchOperator",
	"literalClauses",
	"actionLabelId",
	"actionMailboxId",
] as const satisfies readonly (keyof UpdateFilterInput)[];

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * Whether `input` touches the predicate, the action, the scope, or the
 * expiry (RFC 034 Decision 3.2, reader #266) — a plain rename (`name` only)
 * must not bump `ruleChangedAt`. Scope and expiry count as a rule assertion
 * alongside the predicate/action: re-asserting how long a filter runs is the
 * same kind of "the user just told Remit something new" moment, and it is
 * what lets a lapsed filter's back-application be offered again.
 *
 * This is deliberately broader than {@link changesActionAssertion} — it backs
 * `ruleChangedAt`, the settings UI's back-apply-offer signal, not exclusive-
 * move precedence (reader #384).
 */
const changesRuleAssertion = (input: UpdateFilterInput): boolean =>
	RULE_ASSERTION_FIELDS.some((field) => field in input);

/**
 * Whether `input` touches the predicate or the action — never `scope` or
 * `expiresAt` (reader #384). Backs `actionChangedAt`, which `selectMoveWinner`
 * reads to decide an exclusive-move conflict: extending a filter's expiry or
 * flipping Standing/Temporary changes its lifecycle, not where a matching
 * message goes, so it must not promote the filter to move-winner.
 */
const changesActionAssertion = (input: UpdateFilterInput): boolean =>
	ACTION_ASSERTION_FIELDS.some((field) => field in input);

function rowToFilter(row: typeof filterTable.$inferSelect): FilterItem {
	return {
		filterId: row.filterId,
		accountConfigId: row.accountConfigId,
		name: row.name,
		scope: row.scope,
		expiresAt: row.expiresAt ?? undefined,
		ttl: row.ttl ?? undefined,
		state: row.state,
		hasAnchor: row.hasAnchor,
		ruleChangedAt: row.ruleChangedAt,
		actionChangedAt: row.actionChangedAt,
		matchOperator: row.matchOperator,
		literalClauses: row.literalClauses as FilterItem["literalClauses"],
		actionLabelId: row.actionLabelId,
		actionMailboxId: row.actionMailboxId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class FilterRepo implements IFilterRepository {
	constructor(private db: DB) {}

	/**
	 * `ruleChangedAt` and `actionChangedAt` are both set to the same instant as
	 * creation: a new filter's predicate/action (and its scope/expiry) are, by
	 * definition, freshly asserted (RFC 034 Decision 3.2).
	 */
	async create(input: CreateFilterInput): Promise<FilterItem> {
		const now = Date.now();
		const createdRuleChangedAt = nowSeconds();
		const [row] = await this.db
			.insert(filterTable)
			.values({
				filterId: randomId(),
				accountConfigId: input.accountConfigId,
				name: input.name,
				scope: input.scope,
				expiresAt: input.expiresAt ?? null,
				ttl: input.ttl ?? null,
				state: input.state ?? FilterState.Active,
				hasAnchor: input.hasAnchor ?? false,
				ruleChangedAt: createdRuleChangedAt,
				actionChangedAt: createdRuleChangedAt,
				matchOperator: input.matchOperator ?? FilterMatchOperator.And,
				literalClauses: input.literalClauses ?? [],
				actionLabelId: input.actionLabelId ?? "None",
				actionMailboxId: input.actionMailboxId ?? "None",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return rowToFilter(row);
	}

	async get(accountConfigId: string, filterId: string): Promise<FilterItem> {
		const [row] = await this.db
			.select()
			.from(filterTable)
			.where(
				and(
					eq(filterTable.accountConfigId, accountConfigId),
					eq(filterTable.filterId, filterId),
				),
			);
		if (!row) {
			throw new NotFoundError(`Filter not found: ${filterId}`);
		}
		return rowToFilter(row);
	}

	/**
	 * `ruleChangedAt` advances when `input` touches the predicate, the action,
	 * the scope, or the expiry — never on a cosmetic `name` edit (RFC 034
	 * Decision 3.2, reader #266). `actionChangedAt` advances only for the
	 * narrower predicate/action subset (reader #384): a scope/expiresAt-only
	 * edit bumps `ruleChangedAt` (so a lapsed filter's back-application can be
	 * offered again) without touching `actionChangedAt`, so it cannot flip
	 * `selectMoveWinner`'s exclusive-move precedence.
	 *
	 * A patch moving `scope` to `Standing` clears `expiresAt`/`ttl` at the SQL
	 * layer regardless of what `input` carries for them: the caller (the
	 * backend handler's `resolveFilterScopeExpiry`) already resolved `input` to
	 * `undefined` for both, but `undefined` in a `.set()` value means "leave
	 * column alone," not "clear it" — only an explicit `null` does that. This
	 * keeps the Filter model's invariant that a `Standing` filter never carries
	 * `expiresAt`/`ttl` (RFC 034 Decision 1.4) true at the storage layer itself,
	 * not just by caller convention.
	 */
	async update(
		accountConfigId: string,
		filterId: string,
		input: UpdateFilterInput,
	): Promise<FilterItem> {
		const changedAt = nowSeconds();
		const patch = {
			...input,
			...(changesRuleAssertion(input) ? { ruleChangedAt: changedAt } : {}),
			...(changesActionAssertion(input) ? { actionChangedAt: changedAt } : {}),
		};
		const updates: Partial<typeof filterTable.$inferInsert> = {
			...patch,
			updatedAt: Date.now(),
		};
		if (patch.scope === FilterScope.Standing) {
			updates.expiresAt = null;
			updates.ttl = null;
		}
		const [row] = await this.db
			.update(filterTable)
			.set(updates)
			.where(
				and(
					eq(filterTable.accountConfigId, accountConfigId),
					eq(filterTable.filterId, filterId),
				),
			)
			.returning();
		if (!row) {
			throw new NotFoundError(`Filter not found: ${filterId}`);
		}
		return rowToFilter(row);
	}

	async delete(accountConfigId: string, filterId: string): Promise<void> {
		await this.db
			.delete(filterTable)
			.where(
				and(
					eq(filterTable.accountConfigId, accountConfigId),
					eq(filterTable.filterId, filterId),
				),
			);
	}

	async listByAccountConfig(accountConfigId: string): Promise<FilterItem[]> {
		const rows = await this.db
			.select()
			.from(filterTable)
			.where(eq(filterTable.accountConfigId, accountConfigId));
		return rows.map(rowToFilter);
	}

	/**
	 * A single signed page of an account config's filters (RFC 034), mirroring
	 * `MailboxRepo.listByAccount`: a `(createdAt, filterId)` keyset cursor that
	 * round-trips through `continuationToken`.
	 */
	async listPageByAccountConfig(
		accountConfigId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<FilterItem>> {
		const limit = options?.limit ?? 100;
		const cursor = options?.continuationToken
			? decodeToken(options.continuationToken)
			: undefined;
		const after = cursor
			? {
					createdAt: cursor.createdAt as number,
					filterId: cursor.filterId as string,
				}
			: undefined;

		const rows = await this.db
			.select()
			.from(filterTable)
			.where(
				and(
					eq(filterTable.accountConfigId, accountConfigId),
					after
						? or(
								gt(filterTable.createdAt, after.createdAt),
								and(
									eq(filterTable.createdAt, after.createdAt),
									gt(filterTable.filterId, after.filterId),
								),
							)
						: undefined,
				),
			)
			.orderBy(asc(filterTable.createdAt), asc(filterTable.filterId))
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit).map(rowToFilter);
		const lastItem = items[items.length - 1];
		return resultList(
			items,
			limit,
			hasMore && lastItem
				? { createdAt: lastItem.createdAt, filterId: lastItem.filterId }
				: undefined,
		);
	}

	/**
	 * Lists filters via `byAccountAndState` (RFC 034 Decision 1.2) — the
	 * index-time worker's "what do I evaluate for this account" query.
	 */
	async listByAccountAndState(
		accountConfigId: string,
		state: FilterItem["state"],
	): Promise<FilterItem[]> {
		const rows = await this.db
			.select()
			.from(filterTable)
			.where(
				and(
					eq(filterTable.accountConfigId, accountConfigId),
					eq(filterTable.state, state),
				),
			);
		return rows.map(rowToFilter);
	}

	/**
	 * Patches a Temporary filter's `state` to `Expired` when read past its
	 * `expiresAt` (RFC 034 Decision 1.2). `expiresAt`/`now` are compared
	 * directly — `state` is only ever a lazily-refreshed cache of that
	 * comparison. A no-op for a Standing filter (no `expiresAt`) or one already
	 * Expired.
	 *
	 * There is no TTL reaper here, so an Expired Temporary row is never deleted by
	 * a background sweep the way DynamoDB reaps it via the `ttl` attribute. That
	 * is correct by design: RFC 034 Decision 1.1 makes match-time correctness
	 * depend on the `expiresAt`/`now` comparison, never on the row's existence —
	 * the reaper is housekeeping, not a correctness mechanism.
	 */
	async refreshExpiry(item: FilterItem): Promise<FilterItem> {
		if (item.scope !== "Temporary" || !item.expiresAt) return item;
		if (item.state === FilterState.Expired) return item;
		if (new Date(item.expiresAt).getTime() > Date.now()) return item;

		const [row] = await this.db
			.update(filterTable)
			.set({ state: FilterState.Expired, updatedAt: Date.now() })
			.where(
				and(
					eq(filterTable.accountConfigId, item.accountConfigId),
					eq(filterTable.filterId, item.filterId),
				),
			)
			.returning();
		return row ? rowToFilter(row) : item;
	}
}
