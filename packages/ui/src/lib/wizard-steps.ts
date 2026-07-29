/**
 * The selection wizard's vocabulary and derivation (#477).
 *
 * The step list is a function of the verb and the answers so far, and the step
 * is held by id rather than by number: an answer that shortens the list can then
 * never leave a number pointing past its end. Both branching answers — the match
 * door and the scope — are given on a step every variant of the list holds in the
 * same position, and each can only add or drop a step after it.
 */

import {
	clauseFieldLabel,
	type FilterRule,
	type MatchOperator,
	matchJoinWord,
	matchModeHint,
	matchModeLabel,
	type PreviewCount,
	previewSettledReason,
	type RuleClause,
	type RuleMatchMode,
	type RuleScope,
	type RuleWiden,
	ruleBlockedCopy,
	unreadableBodyClauses,
	widenChipLabel,
} from "../components/filter-rule.js";

/** What the action does. Delete, Move and Organize carry a glyph on the bar; Junk and Mark read live in the overflow menu. */
export type Verb = "delete" | "move" | "junk" | "markRead" | "organize";

export interface VerbCopy {
	label: string;
	/** While it runs — "Moving". */
	present: string;
	/** Once it has — "Moved". */
	past: string;
	/** Warrants the danger variant on the commit control. */
	destructive: boolean;
}

const VERB_COPY: Record<Verb, VerbCopy> = {
	delete: {
		label: "Delete",
		present: "Deleting",
		past: "Deleted",
		destructive: true,
	},
	move: { label: "Move", present: "Moving", past: "Moved", destructive: false },
	junk: {
		label: "Junk",
		present: "Marking as junk",
		past: "Marked as junk",
		destructive: true,
	},
	markRead: {
		label: "Mark read",
		present: "Marking read",
		past: "Marked read",
		destructive: false,
	},
	organize: {
		label: "Organize",
		present: "Organizing",
		past: "Organized",
		destructive: false,
	},
};

export const verbCopy = (verb: Verb): VerbCopy => VERB_COPY[verb];

/**
 * What the action is applied to. The two widened doors are the shipped
 * `RuleMatchMode` values; `selected` is not one of them and is not a match mode
 * at all — it is the bounded list of ticked message ids, which no predicate
 * stands in for.
 */
export type MatchMode = "selected" | RuleMatchMode;

export type StepId =
	| "match"
	| "properties"
	| "folder"
	| "rule"
	| "name"
	| "review"
	| "run";

const STEP_LABEL: Record<StepId, string> = {
	match: "Apply to",
	properties: "Properties",
	folder: "Folder",
	rule: "Rule",
	name: "Name",
	review: "Review",
	run: "Run",
};

export const stepLabel = (step: StepId): string => STEP_LABEL[step];

export interface WizardAnswers {
	verb: Verb;
	mode: MatchMode;
	scope?: RuleScope;
	/**
	 * Entered by converting a search rather than by ticking rows. There is
	 * nothing ticked to anchor on and the query has already answered what this
	 * applies to, so the match step is dropped rather than opened past.
	 */
	fromSearch?: boolean;
}

/**
 * The steps this flow walks, in order. The property door earns an editor step,
 * Move and Organize both earn a destination step — a rule that moves nothing is
 * a rule with nothing to commit — Organize earns a scope step after it, and a
 * scope that persists earns a naming step.
 */
export const stepsFor = ({
	verb,
	mode,
	scope,
	fromSearch,
}: WizardAnswers): StepId[] => {
	const opening: StepId[] = fromSearch
		? ["properties"]
		: mode === "properties"
			? ["match", "properties"]
			: ["match"];
	if (verb === "move") return [...opening, "folder", "review", "run"];
	if (verb === "organize") {
		if (scope === "standing" || scope === "until") {
			return [...opening, "folder", "rule", "name", "review", "run"];
		}
		return [...opening, "folder", "rule", "review", "run"];
	}
	return [...opening, "review", "run"];
};

/**
 * Where a held step id sits in the list on screen. A step the current answers
 * dropped resolves to the opening step rather than to a number past the end.
 */
export const stepIndex = (steps: readonly StepId[], step: StepId): number =>
	Math.max(0, steps.indexOf(step));

/**
 * Whether Back leaves the wizard rather than moving a step. The opening step has
 * nothing behind it, and the Run step's action has already happened — walking
 * back to Review from there would offer to commit it a second time.
 */
export const backExits = (steps: readonly StepId[], step: StepId): boolean =>
	stepIndex(steps, step) === 0 || step === "run";

/**
 * The rule as the wizard has it so far. The same fields `FilterRule` carries,
 * with the two the wizard has not asked for yet left absent — a rule is only a
 * whole rule from the review step on.
 */
export interface WizardDraft {
	clauses: readonly RuleClause[];
	matchOperator: MatchOperator;
	/**
	 * The semantic widen the similar door rides on. Present makes the widen the
	 * matcher, and it reads message bodies — so a body-text clause the user left
	 * behind on the property door is readable here, and must not be held against
	 * a one-time apply.
	 */
	widen?: RuleWiden;
	/** The Move destination. Absent until the folder step is answered. */
	moveMailboxId?: string;
	/** Absent until the scope step is answered. */
	scope?: RuleScope;
	/** ISO 8601 civil date (`YYYY-MM-DD`) the `until` scope stops on. */
	until?: string;
	name?: string;
}

const asRule = (draft: WizardDraft, scope: RuleScope): FilterRule => ({
	clauses: [...draft.clauses],
	matchOperator: draft.matchOperator,
	widen: draft.widen,
	moveMailboxId: draft.moveMailboxId,
	scope,
	until: draft.until,
	name: draft.name,
});

/**
 * The draft's body-text clauses that nothing on its current match path can read.
 * Empty whenever the semantic widen is carrying the match, because the widen
 * reads bodies; empty for a rule with no body-text clause at all.
 */
export const unreadableDraftClauses = (draft: WizardDraft): RuleClause[] =>
	unreadableBodyClauses(asRule(draft, draft.scope ?? "once"));

/**
 * The count the wizard is committing against. `uncounted` is a stated answer,
 * not a missing one: neither widened door carries a count until it has run
 * (#477 3.3), so there is nothing to wait for and nothing to display.
 */
export type MatchCount = PreviewCount | { status: "uncounted" };

/**
 * Why a selection spanning accounts cannot become a rule (#477 5.5). A filter
 * belongs to the account it was created for, so the two persisting scopes have
 * nothing to attach to; the one-off scope acts on the messages themselves and is
 * unaffected.
 */
export const crossAccountRuleReason =
	"A rule only works within one account — clear the selection, or pick messages from a single account.";

/** A clause chip that was added but never filled in. The rule editor has no equivalent — it holds its draft until the value is typed. */
const INCOMPLETE_CLAUSE = "Fill in every property, or take the empty one off.";
const NO_DESTINATION = "Pick a destination first.";
const NO_SCOPE = "Choose one of the three first.";

/**
 * What the step is still missing, or `undefined` when it is answered. Nothing
 * disables: Continue stays pressable and dimmed, and pressing it says this.
 *
 * Every gap the rule editor also has says it in the rule editor's words
 * (`ruleBlockedCopy`), so the two surfaces cannot drift. Only the three gaps
 * that exist because the wizard asks one question per screen are its own.
 *
 * A `HasWords` clause is only readable by the index-time matcher, so a one-time
 * apply cannot serve it. That is stated on the scope step rather than by
 * refusing the clause on the step that offered it.
 */
export const stepBlockedReason = (
	step: StepId,
	draft: WizardDraft,
	count: MatchCount,
): string | undefined => {
	if (step === "properties") {
		if (draft.clauses.length === 0) return ruleBlockedCopy.noMatch;
		if (draft.clauses.some((clause) => clause.value.trim() === "")) {
			return INCOMPLETE_CLAUSE;
		}
		return undefined;
	}
	if (step === "folder") {
		return draft.moveMailboxId ? undefined : NO_DESTINATION;
	}
	if (step === "rule") {
		if (!draft.scope) return NO_SCOPE;
		if (draft.scope === "once" && unreadableDraftClauses(draft).length > 0) {
			return ruleBlockedCopy.bodyTextOnce;
		}
		if (draft.scope === "until" && !draft.until?.trim()) {
			return ruleBlockedCopy.noUntilDate;
		}
		return undefined;
	}
	if (step === "name" && !draft.name?.trim()) return ruleBlockedCopy.unnamed;
	if (step === "review") {
		return count.status === "uncounted"
			? undefined
			: previewSettledReason(count);
	}
	return undefined;
};

/**
 * Where the run step lands. Three of these never reach a job: a filter saved
 * with nothing to back-apply, a back-apply whose request never started, and a
 * create that failed outright.
 */
export type RunState =
	| "saving"
	| "backApplyRunning"
	| "backApplyComplete"
	| "backApplyFailed"
	| "backApplyStartFailed"
	| "filterSaved"
	| "commitFailed";

/**
 * Why a sample has no rows (#452). An empty sample with no explanation reads as
 * "this rule matches nothing", which is the wrong conclusion whenever the mail
 * simply has not been indexed yet.
 */
export type SampleEmptyReason = "noMatch" | "notIndexed";

const SAMPLE_EMPTY_COPY: Record<SampleEmptyReason, string> = {
	noMatch:
		"Nothing matches this yet. Widen a property, or match on a different one.",
	notIndexed:
		"This mail isn't indexed yet, so nothing can be counted. The rule still matches once indexing catches up.",
};

export const sampleEmptyCopy = (reason: SampleEmptyReason): string =>
	SAMPLE_EMPTY_COPY[reason];

export interface RunOutcome {
	state: RunState;
	verb: Verb;
	scope?: RuleScope;
	/** How many messages the match reached. */
	matched: number;
	/** How many of them the action has covered so far. */
	applied: number;
	/** How many the mail server rejected. */
	failed: number;
}

export interface RunCopy {
	/** The header title. Names the verb while the job runs, then reads as an ending. */
	screenTitle: string;
	title: string;
	detail: string;
	tone: "progress" | "success" | "warning" | "danger";
	/** The pass over existing mail is under way or finished, so it has a bar. */
	showProgress: boolean;
	/** Leaves the wizard. Never absent — there is always a way out. */
	dismissLabel: string;
	/** Offers the part that did not happen again. Absent when nothing is outstanding. */
	retryLabel?: string;
	/** Heads the list of messages the mail server rejected. */
	failureListLabel: string;
}

/**
 * What the run screen says. A saved rule and a one-off run end differently: the
 * rule keeps working on mail that has not arrived yet, and its pass over the
 * mail already in the mailbox can fail on its own without taking the rule down
 * with it.
 */
export const runCopy = ({
	state,
	verb,
	scope,
	matched,
	applied,
	failed,
}: RunOutcome): RunCopy => {
	const { label, present, past } = verbCopy(verb);
	const done = past.toLowerCase();
	const standing = scope === "standing" || scope === "until";
	const inFlight = state === "saving" || state === "backApplyRunning";
	const shared = {
		// A create that failed did not finish, so the header does not say it did.
		screenTitle: inFlight || state === "commitFailed" ? label : "Done",
		showProgress:
			state === "backApplyRunning" ||
			state === "backApplyComplete" ||
			state === "backApplyFailed",
		failureListLabel: `Not ${done}`,
	};

	if (state === "saving") {
		return {
			...shared,
			title: standing ? "Saving rule…" : "Applying…",
			detail: "Nothing has been changed yet.",
			tone: "progress",
			dismissLabel: "Close",
		};
	}
	if (state === "backApplyRunning") {
		return {
			...shared,
			title: standing
				? "Rule saved. Moving the mail already in your mailbox…"
				: `${present} ${matched} messages…`,
			detail: "This keeps running if you close the wizard.",
			tone: "progress",
			dismissLabel: "Close",
		};
	}
	if (state === "backApplyComplete") {
		return {
			...shared,
			title: standing ? "Rule saved and applied" : `${past} ${applied}`,
			detail: standing
				? `${applied} of ${matched} already in your mailbox ${done}. New mail follows the rule as it arrives.`
				: `Every message the match reached was ${done}.`,
			tone: "success",
			dismissLabel: "Done",
		};
	}
	if (state === "backApplyFailed") {
		return {
			...shared,
			title: standing
				? "Rule saved — some mail stayed put"
				: `Not everything was ${done}`,
			detail: `${applied} of ${matched} ${done} · ${failed} rejected by the mail server.${
				standing
					? " The rule itself is saved and keeps working on new mail."
					: ""
			}`,
			tone: "warning",
			dismissLabel: "Close",
			retryLabel: `Retry ${failed}`,
		};
	}
	if (state === "backApplyStartFailed") {
		return {
			...shared,
			title: "Rule saved",
			detail:
				"New mail follows it automatically. The pass over the mail already in your mailbox never started.",
			tone: "warning",
			dismissLabel: "Not now",
			retryLabel: "Run it over existing mail",
		};
	}
	if (state === "filterSaved") {
		return {
			...shared,
			title: "Filter saved",
			detail:
				"There is no mail in your mailbox to apply it to yet. New mail follows it as it arrives. You can see it, and when it expires, under Settings › Filters.",
			tone: "success",
			dismissLabel: "Done",
		};
	}
	return {
		...shared,
		title: standing
			? "Couldn't save the rule"
			: `Couldn't start ${label.toLowerCase()}`,
		detail: "Nothing has changed.",
		tone: "danger",
		dismissLabel: "Not now",
		retryLabel: "Try again",
	};
};

/** One clause as words — `From "noreply@booking.com"`. */
export const clauseWords = (clause: RuleClause): string =>
	`${clauseFieldLabel(clause.field)} "${clause.value}"`;

/** Every clause as one sentence, joined by the word the operator reads as. */
export const clauseSentence = (
	clauses: readonly RuleClause[],
	operator: MatchOperator,
): string => clauses.map(clauseWords).join(` ${matchJoinWord(operator)} `);

/** What a match door is called, with the ticked count the widen anchors on. */
export const matchDoorLabel = (
	mode: MatchMode,
	selectedCount: number,
): string => {
	if (mode === "selected") return `These ${selectedCount} messages`;
	if (mode === "similar") return widenChipLabel({ anchorCount: selectedCount });
	return matchModeLabel("properties");
};

/** One line saying what a match door actually does, so the choice is never a guess. */
export const matchDoorHint = (mode: MatchMode): string =>
	mode === "selected"
		? "Only the messages ticked in the list."
		: matchModeHint(mode);

export interface MatchDescription {
	mode: MatchMode;
	selectedCount: number;
	clauses: readonly RuleClause[];
	matchOperator: MatchOperator;
}

/** The match on the review screen's labelled list — short enough for one row. */
export const matchSummary = ({
	mode,
	selectedCount,
	clauses,
	matchOperator,
}: MatchDescription): string =>
	mode === "properties"
		? clauseSentence(clauses, matchOperator)
		: matchDoorLabel(mode, selectedCount);

/** The match inside the review screen's one sentence, in the object position. */
export const matchPhrase = ({
	mode,
	selectedCount,
	clauses,
	matchOperator,
}: MatchDescription): string => {
	if (mode === "selected") return `${selectedCount} messages`;
	if (mode === "similar") {
		return `mail ${widenChipLabel({ anchorCount: selectedCount }).toLowerCase()}`;
	}
	if (clauses.length === 0) return "every message";
	return `every message where ${clauseSentence(clauses, matchOperator)}`;
};
