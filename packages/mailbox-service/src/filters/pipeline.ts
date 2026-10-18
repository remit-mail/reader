import { inspect } from "node:util";
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

/**
 * Evaluates a synced message against the account's active filters and resolves
 * the actions to apply (RFC 034). Reads only — listing filters and refreshing
 * lazy expiry; the caller applies the
 * resulting {@link FilterDecision}.
 *
 * `evaluate` isolates every failure in this read/decision phase from body sync,
 * matching the placement-resolution precedent (#1246): a schema-drifted query
 * must never fail the surrounding message store, since the body is
 * already durable by the time this runs. The apply of the decision — label
 * writes and the move enqueue — is the caller's responsibility and is *not*
 * swallowed there, so a genuine DDB/SQS write failure still propagates and
 * requeues the message.
 */
export class FilterPipeline {
	constructor(
		private readonly config: FilterConfig,
		private readonly log: FilterLogger,
	) {}

	async evaluate(
		accountConfigId: string,
		accountId: string,
		messageId: string,
		msg: FilterMessage,
	): Promise<FilterDecision> {
		return this.match(accountConfigId, accountId, msg).catch(
			(error: unknown) => {
				this.log.error?.(
					{
						alert: "body_sync_filter_match_failed",
						messageId,
						accountConfigId,
						errorName: (error as { name?: string })?.name,
						error: inspect(error),
					},
					"Filter matching failed; body already stored, continuing without filter actions (best-effort, non-fatal)",
				);
				return EMPTY_DECISION;
			},
		);
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

	private async match(
		accountConfigId: string,
		accountId: string,
		msg: FilterMessage,
	): Promise<FilterDecision> {
		const active = await this.config.filterService.listByAccountAndState(
			accountConfigId,
			FilterState.Active,
		);
		if (active.length === 0) return EMPTY_DECISION;

		const matched: FilterItem[] = [];
		for (const filter of active) {
			// Lazy expiry (RFC 034 Decision 1.2): reading a Temporary filter past
			// its expiresAt patches it to Expired on this read and drops it from
			// evaluation, independent of whether the TTL delete has run.
			const usable = await this.config.filterService.refreshExpiry(filter);
			if (usable.state !== FilterState.Active) continue;
			if (!(await this.appliesTo(accountConfigId, accountId, usable))) continue;
			if (filterMatches(usable, msg)) matched.push(usable);
		}
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
}

const filterMatches = (filter: FilterItem, msg: FilterMessage): boolean =>
	literalClausesMatch(filter.literalClauses, filter.matchOperator, msg);
