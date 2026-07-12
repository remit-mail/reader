import { inspect } from "node:util";
import type {
	FilterItem,
	IFilterAnchorRepository,
	IFilterRepository,
	IMessageLabelRepository,
} from "@remit/data-ports";
import { FilterState } from "@remit/domain-enums";
import type { PlacementMoveService } from "../placement-move.js";
import {
	buildMatchText,
	cosineSimilarity,
	DEFAULT_SEMANTIC_MATCH_THRESHOLD,
	type FilterMessage,
	literalClausesMatch,
	NO_ACTION,
	selectMoveWinner,
} from "./match.js";

/**
 * Turns the candidate message's text into a single message-level vector to
 * compare against a filter's persisted `anchorEmbedding`. The anchor side is
 * never embedded here — it is read from `FilterAnchor` as a fixed fact (RFC 034
 * Decision 2.1/2.3); only the incoming message is embedded, and only once per
 * message, and only when a semantic filter is actually in play.
 */
export interface MessageEmbedder {
	embed(text: string): Promise<number[]>;
}

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
 *
 * `embedder` is optional on purpose: semantic-anchor filters cannot be evaluated
 * without it, so they are skipped when it is absent, but literal-clause filters
 * always run. The `FilterAnchor` write path (a separate ticket) and a wired
 * embedder are what light the semantic half up.
 */
export interface FilterConfig {
	filterService: IFilterRepository;
	filterAnchorService: IFilterAnchorRepository;
	messageLabelService: IMessageLabelRepository;
	placementMoveService: PlacementMoveService;
	embedder?: MessageEmbedder;
	similarityThreshold?: number;
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
 * the actions to apply (RFC 034). Reads only — listing filters, refreshing lazy
 * expiry, reading anchors, and embedding the message; the caller applies the
 * resulting {@link FilterDecision}.
 *
 * `evaluate` isolates every failure in this read/decision phase from body sync,
 * matching the placement-resolution precedent (#1246): a schema-drifted query or
 * a bad anchor must never fail the surrounding message store, since the body is
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
		messageId: string,
		msg: FilterMessage,
	): Promise<FilterDecision> {
		return this.match(accountConfigId, msg).catch((error: unknown) => {
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
		});
	}

	private async match(
		accountConfigId: string,
		msg: FilterMessage,
	): Promise<FilterDecision> {
		const active = await this.config.filterService.listByAccountAndState(
			accountConfigId,
			FilterState.Active,
		);
		if (active.length === 0) return EMPTY_DECISION;

		// The message is embedded lazily and at most once: `undefined` means not
		// yet computed, `null` means computed-but-unavailable (no embedder). The
		// embed only ever fires when a filter survives the literal pre-filter and
		// carries an anchor — a purely-literal account never pays for it.
		let messageEmbedding: number[] | null | undefined;
		const embed = async (): Promise<number[] | null> => {
			if (messageEmbedding !== undefined) return messageEmbedding;
			const embedder = this.config.embedder;
			if (!embedder) {
				messageEmbedding = null;
				return null;
			}
			messageEmbedding = await embedder.embed(buildMatchText(msg));
			return messageEmbedding;
		};

		const matched: FilterItem[] = [];
		for (const filter of active) {
			// Lazy expiry (RFC 034 Decision 1.2): reading a Temporary filter past
			// its expiresAt patches it to Expired on this read and drops it from
			// evaluation, independent of whether the TTL delete has run.
			const usable = await this.config.filterService.refreshExpiry(filter);
			if (usable.state !== FilterState.Active) continue;
			// A bad or stale anchor vector (a dimension mismatch under a changed
			// embedding model) throws from cosineSimilarity. Isolate it to this
			// filter: it is skipped and loudly logged, and every other filter on
			// the message still evaluates and applies. This sits inside the
			// evaluate-level catch — a whole-phase failure still degrades to no
			// filter actions — but stops one poisoned anchor from doing so.
			const isMatch = await this.filterMatches(
				accountConfigId,
				usable,
				msg,
				embed,
			).catch((error: unknown) => {
				this.log.error?.(
					{
						alert: "filter_anchor_match_failed",
						filterId: usable.filterId,
						accountConfigId,
						errorName: (error as { name?: string })?.name,
						error: inspect(error),
					},
					"Filter anchor comparison failed; skipping this filter, other filters still evaluate (bad/stale anchor vector, non-fatal)",
				);
				return "skip" as const;
			});
			if (isMatch === "skip") continue;
			if (isMatch) matched.push(usable);
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

	private async filterMatches(
		accountConfigId: string,
		filter: FilterItem,
		msg: FilterMessage,
		embed: () => Promise<number[] | null>,
	): Promise<boolean> {
		if (
			!literalClausesMatch(filter.literalClauses, filter.matchOperator, msg)
		) {
			return false;
		}

		if (!filter.hasAnchor) {
			// A filter with neither clauses nor an anchor has no predicate and
			// matches nothing; a literal-only filter matched iff it had clauses.
			return filter.literalClauses.length > 0;
		}

		// One deterministic point read per semantic candidate that survived the
		// literal pre-filter — never a scan, never the anchor message itself
		// (RFC 034 Decision 2.3).
		const anchor = await this.config.filterAnchorService.get(
			accountConfigId,
			filter.filterId,
		);
		if (!anchor) {
			this.log.warn?.(
				{ filterId: filter.filterId, accountConfigId },
				"Filter marked hasAnchor but no FilterAnchor row found; skipping semantic match",
			);
			return false;
		}

		const vector = await embed();
		if (!vector) {
			this.log.debug?.(
				{ filterId: filter.filterId },
				"No embedder configured; skipping semantic filter",
			);
			return false;
		}

		const threshold =
			this.config.similarityThreshold ?? DEFAULT_SEMANTIC_MATCH_THRESHOLD;
		return cosineSimilarity(vector, anchor.anchorEmbedding) >= threshold;
	}
}
