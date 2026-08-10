import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	type ClauseDraft,
	type ClauseEditState,
	crossAccountDestinationReason,
	crossAccountRuleReason,
	derivePropertyClauses,
	deriveSenderClauses,
	dominantSender,
	type FolderTreeNode,
	type MatchCount,
	type MatchDoor,
	type MatchMode,
	type RuleClause,
	type RunState,
	type SearchConversion,
	SelectionWizard,
	type StepId,
	searchConversionNotice,
	senderLabel,
	stepBlockedReason,
	stepIndex,
	stepsFor,
	suggestRuleName,
	type Verb,
	type WizardDraft,
	type WizardMessage,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	useFolderAppointments,
	useJunkMailbox,
} from "@/hooks/useArchiveMailbox";
import { useClauseSuggestions } from "@/hooks/useClauseSuggestions";
import { useCreateMailbox } from "@/hooks/useCreateMailbox";
import {
	type EscalatedAction,
	type EscalationSearchQuery,
	useEscalatedActions,
} from "@/hooks/useEscalatedActions";
import { useCreateFilter } from "@/hooks/useFilters";
import { useFolderLabelTranslator } from "@/hooks/useFolderLabelTranslator";
import { useMatchSample, useSearchMatchSample } from "@/hooks/useMatchSample";
import { useOrganizeJob } from "@/hooks/useOrganizeJob";
import { useOrganizeWiden } from "@/hooks/useOrganizeWiden";
import { useRulePreview } from "@/hooks/useRulePreview";
import { useSelectedSubjects } from "@/hooks/useSelectedSubjects";
import type { BulkActionProgress, BulkRunOutcome } from "@/lib/bulk-actions";
import { NO_JUNK_FOLDER_REASON } from "@/lib/junk-destination";
import { useListHeaderChrome } from "@/lib/list-header-chrome";
import { useMailContext } from "@/lib/mail-context";
import { buildMoveOptions, folderDelimiter } from "@/lib/move-options";
import {
	buildWizardDraft,
	canBackApplyDraft,
	type OrganizeDraft,
	type OrganizeScope,
	organizeScopeFor,
} from "@/lib/organize/organize-model";
import {
	normalizeClauseValue,
	SUPPORTED_CLAUSE_FIELDS,
} from "@/lib/organize/rule-model";
import { searchRuleAccountId } from "@/lib/organize/search-to-rule";
import type { OrganizeMatchPredicate } from "@/lib/organize/sender-fallback";
import { useWizardEntryValue, useWizardStep } from "@/lib/wizard-history";
import { organizeRunState } from "./organize-run-state";

const EMPTY_DRAFT: WizardDraft = { clauses: [], matchOperator: "any" };

/** A ticked row, as the wizard's samples and its clause prefill read it. */
export interface WizardSelectionMessage extends WizardMessage {
	/** Sender address — the widen's literal fallback and the prefill match on it. */
	email: string;
}

interface SelectionWizardSessionProps extends SelectionWizardHostProps {
	/** The step the URL holds. The session is mounted only while there is one. */
	step: StepId;
	goToStep: (step: StepId) => void;
	goBack: () => void;
	closeWizard: (steps: readonly StepId[], step: StepId) => void;
	/**
	 * The wizard was entered by converting a search rather than by ticking rows
	 * (#477 1.8). The conversion seeds the clauses on the properties step and the
	 * notice above them, and nothing else: every step after that is the one a
	 * selection from the inbox walks (#477 3.4). Absent for the selection bar's
	 * entry.
	 */
	searchConversion?: SearchConversion;
}

/**
 * The selection the list escalated to a predicate — every message matching the
 * query it is showing, rather than the rows on screen (#508). The wizard walks
 * it exactly as it walks a ticked selection: the same screens, the same review
 * before anything is sent. What differs is that the match has no member list,
 * so the count and the sample both come from the server that resolved it.
 */
export interface EscalatedSelection {
	/** What the predicate covers, in the words the list escalated it with. */
	scope: string;
	/** The server's count of the whole match, which the run is offered against. */
	total: number;
	/** The predicate itself, which the sample and the run both re-resolve. */
	searchQuery: EscalationSearchQuery;
	/**
	 * Runs one verb over the whole predicate, paging it server-side. The chunked
	 * runner the list already owns: the run screen drives it, and the review
	 * screen is what now stands in front of it. The run belongs to the list, so
	 * it survives the wizard closing over it — as the run screen promises.
	 */
	run: (action: EscalatedAction) => Promise<BulkRunOutcome>;
	/** Ends that run at the next page boundary, which leaving the wizard does not. */
	stop: () => void;
}

export interface SelectionWizardHostProps {
	/** What the bar was pressed for. Every verb walks the same wizard. */
	verb: Verb;
	/** The account the ticked rows belong to, absent when they span several. */
	accountId?: string;
	/** Where the selection was made, so a run invalidates the listing it changed. */
	mailboxId?: string;
	selection: readonly WizardSelectionMessage[];
	/** The ticked rows span more than one account, so no rule can be created. */
	crossAccount?: boolean;
	/** Present when the selection is a predicate rather than the ticked rows. */
	escalated?: EscalatedSelection;
	/**
	 * How far the escalated runner has got. Read live and passed apart from
	 * {@link EscalatedSelection}, which the wizard holds for the whole walk: the
	 * list's escalation returns to idle when a run ends, so a progress reading
	 * taken off the held predicate would be frozen at `undefined` for every
	 * retry after the first and the bar would never move.
	 */
	escalatedProgress?: BulkActionProgress;
	/** The wizard is done with the selection, and the list drops it. */
	onFinished: () => void;
	/**
	 * How a run ended, once the screen that was reporting on it is gone. The run
	 * screen invites the user to close it and keep the run going, so the surface
	 * that outlives the wizard is what states the ending. Called only for a run
	 * the user walked away from; a run screen still up reports in place.
	 */
	onRunEnded?: (
		kind: EscalatedAction["kind"],
		matched: number,
		outcome: BulkRunOutcome,
	) => void;
}

/**
 * A search entry with no query behind it — a link typed by hand, or one whose
 * query is gone. It opens the same properties step with nothing seeded, which
 * the step already states, rather than a wizard that renders nothing.
 */
const NO_CONVERSION: SearchConversion = {
	clauses: [],
	matchOperator: "all",
	droppedFacets: [],
	keptTerms: false,
	droppedSemantic: false,
};

/** A search entry has nothing ticked; its match is the query's clauses (#477 3.2). */
const EMPTY_SELECTION: readonly WizardSelectionMessage[] = [];

/** How far a commit has got, whichever of the three ways it took. */
interface RunSnapshot {
	state: RunState;
	matched: number;
	applied: number;
	failed: number;
	failures: readonly WizardMessage[];
	/**
	 * Why a commit never started, when the reason is one the same commit cannot
	 * get past. Carried to the run screen, which states it and offers no retry
	 * (#522).
	 */
	failureReason?: string;
}

const NOT_STARTED: RunSnapshot = {
	state: "saving",
	matched: 0,
	applied: 0,
	failed: 0,
	failures: [],
};

const withIds = (
	clauses: readonly Omit<RuleClause, "id">[],
	prefix: string,
): RuleClause[] =>
	clauses.map((clause, index) => ({ ...clause, id: `${prefix}-${index}` }));

/**
 * The bulk call a verb makes over a concrete list of ids. Junk is a move: the
 * message-flags API has no `$Junk` field, so the Junk verb files into the
 * account's appointed Junk mailbox, and Move and Organize into the folder the
 * folder step chose.
 */
const bulkActionFor = (
	verb: Verb,
	moveMailboxId: string | undefined,
	junkMailboxId: string | undefined,
): EscalatedAction | undefined => {
	if (verb === "delete") return { kind: "delete" };
	if (verb === "markRead") return { kind: "markRead" };
	const destinationMailboxId = verb === "junk" ? junkMailboxId : moveMailboxId;
	return destinationMailboxId
		? { kind: "move", destinationMailboxId }
		: undefined;
};

/**
 * Whether a widened match is applied by the server's own pass rather than over
 * the ids it matched. The back-apply job carries a move and nothing else, so
 * Move, Junk and Organize hand it the whole match; Delete and Mark read have no
 * server-side pass and act on the ids the preview matched.
 */
const widenedRunsAsJob = (verb: Verb): boolean =>
	verb === "move" || verb === "junk" || verb === "organize";

/**
 * The commit pressed with nowhere for the mail to go. A verb that files mail
 * needs a destination, and reaching the run screen without one is a failure the
 * screen states along with the way out of it — never a control that does
 * nothing, and never a retry that re-sends the same commit to the same absence.
 */
const noDestinationReason = (verb: Verb): string =>
	verb === "junk"
		? NO_JUNK_FOLDER_REASON
		: "No destination was chosen, so there is nowhere to file these. Go back and pick a folder.";

/**
 * Where the wizard meets the app (#483). The steps and their bodies belong to
 * `@remit/ui`; everything that talks to a server is here: the widen, the live
 * count, the folder create, the bulk call, the back-apply job and the filter.
 *
 * Every commit routes through `organize-model.ts`, so the four `OrganizeScope`
 * values are reconstructed in one place from the two answers the wizard asks
 * for — what the action covers, and how long it holds.
 *
 * One walk of the wizard, and only that. Everything the walk answers — the door,
 * the draft, whether a commit has been sent — lives here rather than in the host
 * that mounts it, so closing the wizard takes all of it with the screen. Held a
 * level up, on a component the list mounts for as long as it is on screen, the
 * first commit's guard would still be up when the next selection reached Review,
 * and the second one would press a control that does nothing at all.
 */
function SelectionWizardSession({
	verb,
	accountId,
	mailboxId,
	selection,
	crossAccount = false,
	escalated: escalatedSelection,
	escalatedProgress,
	searchConversion,
	onFinished,
	onRunEnded,
	step,
	goToStep,
	goBack,
	closeWizard,
}: SelectionWizardSessionProps) {
	// The query as it read when the wizard opened. Held for the walk, so a search
	// still settling underneath cannot rewrite the notice a user is reading while
	// the clauses beside it stay as they were seeded.
	const [conversion] = useState(() => searchConversion);
	// The predicate this walk is for, held for the walk. The list's escalation
	// returns to idle the moment a run ends, and a wizard reading it live would
	// lose the match its run screen is reporting on — and would offer a retry over
	// the loaded rows instead of over the predicate.
	const [escalated] = useState(() => escalatedSelection);
	const fromSearch = conversion !== undefined;
	// The door the wizard is on. An escalated predicate is not one of them and is
	// not held here: it is a property of the selection the list handed over, so
	// the mode below is derived rather than settable. No screen can escalate a
	// selection, and the commit path can be typed to the doors.
	const [door, setDoor] = useState<MatchDoor>(
		fromSearch ? "properties" : "selected",
	);
	const mode: MatchMode = escalated ? "escalated" : door;
	const [draft, setDraft] = useState<WizardDraft>(() =>
		conversion
			? {
					clauses: withIds(conversion.clauses, "search"),
					matchOperator: conversion.matchOperator,
				}
			: EMPTY_DRAFT,
	);
	const [clauseEdit, setClauseEdit] = useState<ClauseEditState | undefined>(
		undefined,
	);
	const [nudgedStep, setNudgedStep] = useState<StepId | undefined>(undefined);
	const [semanticFallbackTaken, setSemanticFallbackTaken] = useState(false);
	const [committedScope, setCommittedScope] = useState<
		OrganizeScope | undefined
	>(undefined);
	const [bulkRun, setBulkRun] = useState<
		| { matched: number; outcome?: BulkRunOutcome; failureReason?: string }
		| undefined
	>(undefined);
	// The predicate the create chains its pass to. Undefined when the rule cannot
	// be back-applied — a `HasWords` clause the vector-free pass cannot evaluate —
	// in which case the filter still saves and applies to incoming mail. Kept, not
	// cleared, so a failed start can be retried.
	const [backApplyDraft, setBackApplyDraft] = useState<OrganizeDraft>();
	const commitSent = useRef(false);
	// The user left the run screen while it was still reporting. Held here rather
	// than read back off the URL: the rewind the exit starts lands a frame or two
	// later, and an outcome arriving in between would find a screen that is on
	// its way out and say nothing.
	const walkedAway = useRef(false);

	const messageIds = useMemo(
		() => selection.map((message) => message.id),
		[selection],
	);
	const senders = useMemo(
		() => selection.map((message) => message.email).filter(Boolean),
		[selection],
	);
	const anchorMessageId = messageIds[0];
	const subjects = useSelectedSubjects(messageIds);
	const { junkMailboxId } = useJunkMailbox(accountId);

	// No door is offered over an escalated predicate, so nothing here has a widen
	// to probe for.
	const widen = useOrganizeWiden(
		escalated ? undefined : accountId,
		anchorMessageId,
		senders,
	);
	const { preview: probeWiden } = widen;
	// The similar door has to know before it is pressed whether it can run, so
	// the probe fires with the wizard rather than with the door (#477 3.6).
	useEffect(() => {
		probeWiden();
	}, [probeWiden]);

	// A door the wizard resolves itself, through the preview endpoint. The
	// escalated predicate is resolved by the list before the wizard opens, and
	// the ticked list is its own answer, so neither is previewed.
	const previewed = mode === "similar" || mode === "properties";
	const literalPredicate: OrganizeMatchPredicate = useMemo(
		() => ({
			matchOperator: draft.matchOperator === "all" ? "And" : "Or",
			literalClauses: draft.clauses.map((clause) => ({
				field: clause.field,
				value: clause.value,
			})),
		}),
		[draft.clauses, draft.matchOperator],
	);
	const predicate =
		mode === "similar" ? widen.matchPredicate : literalPredicate;
	// The count and the ids both come from the server, never from paging the list
	// in the browser (#477 5.3). The ticked list is its own count, so no request
	// is made for it.
	const { count: previewCount, matchedIds } = useRulePreview(
		previewed ? accountId : undefined,
		predicate,
	);
	const matchSample = useMatchSample(previewed ? matchedIds : []);
	// The escalated match's own members, read from the search that resolved it.
	const escalatedSample = useSearchMatchSample(
		escalated ? mailboxId : undefined,
		escalated?.searchQuery,
	);

	const count: MatchCount = escalated
		? { status: "ready", count: escalated.total }
		: previewed
			? previewCount
			: { status: "ready", count: selection.length };

	const { data: mailboxesData } = useQuery({
		...mailboxOperationsListMailboxesOptions({
			path: { accountId: accountId ?? "" },
		}),
		enabled: !!accountId,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const folderAppointments = useFolderAppointments(accountId);
	const translator = useFolderLabelTranslator();
	const mailboxes = useMemo<FolderTreeNode[]>(
		() =>
			buildMoveOptions({
				mailboxes: mailboxesData?.items ?? [],
				folderAppointments,
				currentMailboxId: mailboxId,
				translator,
			}),
		[mailboxesData?.items, folderAppointments, mailboxId, translator],
	);
	const { createFolderIn } = useCreateMailbox(accountId);

	const folderLabel = mailboxes.find(
		(mailbox) => mailbox.id === draft.moveMailboxId,
	)?.label;
	const leadSender = dominantSender(
		selection.map((message) => ({
			normalizedEmail: message.email,
			displayName: message.sender,
		})),
	);
	const suggestedName = suggestRuleName({
		match:
			mode === "properties"
				? draft.clauses[0]?.value.trim() || undefined
				: undefined,
		sender: leadSender ? senderLabel(leadSender) : undefined,
		folder: folderLabel,
	});
	// The name the rule commits under: what the user typed, or the suggestion the
	// field is showing them. The two must be the same string, or Continue blocks
	// on a name that is on screen.
	const named = useMemo<WizardDraft>(
		() => ({ ...draft, name: draft.name ?? suggestedName }),
		[draft, suggestedName],
	);

	const clauseSuggestions = useClauseSuggestions(
		clauseEdit?.draft.field,
		clauseEdit?.draft.value ?? "",
		senders,
	);

	const organizeJob = useOrganizeJob(accountId);
	const createFilter = useCreateFilter(accountId);
	const bulk = useEscalatedActions({
		mailboxId: mailboxId ?? "",
		accountId,
		enabled: false,
		predicateKey: "selection-wizard",
		searchQuery: {},
	});
	const { runAction } = bulk;

	const steps = stepsFor({ verb, mode, scope: draft.scope, fromSearch });
	// The step the screens are on, which is the held one only while the answers
	// still hold it. Reading the URL's step here and the resolved one on screen
	// is how a footer comes to name a screen nobody is looking at.
	const current = steps[stepIndex(steps, step)];

	// A filter, a folder, and the preview that counts a widened door all belong to
	// one account, so a selection spanning accounts reaches none of them and is
	// told so on the step that asks (#477 5.5, #523). The one-off scope and the
	// ticked rows act on the messages themselves and are unaffected.
	const accountScoped = !crossAccount && !!accountId;
	const ruleRestriction = accountScoped ? undefined : crossAccountRuleReason;
	const folderRestriction = accountScoped
		? undefined
		: crossAccountDestinationReason;
	const restrictionFor = (step: StepId): string | undefined => {
		if (step === "folder") return folderRestriction;
		if (step !== "rule") return undefined;
		return named.scope === "standing" || named.scope === "until"
			? ruleRestriction
			: undefined;
	};
	const blockedReason =
		restrictionFor(current) ?? stepBlockedReason(current, named, count);

	const seedPropertyClauses = useCallback(
		() => withIds(derivePropertyClauses(senders, subjects), "seed"),
		[senders, subjects],
	);

	const changeMode = useCallback(
		(next: MatchDoor) => {
			setDoor(next);
			setDraft((held) => ({
				...held,
				widen:
					next === "similar" && anchorMessageId
						? { anchorCount: Math.max(selection.length, 1) }
						: undefined,
				...(next === "properties" && held.clauses.length === 0
					? { clauses: seedPropertyClauses() }
					: {}),
			}));
		},
		[anchorMessageId, selection.length, seedPropertyClauses],
	);

	// The dimmed similar door, pressed. The senders the widen would have fallen
	// back to are filled in on the property step instead of standing in for the
	// semantic match without saying so (#477 3.6).
	const takeSemanticFallback = useCallback(() => {
		setSemanticFallbackTaken(true);
		setDoor("properties");
		setDraft((held) => ({
			...held,
			widen: undefined,
			clauses: withIds(deriveSenderClauses(senders), "sender"),
			matchOperator: "any",
		}));
		goToStep("properties");
	}, [senders, goToStep]);

	// The probe lands after the door is on screen, so it can report the widen
	// unavailable while the user is already holding it. The fallback is taken then
	// rather than left as a door that counts nothing: the property step says, in
	// so many words, that these are the senders it substituted (#477 3.6).
	const semanticUnavailable = widen.semanticUnavailable || widen.isError;
	// Only while the door is the screen: the probe re-fires when the anchor
	// changes under a background refetch, and a late answer that moved the step
	// from Review would push an entry the wizard does not own and leave the count
	// it rewinds by wrong.
	useEffect(() => {
		if (current !== "match") return;
		if (mode !== "similar" || !semanticUnavailable || semanticFallbackTaken) {
			return;
		}
		takeSemanticFallback();
	}, [
		current,
		mode,
		semanticUnavailable,
		semanticFallbackTaken,
		takeSemanticFallback,
	]);

	const startAddClause = useCallback(() => {
		setClauseEdit({ mode: "add", draft: { field: "From", value: "" } });
	}, []);

	const startEditClause = useCallback(
		(clauseId: string) => {
			const clause = draft.clauses.find((held) => held.id === clauseId);
			if (!clause) return;
			setClauseEdit({
				mode: "edit",
				clauseId,
				draft: { field: clause.field, value: clause.value },
			});
		},
		[draft.clauses],
	);

	const removeClause = useCallback((clauseId: string) => {
		setDraft((held) => ({
			...held,
			clauses: held.clauses.filter((clause) => clause.id !== clauseId),
		}));
	}, []);

	const changeClauseDraft = useCallback((next: ClauseDraft) => {
		setClauseEdit((edit) => edit && { ...edit, draft: next });
	}, []);

	const submitClause = useCallback(() => {
		setClauseEdit((edit) => {
			if (!edit) return undefined;
			const value = normalizeClauseValue(edit.draft.field, edit.draft.value);
			const next = { ...edit.draft, value };
			setDraft((held) => ({
				...held,
				clauses: edit.clauseId
					? held.clauses.map((clause) =>
							clause.id === edit.clauseId ? { ...clause, ...next } : clause,
						)
					: [...held.clauses, { id: crypto.randomUUID(), ...next }],
			}));
			return undefined;
		});
	}, []);

	const advance = useCallback(() => {
		if (blockedReason) {
			setNudgedStep(current);
			return;
		}
		setNudgedStep(undefined);
		const next = steps[stepIndex(steps, current) + 1];
		if (next) goToStep(next);
	}, [blockedReason, current, steps, goToStep]);

	const runBulk = useCallback(
		async (ids: readonly string[]) => {
			const action = bulkActionFor(verb, named.moveMailboxId, junkMailboxId);
			if (!action) {
				setBulkRun({
					matched: ids.length,
					failureReason: noDestinationReason(verb),
				});
				return;
			}
			setBulkRun({ matched: ids.length });
			const outcome = await runAction(action, [...ids]);
			setBulkRun({ matched: ids.length, outcome });
			if (walkedAway.current) onRunEnded?.(action.kind, ids.length, outcome);
		},
		[verb, named.moveMailboxId, junkMailboxId, runAction, onRunEnded],
	);

	// The escalated predicate, run by the chunked runner the list already owns.
	// It pages the match on the server rather than acting on ids the browser
	// loaded, so the verb reaches every message the review screen counted.
	const runEscalated = useCallback(async () => {
		if (!escalated) return;
		const action = bulkActionFor(verb, named.moveMailboxId, junkMailboxId);
		if (!action) {
			setBulkRun({
				matched: escalated.total,
				failureReason: noDestinationReason(verb),
			});
			return;
		}
		setBulkRun({ matched: escalated.total });
		const outcome = await escalated.run(action);
		setBulkRun({ matched: escalated.total, outcome });
		if (walkedAway.current) {
			onRunEnded?.(action.kind, escalated.total, outcome);
		}
	}, [escalated, verb, named.moveMailboxId, junkMailboxId, onRunEnded]);

	const { start: startJob } = organizeJob;
	const { createFilterAsync } = createFilter;

	const sendCommit = useCallback(() => {
		// An escalated predicate is not a rule and has no scope to reconstruct: it
		// is the search the list is showing, applied once, by the runner that
		// resolved it.
		if (escalated) {
			void runEscalated();
			return;
		}
		const scope = organizeScopeFor({ mode: door, ruleScope: named.scope });
		const organizeDraft = buildWizardDraft({
			mode: door,
			ruleScope: named.scope,
			anchorMessageId,
			clauses: named.clauses,
			matchOperator: named.matchOperator,
			moveMailboxId: named.moveMailboxId,
			until: named.until,
		});
		setCommittedScope(scope);

		if (scope === "standing" || scope === "temporary") {
			// Creating a filter also moves the mail that already matches, not only
			// the mail that arrives next. The pass is chained to the create's own
			// request rather than to this screen: the screen offers a Close while
			// the create is still in flight, and a rule that saved with no pass
			// behind it — and nothing left to retry from — is a silent no-op.
			const backApply = canBackApplyDraft(organizeDraft)
				? organizeDraft
				: undefined;
			setBackApplyDraft(backApply);
			void createFilterAsync(
				organizeDraft,
				scope,
				(named.name ?? "").trim(),
			).then((created) => {
				if (created && backApply) startJob(backApply);
			});
			return;
		}
		if (scope === "all-like-these" && widenedRunsAsJob(verb)) {
			startJob(organizeDraft);
			return;
		}
		void runBulk(scope === "just-these" ? messageIds : matchedIds);
	}, [
		escalated,
		runEscalated,
		door,
		named,
		anchorMessageId,
		verb,
		messageIds,
		matchedIds,
		createFilterAsync,
		startJob,
		runBulk,
	]);

	// Two presses land in the same frame before either navigate settles, and both
	// would send. The guard is a ref rather than the committed scope because that
	// is state, and state has not been applied yet by the second press.
	const commit = useCallback(() => {
		if (blockedReason) {
			setNudgedStep(current);
			return;
		}
		if (commitSent.current) return;
		commitSent.current = true;
		goToStep("run");
		sendCommit();
	}, [blockedReason, current, goToStep, sendCommit]);

	const jobSnapshot = useCallback(
		(ruleSaved: boolean): RunSnapshot => {
			const progress = organizeJob.progress;
			const state = organizeRunState({
				failure: organizeJob.failure,
				isStarting: organizeJob.isStarting,
				isRunning: organizeJob.isRunning,
				isDone: organizeJob.isDone,
				failedCount: progress.failedCount,
				ruleSaved,
			});
			if (
				state === "saving" ||
				state === "commitFailed" ||
				state === "backApplyStartFailed"
			) {
				return { ...NOT_STARTED, state };
			}
			return {
				state,
				matched: progress.matchedCount,
				applied: progress.appliedCount,
				failed:
					state === "backApplyFailed" || state === "backApplyRestartFailed"
						? progress.failedCount
						: 0,
				failures: [],
			};
		},
		[organizeJob],
	);

	// Every row the wizard has seen a description of, so a run that names what it
	// did not reach can name it rather than listing an id.
	const rowsById = useMemo(() => {
		const rows = new Map<string, WizardMessage>();
		for (const message of [
			...selection,
			...matchSample.messages,
			...escalatedSample.messages,
		]) {
			rows.set(message.id, message);
		}
		return rows;
	}, [selection, matchSample.messages, escalatedSample.messages]);

	const runProgress = escalated ? escalatedProgress : bulk.progress;

	const bulkSnapshot = useCallback((): RunSnapshot => {
		if (!bulkRun) return NOT_STARTED;
		const { matched, outcome, failureReason } = bulkRun;
		// Nothing was sent, and nothing about sending it again resolves what was
		// missing — so the screen carries why rather than the generic ending (#522).
		if (failureReason !== undefined) {
			return { ...NOT_STARTED, state: "commitFailed", failureReason };
		}
		if (!outcome) {
			const applied = runProgress?.done ?? 0;
			// A predicate matches more by the time the run re-pages it than the count
			// saw, so what it has covered can overtake what it was offered against.
			// The bar never reads more done than out of, and neither does this.
			return {
				state: "backApplyRunning",
				matched: Math.max(matched, applied),
				applied,
				failed: 0,
				failures: [],
			};
		}
		const stopped = outcome.cancelled || outcome.error !== undefined;
		if (!stopped) {
			return {
				state: "backApplyComplete",
				matched: Math.max(matched, outcome.done),
				applied: outcome.done,
				failed: 0,
				failures: [],
			};
		}
		if (outcome.done === 0) {
			return { ...NOT_STARTED, state: "commitFailed" };
		}
		// The run stopped part-way. Nothing here was rejected: a returned bulk call
		// accepts every id in it, so the only failure this layer sees is a call that
		// threw, and everything after it was never sent. A bounded run hands back
		// exactly those ids; a predicate run re-resolves its match on every pass and
		// has no remainder to hand back, so what is left is the difference between
		// the count and what the run covered.
		const failures = outcome.failedIds
			.map((id) => rowsById.get(id))
			.filter((message): message is WizardMessage => message !== undefined);
		const unreached =
			outcome.failedIds.length > 0
				? outcome.failedIds.length
				: Math.max(matched - outcome.done, 1);
		return {
			state: "runStopped",
			matched: Math.max(matched, outcome.done),
			applied: outcome.done,
			failed: unreached,
			failures,
		};
	}, [bulkRun, runProgress, rowsById]);

	const runSnapshot = (): RunSnapshot => {
		if (escalated) return bulkSnapshot();
		if (committedScope === "standing" || committedScope === "temporary") {
			if (createFilter.isError)
				return { ...NOT_STARTED, state: "commitFailed" };
			if (!createFilter.isSuccess) return NOT_STARTED;
			if (!backApplyDraft) return { ...NOT_STARTED, state: "filterSaved" };
			return jobSnapshot(true);
		}
		if (committedScope === "all-like-these" && widenedRunsAsJob(verb)) {
			return jobSnapshot(false);
		}
		return bulkSnapshot();
	};

	const run = runSnapshot();

	// Retry stays on the run screen: it re-sends the same commit rather than
	// walking back to Review, which would push an entry the wizard does not own
	// and leave Cancel rewinding to a step instead of out.
	const retry = (): void => {
		// A status that could not be read is a job still running on the server, so
		// the screen looks at that job again rather than queuing a second pass over
		// the same mail (#526).
		if (run.state === "statusUnknown") {
			organizeJob.refreshStatus();
			return;
		}
		// The predicate is re-resolved, not resumed: every verb it carries is
		// idempotent, so the messages the first pass already reached are a no-op.
		if (escalated) {
			void runEscalated();
			return;
		}
		if (committedScope === "standing" || committedScope === "temporary") {
			if (createFilter.isError) {
				createFilter.reset();
				sendCommit();
				return;
			}
			if (backApplyDraft) startJob(backApplyDraft);
			return;
		}
		if (committedScope === "all-like-these" && widenedRunsAsJob(verb)) {
			sendCommit();
			return;
		}
		const outstanding = bulkRun?.outcome?.failedIds ?? [];
		void runBulk(outstanding.length > 0 ? outstanding : messageIds);
	};

	// Cancel rewinds the entries the wizard owns and leaves the selection where
	// it was — nothing has happened to it (#477 1.6).
	const cancel = useCallback(() => {
		closeWizard(steps, current);
	}, [closeWizard, steps, current]);

	// The run screen's way out. The action has happened, so the rows it was
	// aimed at are no longer a selection waiting to be acted on. It leaves the
	// run alone: the screen says so in as many words, and stopping it is a
	// control of its own.
	const dismiss = useCallback(() => {
		walkedAway.current = true;
		closeWizard(steps, current);
		onFinished();
	}, [closeWizard, steps, current, onFinished]);

	// Ends the run rather than leaving it. The escalated predicate is run by the
	// list's runner and a bounded selection by this wizard's own, so the stop
	// follows whichever one is paging.
	const { stop: stopBulk } = bulk;
	// A commit that never started has nothing paging and nothing to end.
	const runInFlight =
		bulkRun !== undefined &&
		bulkRun.outcome === undefined &&
		bulkRun.failureReason === undefined;
	const stopRun = useCallback(() => {
		if (escalated) {
			escalated.stop();
			return;
		}
		stopBulk();
	}, [escalated, stopBulk]);

	// Hardware back on the run screen leaves the wizard, the movement the header
	// arrow and the footer already make there (`backExits`). Run is an ordinary
	// pushed entry, so without this the button pops back to Review, where the
	// commit is offered a second time; the run screen holds the outcome, which is
	// what makes rewinding the entries under it safe (#477 1.6).
	//
	// The rewind `dismiss` performs is `router.history.go(-N)`, which the history
	// classifies as `"GO"` — so it does not re-enter this blocker and recurse.
	// `selection-wizard-history.spec.ts` walks a real browser back off the run
	// screen, which is what pins that classification.
	useBlocker({
		shouldBlockFn: ({ action }) => {
			if (action !== "BACK") return false;
			dismiss();
			return true;
		},
		enableBeforeUnload: false,
		disabled: current !== "run",
	});

	const sampleMessages = escalated
		? escalatedSample.messages
		: previewed
			? matchSample.messages
			: selection;
	const sample = {
		messages: sampleMessages,
		count,
		label: mode === "selected" ? "Your selection" : "A sample of what matches",
		emptyReason:
			mode === "similar" && semanticUnavailable
				? ("notIndexed" as const)
				: ("noMatch" as const),
		loading: escalated
			? escalatedSample.isPending
			: previewed && (count.status === "loading" || matchSample.isPending),
	};

	return (
		<SelectionWizard
			verb={verb}
			steps={steps}
			step={current}
			blockedReason={blockedReason}
			nudged={nudgedStep === current}
			onBack={goBack}
			// Every exit from the run screen is the same movement: the header's X,
			// the header arrow, the footer and hardware Back all leave a run that
			// has already been sent, and all of them drop the selection with it.
			onExit={current === "run" ? dismiss : cancel}
			onContinue={advance}
			onCommit={commit}
			match={{
				selectedCount: selection.length,
				mode,
				accountId: accountScoped ? accountId : undefined,
				onModeChange: changeMode,
				semanticUnavailable,
				semanticErrorDetail:
					widen.error instanceof Error ? widen.error.message : undefined,
				semanticFallbackTaken,
				onSemanticFallback: takeSemanticFallback,
				escalatedScope: escalated?.scope,
				sample,
			}}
			properties={{
				clauses: named.clauses,
				matchOperator: named.matchOperator,
				onMatchOperatorChange: (matchOperator) =>
					setDraft((held) => ({ ...held, matchOperator })),
				clauseEdit,
				onStartAddClause: startAddClause,
				onStartEditClause: startEditClause,
				onRemoveClause: removeClause,
				onChangeDraft: changeClauseDraft,
				onSubmitClause: submitClause,
				onCancelClause: () => setClauseEdit(undefined),
				clauseFields: SUPPORTED_CLAUSE_FIELDS,
				clauseSuggestions,
				conversionNotice: conversion
					? searchConversionNotice(conversion)
					: undefined,
				semanticFallbackTaken,
				sample: { ...sample, label: "What this matches" },
			}}
			folder={{
				folders: mailboxes,
				mailboxId: named.moveMailboxId,
				delimiter: folderDelimiter(mailboxesData?.items ?? []),
				onSelect: (moveMailboxId) =>
					setDraft((held) => ({ ...held, moveMailboxId })),
				onCreateFolder: accountId ? createFolderIn : undefined,
				restriction: folderRestriction,
			}}
			rule={{
				draft: named,
				onScopeChange: (scope) => setDraft((held) => ({ ...held, scope })),
				onUntilChange: (until) => setDraft((held) => ({ ...held, until })),
				restriction: ruleRestriction,
			}}
			name={{
				name: named.name ?? "",
				onNameChange: (name) => setDraft((held) => ({ ...held, name })),
				nudged: nudgedStep === current,
			}}
			review={{
				verb,
				mode,
				selectedCount: selection.length,
				clauses: named.clauses,
				matchOperator: named.matchOperator,
				folder: folderLabel,
				scope: named.scope,
				until: named.until,
				ruleName: steps.includes("name") ? named.name : undefined,
				escalatedScope: escalated?.scope,
				sample,
			}}
			run={{
				state: run.state,
				verb,
				scope: named.scope,
				matched: run.matched,
				applied: run.applied,
				failedCount: run.failed,
				failures: run.failures,
				failureReason: run.failureReason,
				onRetry: retry,
				onDismiss: dismiss,
				onCancelRun: runInFlight ? stopRun : undefined,
			}}
		/>
	);
}

/**
 * The wizard's mount point, and the only one: both entries walk this host, so
 * there is one owner of the step in the URL and of the history entries the
 * wizard pushes. The walk itself is a separate component, mounted only while a
 * step is held, so every answer it collects is gone by the time the next one
 * starts.
 *
 * The URL says which affordance opened the wizard, and that decides two things
 * and no more: which step it opens on, and whether the query seeds the clauses.
 * A search entry ticks nothing, so the selection the bar would have handed over
 * is not the one it walks; its rule belongs to the account the surface handed
 * over, and to the one the query names when it names one (#524).
 */
export function SelectionWizardHost(props: SelectionWizardHostProps) {
	const fromSearch = useWizardEntryValue() === "search";
	const { searchConversion } = useListHeaderChrome();
	const { accounts } = useMailContext();
	const { step, goToStep, goBack, closeWizard } = useWizardStep(
		fromSearch ? "properties" : "match",
	);
	if (!step) return null;
	const conversion = fromSearch
		? (searchConversion ?? NO_CONVERSION)
		: undefined;
	return (
		<SelectionWizardSession
			{...props}
			{...(conversion
				? {
						verb: "organize" as const,
						accountId: searchRuleAccountId(
							conversion,
							props.accountId,
							accounts,
						),
						selection: EMPTY_SELECTION,
						crossAccount: false,
						escalated: undefined,
						searchConversion: conversion,
					}
				: {})}
			step={step}
			goToStep={goToStep}
			goBack={goBack}
			closeWizard={closeWizard}
		/>
	);
}
