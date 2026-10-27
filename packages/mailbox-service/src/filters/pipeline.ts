import type {
	FilterItem,
	IFilterRepository,
	IMailboxRepository,
	IMessageLabelRepository,
} from "@remit/data-ports";
import { FilterDisabledReason, FilterState } from "@remit/domain-enums";
import type { PlacementMoveService } from "../placement-move.js";
import {
	type FilterMessage,
	literalClausesMatch,
	NO_ACTION,
	selectMoveWinner,
} from "./match.js";

export interface FilterLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	debug?(obj: Record<string, unknown>, msg: string): void;
	warn?(obj: Record<string, unknown>, msg: string): void;
	error?(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Dependencies for the index-time filter pass (RFC 034). Optional on
 * {@link BodySyncService} the same way {@link PlacementConfig} is — a deployment
 * without it simply runs no filter matching.
 */
export interface FilterConfig {
	filterService: IFilterRepository;
	messageLabelService: IMessageLabelRepository;
	/** Names the account a filter's folder belongs to. */
	mailboxService: Pick<IMailboxRepository, "resolveAccountId">;
	placementMoveService: PlacementMoveService;
}

/**
 * What the matched filters resolve to for one message: every matching filter's
 * label (additive — RFC 034 Decision 3.1), and at most one move (exclusive — the
 * most-recently-changed matching filter, Decision 3.2).
 */
export interface FilterDecision {
	labels: Array<{ labelId: string; filterId: string }>;
	move?: { destinationMailboxId: string; filterId: string };
}

const EMPTY_DECISION: FilterDecision = { labels: [] };

export type PreparedFilters = readonly FilterItem[];

/**
 * Evaluates a synced message against the account's active filters and resolves
 * the actions to apply (RFC 034). Reads only — listing filters and refreshing
 * lazy expiry; the caller applies the
 * resulting {@link FilterDecision}.
 *
 * `prepare` narrows the account's active filters to the ones that can act on
 * one account's mail; `decide` matches a message against them without a read.
 * The apply of the decision — label writes and the move enqueue — is the
 * caller's responsibility.
 */
export class FilterPipeline {
	constructor(
		private readonly config: FilterConfig,
		private readonly log: FilterLogger,
	) {}

	decide(prepared: PreparedFilters, msg: FilterMessage): FilterDecision {
		const matched = prepared.filter((filter) => filterMatches(filter, msg));
		if (matched.length === 0) return EMPTY_DECISION;

		const labels: FilterDecision["labels"] = [];
		const seenLabels = new Set<string>();
		for (const filter of matched) {
			if (filter.actionLabelId === NO_ACTION) continue;
			if (seenLabels.has(filter.actionLabelId)) continue;
			seenLabels.add(filter.actionLabelId);
			labels.push({ labelId: filter.actionLabelId, filterId: filter.filterId });
		}

		const winner = selectMoveWinner(
			matched.filter((filter) => filter.actionMailboxId !== NO_ACTION),
		);

		return {
			labels,
			...(winner
				? {
						move: {
							destinationMailboxId: winner.actionMailboxId,
							filterId: winner.filterId,
						},
					}
				: {}),
		};
	}

	/**
	 * A filter sits on the account config and sees every account's mail, but its
	 * folder is one account's: mail of another account is not this filter's to
	 * act on, exactly as if it had not matched. A folder no account holds any
	 * more turns the filter off, with the reason the filter list shows.
	 */
	private async appliesTo(
		accountConfigId: string,
		accountId: string,
		filter: FilterItem,
	): Promise<boolean> {
		if (filter.actionMailboxId === NO_ACTION) return true;
		const owner = await this.config.mailboxService.resolveAccountId(
			filter.actionMailboxId,
		);
		if (owner !== null) return owner === accountId;
		await this.config.filterService.update(accountConfigId, filter.filterId, {
			state: FilterState.Disabled,
			disabledReason: FilterDisabledReason.FolderMissing,
		});
		this.log.warn?.(
			{ filterId: filter.filterId, accountConfigId },
			"Filter turned off: the folder it moves mail into no longer exists",
		);
		return false;
	}

	async prepare(
		accountConfigId: string,
		accountId: string,
		active: readonly FilterItem[],
	): Promise<PreparedFilters> {
		const filters: FilterItem[] = [];
		for (const filter of active) {
			// Lazy expiry (RFC 034 Decision 1.2): reading a Temporary filter past
			// its expiresAt patches it to Expired on this read and drops it from
			// evaluation, independent of whether the TTL delete has run.
			const usable = await this.config.filterService.refreshExpiry(filter);
			if (usable.state !== FilterState.Active) continue;
			if (!(await this.appliesTo(accountConfigId, accountId, usable))) continue;
			filters.push(usable);
		}
		return filters;
	}
}

const filterMatches = (filter: FilterItem, msg: FilterMessage): boolean =>
	literalClausesMatch(filter.literalClauses, filter.matchOperator, msg);
