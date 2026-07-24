/**
 * The filter rule as the user edits it (RFC 038).
 *
 * A rule is literal clauses combined under one match operator, an optional
 * semantic widen, an action, and a scope. This module is the vocabulary the
 * chip editor renders — a design model driven from fixtures, not the API.
 * Naming tracks the RFC: rule, clause, widen, scope.
 */

/**
 * The clause fields (RFC 038 D2). `From`, `Subject`, `HasWords` ship now;
 * `ListId` and `FromDomain` arrive with the vocabulary ticket. Every variant
 * renders here so that ticket slots its fields in without touching the chip.
 */
export type ClauseField =
	| "From"
	| "Subject"
	| "HasWords"
	| "ListId"
	| "FromDomain";

export interface RuleClause {
	id: string;
	field: ClauseField;
	value: string;
	/**
	 * A `From` clause the server derived from the selection because the widen
	 * could not run (#251). It is an ordinary visible, editable chip — this flag
	 * only annotates where it came from.
	 */
	derived?: boolean;
}

/** How the clauses combine. Maps to the API's `And` / `Or`. */
export type MatchOperator = "all" | "any";

/**
 * When the rule stops (RFC 038 D1). `once` is a one-time action, `standing`
 * persists, `until` expires on a picked date.
 */
export type RuleScope = "once" | "standing" | "until";

/**
 * The semantic widen (RFC 038 D3): one chip backed by the anchor mechanism.
 * Absent from a rule means the chip is not present; a deployment that cannot
 * serve the widen never offers it at all.
 */
export interface RuleWiden {
	/** Anchors the similarity rides on — "similar to these N". */
	anchorCount: number;
	/**
	 * The rule carries an anchor this deployment cannot evaluate — created
	 * elsewhere, capability since lost (RFC 038 D4). The chip lists as inactive,
	 * the rule matches by its literal clauses only, and nothing claims otherwise.
	 */
	inactive?: boolean;
}

export interface FilterRule {
	clauses: RuleClause[];
	matchOperator: MatchOperator;
	widen?: RuleWiden;
	/** The move-to-folder action's destination. Absent leaves mail in place. */
	moveMailboxId?: string;
	scope: RuleScope;
	/** ISO 8601 civil date (`YYYY-MM-DD`) for the `until` scope. */
	until?: string;
	/** Names a standing or timed rule so it can be found in Settings › Filters. */
	name?: string;
}

export interface FolderOption {
	id: string;
	label: string;
}

/**
 * The live match count (RFC 038 D1). `stale` marks a count the editor already
 * moved past — a clause changed after it was counted, so the number on screen
 * is the previous rule's until the next preview lands.
 */
export type PreviewCount =
	| { status: "loading" }
	| { status: "ready"; count: number; stale?: boolean }
	| { status: "error"; reason: string };

const clauseFieldLabels: Record<ClauseField, string> = {
	From: "From",
	Subject: "Subject",
	HasWords: "Has the words",
	ListId: "List",
	FromDomain: "Domain",
};

export function clauseFieldLabel(field: ClauseField): string {
	return clauseFieldLabels[field];
}

/** The fields a new clause can be added as, in menu order. */
export const clauseFieldOrder: ClauseField[] = [
	"From",
	"Subject",
	"HasWords",
	"ListId",
	"FromDomain",
];

export function widenChipLabel(widen: RuleWiden): string {
	return `Similar to these ${widen.anchorCount}`;
}

const matchOperatorLabels: Record<MatchOperator, string> = {
	all: "Match all",
	any: "Match any",
};

export function matchOperatorLabel(operator: MatchOperator): string {
	return matchOperatorLabels[operator];
}

/**
 * The join word between chips — "all" reads as "and", "any" as "or". Rendered
 * between clauses so the operator is legible in the rule itself, not only the
 * toggle.
 */
export function matchJoinWord(operator: MatchOperator): string {
	return operator === "all" ? "and" : "or";
}

export function previewCountSummary(preview: PreviewCount): string {
	if (preview.status === "loading") return "Counting matches…";
	if (preview.status === "error") return preview.reason;
	if (preview.count === 0) return "No mail matches yet";
	const noun = preview.count === 1 ? "message" : "messages";
	const base = `${preview.count} ${noun} match`;
	return preview.stale ? `${base} — recounting` : base;
}

const scopeLabels: Record<RuleScope, string> = {
	once: "Just once",
	standing: "Keep doing this",
	until: "Until a date",
};

export function scopeLabel(scope: RuleScope): string {
	return scopeLabels[scope];
}

export function commitLabel(scope: RuleScope): string {
	if (scope === "once") return "Apply now";
	if (scope === "standing") return "Save rule";
	return "Save until then";
}

/**
 * Why the rule cannot be saved yet, or `undefined` when it is ready. A rule
 * needs at least one way to match, a folder to move into (the only wired
 * action), and — for the two persisted scopes — a name and, for `until`, a
 * date. Never disable a control without saying why (ux.md).
 */
export function commitBlockedReason(rule: FilterRule): string | undefined {
	const hasMatch = rule.clauses.length > 0 || rule.widen !== undefined;
	if (!hasMatch) return "Add a clause so the rule has something to match.";
	if (!rule.moveMailboxId)
		return "Pick a folder to move matches into — labeling isn't available yet.";
	if (
		(rule.scope === "standing" || rule.scope === "until") &&
		(rule.name ?? "").trim() === ""
	)
		return "Name this rule so you can find it later.";
	if (rule.scope === "until" && !rule.until)
		return "Pick the date this rule should stop on.";
	return undefined;
}

export const demoFolders: FolderOption[] = [
	{ id: "mbx-inbox", label: "Inbox" },
	{ id: "mbx-archive", label: "Archive" },
	{ id: "mbx-receipts", label: "Receipts" },
	{ id: "mbx-travel", label: "Travel" },
	{ id: "mbx-junk", label: "Junk" },
];

export const demoRule: FilterRule = {
	clauses: [
		{ id: "c1", field: "From", value: "notifications@github.com" },
		{ id: "c2", field: "Subject", value: "pull request" },
	],
	matchOperator: "all",
	widen: { anchorCount: 2 },
	moveMailboxId: "mbx-archive",
	scope: "standing",
	name: "GitHub notifications",
};

export const demoVocabularyRule: FilterRule = {
	clauses: [
		{ id: "c1", field: "ListId", value: "python-dev.python.org" },
		{ id: "c2", field: "FromDomain", value: "python.org" },
		{ id: "c3", field: "HasWords", value: "nightly build" },
	],
	matchOperator: "any",
	moveMailboxId: "mbx-archive",
	scope: "standing",
	name: "Python lists",
};

export const demoSenderFallbackRule: FilterRule = {
	clauses: [
		{ id: "c1", field: "From", value: "receipts@stripe.com", derived: true },
		{ id: "c2", field: "From", value: "receipts@lyft.com", derived: true },
	],
	matchOperator: "any",
	moveMailboxId: "mbx-receipts",
	scope: "standing",
	name: "Receipts",
};
