import type { FilterItem } from "@remit/data-ports";
import { FilterClauseField, FilterMatchOperator } from "@remit/domain-enums";

type FilterClause = FilterItem["literalClauses"][number];

/**
 * The `"None"` sentinel a filter's action fields carry when that action is
 * absent (RFC 034 Decision 3.1) — `actionLabelId`/`actionMailboxId` are never
 * empty/optional strings, so a missing action is this exact value, never `""`.
 */
export const NO_ACTION = "None";

/**
 * Default cosine cut-off for a semantic-anchor match (RFC 031 "the semantic
 * anchor evaluates as a kNN threshold against the new message's embedding").
 * Tunable per pipeline via {@link FilterConfig.similarityThreshold}.
 */
export const DEFAULT_SEMANTIC_MATCH_THRESHOLD = 0.75;

/**
 * Bound on the text embedded for a semantic match — the same 512-char budget
 * `buildTextPreview` applies to chunk vectors and `FilterAnchor.anchorSourceText`
 * persists, so the candidate side of the comparison is derived on the same
 * footing as the anchor side.
 */
const MATCH_TEXT_LIMIT = 512;

/**
 * The message fields a filter evaluates against — the literal-clause targets
 * (from / subject / body) plus the text embedded for a semantic anchor. A plain
 * value object so the matcher stays independent of the `ParsedMail` shape and is
 * trivially constructed in a test.
 */
export interface FilterMessage {
	from: string;
	fromName: string;
	subject: string;
	text: string;
}

const includesFold = (haystack: string, needle: string): boolean =>
	haystack.toLowerCase().includes(needle.toLowerCase());

/**
 * Whether one literal clause matches the message. From matches against the
 * sender address and display name; Subject against the subject; HasWords against
 * subject or body. An empty clause value never matches.
 */
export const clauseMatches = (
	clause: FilterClause,
	msg: FilterMessage,
): boolean => {
	const value = clause.value.trim();
	if (value === "") return false;
	switch (clause.field) {
		case FilterClauseField.From:
			return includesFold(msg.from, value) || includesFold(msg.fromName, value);
		case FilterClauseField.Subject:
			return includesFold(msg.subject, value);
		case FilterClauseField.HasWords:
			return includesFold(msg.subject, value) || includesFold(msg.text, value);
		default:
			return false;
	}
};

/**
 * Whether the literal clauses match under their combine operator. Empty clauses
 * carry no literal constraint and pass vacuously — a purely-semantic filter (no
 * clauses, only an anchor) is gated by its anchor alone, not by this.
 */
export const literalClausesMatch = (
	clauses: readonly FilterClause[],
	operator: FilterItem["matchOperator"],
	msg: FilterMessage,
): boolean => {
	if (clauses.length === 0) return true;
	return operator === FilterMatchOperator.Or
		? clauses.some((clause) => clauseMatches(clause, msg))
		: clauses.every((clause) => clauseMatches(clause, msg));
};

/**
 * Cosine similarity of two equal-length vectors. Throws on a dimension mismatch
 * rather than silently scoring incomparable vectors — a mismatch means a stale
 * anchor embedded under a different model (`anchorEmbeddingId`), which is a
 * migration concern, not a match to guess at.
 */
export const cosineSimilarity = (
	a: readonly number[],
	b: readonly number[],
): number => {
	if (a.length !== b.length) {
		throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
	}
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

/**
 * The move a message ends in when several filters matched: the most-recently
 * *changed* filter wins (RFC 034 Decision 3.2), tie-broken on `filterId` for the
 * unreachable identical-timestamp case. `ruleChangedAt` — not `updatedAt` — is
 * the signal, so a cosmetic rename never flips an exclusive move.
 */
export const selectMoveWinner = (
	candidates: readonly FilterItem[],
): FilterItem | undefined => {
	let winner: FilterItem | undefined;
	for (const candidate of candidates) {
		if (!winner) {
			winner = candidate;
			continue;
		}
		if (candidate.ruleChangedAt > winner.ruleChangedAt) {
			winner = candidate;
			continue;
		}
		if (
			candidate.ruleChangedAt === winner.ruleChangedAt &&
			candidate.filterId > winner.filterId
		) {
			winner = candidate;
		}
	}
	return winner;
};

/**
 * The candidate text embedded once for a semantic match — subject then body,
 * bounded to the anchor's `anchorSourceText` budget so both sides of the cosine
 * comparison are derived from comparable inputs.
 */
export const buildMatchText = (msg: FilterMessage): string =>
	`${msg.subject}\n${msg.text}`.slice(0, MATCH_TEXT_LIMIT);
