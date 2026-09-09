import {
	FILTER_NO_ACTION,
	type FilterItem,
	type ThreadMessageFieldTerm,
} from "@remit/data-ports";
import { FilterClauseField, FilterMatchOperator } from "@remit/domain-enums";
import { getDomain } from "tldts";
import { normalizeListId } from "./list-id.js";

type FilterClause = FilterItem["literalClauses"][number];

/**
 * The `"None"` sentinel a filter's action fields carry when that action is
 * absent (RFC 034 Decision 3.1) — `actionLabelId`/`actionMailboxId` are never
 * empty/optional strings, so a missing action is this exact value, never `""`.
 */
export const NO_ACTION = FILTER_NO_ACTION;

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
	/** Normalized `List-Id` header value (see `normalizeListId`); `""` when absent. */
	listId: string;
}

const includesFold = (haystack: string, needle: string): boolean =>
	haystack.toLowerCase().includes(needle.toLowerCase());

const hostOf = (address: string): string => {
	const at = address.lastIndexOf("@");
	return at >= 0 ? address.slice(at + 1) : address;
};

/**
 * The registrable, public-suffix-aware domain of an email address or host, or
 * `null` when none resolves. `getDomain` folds case and applies the ICANN
 * suffix list, so `github.com.evil.example` yields `evil.example`, never
 * `github.com` — a `FromDomain` clause cannot be spoofed by a crafted subdomain.
 */
const registrableDomain = (addressOrHost: string): string | null =>
	getDomain(hostOf(addressOrHost.trim()));

/**
 * Whether one literal clause matches the message. From matches against the
 * sender address and display name; Subject against the subject; HasWords against
 * subject or body; ListId against the exact normalized `List-Id`; FromDomain
 * against the sender's registrable domain. An empty clause value never matches.
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
		case FilterClauseField.ListId: {
			const target = normalizeListId(value);
			return target !== "" && normalizeListId(msg.listId) === target;
		}
		case FilterClauseField.FromDomain: {
			const target = registrableDomain(value);
			if (target === null) return false;
			return registrableDomain(msg.from) === target;
		}
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
 * What a store can be asked for on behalf of one clause: a column term, or the
 * two answers a term cannot express — a clause nothing can satisfy, and a
 * clause selecting on something no ThreadMessage column carries.
 */
type ClauseNarrowing =
	| { kind: "Term"; term: ThreadMessageFieldTerm }
	| { kind: "NeverMatches" }
	| { kind: "Unnarrowable" };

const clauseNarrowing = (clause: FilterClause): ClauseNarrowing => {
	const value = clause.value.trim();
	if (value === "") return { kind: "NeverMatches" };
	switch (clause.field) {
		case FilterClauseField.From:
			return { kind: "Term", term: { field: "sender", contains: value } };
		case FilterClauseField.Subject:
			return { kind: "Term", term: { field: "subject", contains: value } };
		case FilterClauseField.ListId: {
			const target = normalizeListId(value);
			if (target === "") return { kind: "NeverMatches" };
			return { kind: "Term", term: { field: "listId", contains: target } };
		}
		case FilterClauseField.FromDomain: {
			const target = registrableDomain(value);
			if (target === null) return { kind: "NeverMatches" };
			return { kind: "Term", term: { field: "sender", contains: target } };
		}
		default:
			return { kind: "Unnarrowable" };
	}
};

/**
 * The terms to query with, and how to combine them. Empty terms narrow nothing
 * — the caller reads the whole corpus and refines it.
 */
export interface LiteralClauseNarrowing {
	terms: ThreadMessageFieldTerm[];
	operator: "and" | "or";
}

/**
 * The store-side half of {@link literalClausesMatch}: the column terms a query
 * can evaluate on behalf of these clauses, or `null` when they can match
 * nothing at all and there is no query worth running.
 *
 * A term is deliberately WIDER than the clause it stands for — a `FromDomain`
 * clause narrows to the registrable domain appearing anywhere in the sender,
 * so `github.com.evil.example` still comes back — and a `HasWords` clause
 * cannot be narrowed at all, since no row column carries the body. The rows a
 * term selects are candidates; `literalClausesMatch` still decides. Pushing the
 * terms down is what makes the caller's bound a bound on RESULTS: filtering a
 * date-ordered page instead answers "matches among the newest N messages"
 * (#459).
 */
export const literalClauseTerms = (
	clauses: readonly FilterClause[],
	operator: FilterItem["matchOperator"],
): LiteralClauseNarrowing | null => {
	const combine = operator === FilterMatchOperator.Or ? "or" : "and";
	if (clauses.length === 0) return { terms: [], operator: combine };
	const narrowings = clauses.map(clauseNarrowing);
	const terms = narrowings.flatMap((narrowing) =>
		narrowing.kind === "Term" ? [narrowing.term] : [],
	);
	if (combine === "and") {
		if (narrowings.some((narrowing) => narrowing.kind === "NeverMatches")) {
			return null;
		}
		return { terms, operator: "and" };
	}
	if (narrowings.every((narrowing) => narrowing.kind === "NeverMatches")) {
		return null;
	}
	if (narrowings.some((narrowing) => narrowing.kind === "Unnarrowable")) {
		return { terms: [], operator: "or" };
	}
	return { terms, operator: "or" };
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
 * The move a message ends in when several filters matched: the filter whose
 * predicate or action was most recently *changed* wins (RFC 034 Decision 3.2),
 * tie-broken on `filterId` for the unreachable identical-timestamp case.
 * `actionChangedAt` — not `ruleChangedAt` — is the signal: `ruleChangedAt` also
 * bumps on a scope/expiry-only edit (reader #266), which changes a filter's
 * lifecycle, not what it matches or does, and must not reorder exclusive-move
 * precedence (reader #384). Nor is it `updatedAt`, so a cosmetic rename never
 * flips an exclusive move either.
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
		if (candidate.actionChangedAt > winner.actionChangedAt) {
			winner = candidate;
			continue;
		}
		if (
			candidate.actionChangedAt === winner.actionChangedAt &&
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
