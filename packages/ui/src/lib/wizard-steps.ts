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
	type MatchOperator,
	matchesBodyText,
	matchJoinWord,
	matchModeHint,
	matchModeLabel,
	type RuleClause,
	type RuleMatchMode,
	type RuleScope,
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
 * Move earns a destination step, Organize earns a scope step, and a scope that
 * persists earns a naming step.
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
			return [...opening, "rule", "name", "review", "run"];
		}
		return [...opening, "rule", "review", "run"];
	}
	return [...opening, "review", "run"];
};

/**
 * Where a held step id sits in the list on screen. A step the current answers
 * dropped resolves to the opening step rather than to a number past the end.
 */
export const stepIndex = (steps: readonly StepId[], step: StepId): number =>
	Math.max(0, steps.indexOf(step));

export interface StepAnswers {
	clauses: readonly RuleClause[];
	folder?: string;
	scope?: RuleScope;
	/** ISO 8601 civil date (`YYYY-MM-DD`) the `until` scope stops on. */
	until?: string;
	ruleName?: string;
}

/**
 * What the step is still missing, or `undefined` when it is answered. Nothing
 * disables: Continue stays pressable and dimmed, and pressing it says this.
 *
 * A `HasWords` clause is only readable by the index-time matcher, so a one-time
 * apply cannot serve it. That is stated here, where the scope is chosen, rather
 * than by refusing the clause on the step that offered it.
 */
export const stepBlockedReason = (
	step: StepId,
	{ clauses, folder, scope, until, ruleName }: StepAnswers,
): string | undefined => {
	if (step === "properties") {
		if (clauses.length === 0) return "Add a property to match on.";
		if (clauses.some((clause) => clause.value.trim() === "")) {
			return "Fill in every property, or take the empty one off.";
		}
		return undefined;
	}
	if (step === "folder") {
		return folder ? undefined : "Pick a destination first.";
	}
	if (step === "rule") {
		if (!scope) return "Choose one of the three first.";
		if (scope === "once" && clauses.some((c) => matchesBodyText(c.field))) {
			return "Applying once can't read message bodies. Keep doing this instead, or drop the “has the words” property.";
		}
		if (scope === "until" && !until?.trim()) {
			return "Pick the date this rule should stop on.";
		}
		return undefined;
	}
	if (step === "name" && !ruleName?.trim()) {
		return "Give the rule a name so you can find it later.";
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
	const shared = {
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

export const folderParent = (path: string): string => {
	const cut = path.lastIndexOf("/");
	return cut === -1 ? "" : path.slice(0, cut);
};

export const folderLeaf = (path: string): string =>
	path.slice(path.lastIndexOf("/") + 1);

export const folderDepth = (path: string): number => path.split("/").length - 1;

/**
 * Puts every child straight after its parent so the list reads as a tree, while
 * leaving the order of unrelated folders alone. A folder whose parent is missing
 * from the list renders as a root rather than disappearing.
 */
export const orderFolders = (paths: readonly string[]): string[] => {
	const emitted = new Set<string>();
	const out: string[] = [];

	const emit = (path: string) => {
		if (emitted.has(path)) return;
		emitted.add(path);
		out.push(path);
		for (const candidate of paths) {
			if (folderParent(candidate) === path) emit(candidate);
		}
	};

	for (const path of paths) {
		const parent = folderParent(path);
		if (parent && paths.includes(parent)) continue;
		emit(path);
	}
	return out;
};

/** The sender carrying most of the ticked rows, or `undefined` when there are none. */
export const dominantSender = (
	senders: readonly string[],
): string | undefined => {
	const counts = new Map<string, number>();
	for (const sender of senders) {
		counts.set(sender, (counts.get(sender) ?? 0) + 1);
	}
	let best: string | undefined;
	let bestCount = 0;
	for (const [sender, count] of counts) {
		if (count <= bestCount) continue;
		best = sender;
		bestCount = count;
	}
	return best;
};

export interface RuleNameParts {
	/** What a property match is anchored on — the leading clause value. */
	match?: string;
	/** The sender carrying most of the ticked rows. */
	sender?: string;
	/** The destination, once one has been chosen. */
	folder?: string;
}

/** The name the wizard can infer from what it already knows. Always editable. */
export const suggestRuleName = ({
	match,
	sender,
	folder,
}: RuleNameParts): string => {
	const subject = match ?? sender;
	if (!subject) return folder ? `Mail to ${folder}` : "";
	if (folder) return `${subject} → ${folder}`;
	if (match) return `Mail matching ${match}`;
	return `Mail from ${subject}`;
};
