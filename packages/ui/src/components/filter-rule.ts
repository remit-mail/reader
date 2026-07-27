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
 * What the rule matches on (RFC 038 D2/D3). `similar` rides the semantic widen
 * off the messages the rule was started from; `properties` uses literal clauses
 * only — sender, subject, list — and needs no vector pipeline at all. A surface
 * that offers both opens on `similar` wherever the deployment can serve it.
 */
export type RuleMatchMode = "similar" | "properties";

const matchModeLabels: Record<RuleMatchMode, string> = {
	similar: "Anything similar",
	properties: "Its properties",
};

export function matchModeLabel(mode: RuleMatchMode): string {
	return matchModeLabels[mode];
}

const matchModeHints: Record<RuleMatchMode, string> = {
	similar: "Reads the messages you picked and finds more that read like them.",
	properties:
		"Matches on what the messages say about themselves — sender, subject, list. No reading involved.",
};

/** One line saying what a match mode actually does, so the choice is never a
 *  guess (ux.md). */
export function matchModeHint(mode: RuleMatchMode): string {
	return matchModeHints[mode];
}

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
	/**
	 * The apply-label action's target (issue #26) — additive, so it can be set
	 * alongside `moveMailboxId`. Absent applies no label.
	 */
	labelId?: string;
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

export interface LabelOption {
	id: string;
	name: string;
	color: string;
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

const clauseFieldHints: Partial<Record<ClauseField, string>> = {
	ListId:
		"The mailing list's List-Id header, matched exactly. New mail is matched as it arrives — mail delivered before this was set up may not carry it yet.",
	FromDomain:
		"The sender's registrable domain — matches anyone at it, subdomains included (a look-alike like example.com.evil.test never matches).",
};

/**
 * A one-line explanation of what a field matches, for the fields whose semantics
 * aren't self-evident from the label. `From`, `Subject`, and `HasWords` read
 * plainly and carry none. Never leave a control unexplained where it could
 * surprise (ux.md).
 */
export function clauseFieldHint(field: ClauseField): string | undefined {
	return clauseFieldHints[field];
}

/**
 * Whether a clause field matches on message body text, which only the live
 * index-time filter and the semantic widen can read.
 *
 * The vector-free matcher serves `From`/`Subject` from the core thread rows and
 * carries no faithful body, so it rejects a body-text clause outright rather
 * than narrowing the match silently (`assertNoBodyContentClause`,
 * backend/service/organize.ts). A rule with no active widen therefore cannot be
 * counted or applied one-time with such a clause in it — it can only be a
 * standing rule, where the index-time matcher reads the whole body.
 */
export function matchesBodyText(field: ClauseField): boolean {
	return field === "HasWords";
}

/** Whether the rule's semantic widen is present and evaluable. */
export function hasActiveWiden(rule: FilterRule): boolean {
	return rule.widen !== undefined && !rule.widen.inactive;
}

/**
 * The rule's body-text clauses that nothing on its current match path can read
 * — a `HasWords` chip with no active widen behind it. Empty for every rule the
 * literal matcher can evaluate.
 */
export function unreadableBodyClauses(rule: FilterRule): RuleClause[] {
	if (hasActiveWiden(rule)) return [];
	return rule.clauses.filter((clause) => matchesBodyText(clause.field));
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
 * needs at least one live way to match, at least one action — move and/or
 * label, either satisfies this (issue #26) — and, for the two persisted
 * scopes, a name and, for `until`, a date. It also needs a settled preview:
 * the rule is committable only when the count on screen is the count that
 * will be applied. That makes RFC 038's previewed-set-equals-applied-set
 * contract structural — a consumer cannot save a rule whose match count is
 * still moving. Never disable a control without saying why (ux.md).
 */
export function commitBlockedReason(
	rule: FilterRule,
	preview: PreviewCount,
): string | undefined {
	const hasMatch =
		rule.clauses.length > 0 ||
		(rule.widen !== undefined && !rule.widen.inactive);
	if (!hasMatch) return "Add a clause so the rule has something to match.";
	// A one-time apply runs the vector-free matcher, which cannot read message
	// bodies. Saved as a rule the same clause works, so say that rather than
	// refusing the clause outright.
	if (rule.scope === "once" && unreadableBodyClauses(rule).length > 0)
		return "Applying once can't read message bodies. Save this as a rule instead, or drop the “has the words” clause.";
	if (!rule.moveMailboxId && !rule.labelId)
		return "Pick a folder to move into, or a label to apply.";
	if (
		(rule.scope === "standing" || rule.scope === "until") &&
		(rule.name ?? "").trim() === ""
	)
		return "Name this rule so you can find it later.";
	if (rule.scope === "until" && !rule.until)
		return "Pick the date this rule should stop on.";
	if (preview.status === "loading")
		return "Counting matches — save once the count settles.";
	if (preview.status === "ready" && preview.stale)
		return "Recounting matches — save once the count settles.";
	return undefined;
}

export const demoFolders: FolderOption[] = [
	{ id: "mbx-inbox", label: "Inbox" },
	{ id: "mbx-archive", label: "Archive" },
	{ id: "mbx-receipts", label: "Receipts" },
	{ id: "mbx-travel", label: "Travel" },
	{ id: "mbx-junk", label: "Junk" },
];

export const demoLabels: LabelOption[] = [
	{ id: "lbl-receipts", name: "Receipts", color: "Blue" },
	{ id: "lbl-travel", name: "Travel", color: "Green" },
	{ id: "lbl-urgent", name: "Urgent", color: "Red" },
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

/**
 * The properties mode's opening rule when the selection's senders differ: the
 * part their subjects share, prefilled as an ordinary editable `Subject` chip.
 */
export const demoSubjectPrefillRule: FilterRule = {
	clauses: [
		{ id: "c1", field: "Subject", value: "Your receipt from", derived: true },
	],
	matchOperator: "any",
	moveMailboxId: "mbx-receipts",
	scope: "once",
	name: "",
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
