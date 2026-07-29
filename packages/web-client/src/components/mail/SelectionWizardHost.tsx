import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	type ClauseDraft,
	type ClauseEditState,
	crossAccountDestinationReason,
	crossAccountRuleReason,
	derivePropertyClauses,
	deriveSenderClauses,
	dominantSender,
	type MatchCount,
	type MatchMode,
	type MoveMailboxOption,
	type RuleClause,
	type RunState,
	SelectionWizard,
	type StepId,
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
	useEscalatedActions,
} from "@/hooks/useEscalatedActions";
import { useCreateFilter } from "@/hooks/useFilters";
import { useMatchSample } from "@/hooks/useMatchSample";
import { useOrganizeJob } from "@/hooks/useOrganizeJob";
import { useOrganizeWiden } from "@/hooks/useOrganizeWiden";
import { useRulePreview } from "@/hooks/useRulePreview";
import { useSelectedSubjects } from "@/hooks/useSelectedSubjects";
import type { BulkRunOutcome } from "@/lib/bulk-actions";
import { getMailboxDisplayName } from "@/lib/folder-roles";
import { buildMoveTargets } from "@/lib/move-targets";
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
import type { OrganizeMatchPredicate } from "@/lib/organize/sender-fallback";
import { useWizardStep } from "@/lib/wizard-history";

const OPENING_STEP: StepId = "match";
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
	/** The wizard is done with the selection, and the list drops it. */
	onFinished: () => void;
}

/** How far a commit has got, whichever of the three ways it took. */
interface RunSnapshot {
	state: RunState;
	matched: number;
	applied: number;
	failed: number;
	failures: readonly WizardMessage[];
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
	onFinished,
	step,
	goToStep,
	goBack,
	closeWizard,
}: SelectionWizardSessionProps) {
	const [mode, setMode] = useState<MatchMode>("selected");
	const [draft, setDraft] = useState<WizardDraft>(EMPTY_DRAFT);
	const [clauseEdit, setClauseEdit] = useState<ClauseEditState | undefined>(
		undefined,
	);
	const [nudgedStep, setNudgedStep] = useState<StepId | undefined>(undefined);
	const [semanticFallbackTaken, setSemanticFallbackTaken] = useState(false);
	const [committedScope, setCommittedScope] = useState<
		OrganizeScope | undefined
	>(undefined);
	const [bulkRun, setBulkRun] = useState<
		{ matched: number; outcome?: BulkRunOutcome } | undefined
	>(undefined);
	// The predicate the create chains its pass to. Undefined when the rule cannot
	// be back-applied — a `HasWords` clause the vector-free pass cannot evaluate —
	// in which case the filter still saves and applies to incoming mail. Kept, not
	// cleared, so a failed start can be retried.
	const [backApplyDraft, setBackApplyDraft] = useState<OrganizeDraft>();
	const commitSent = useRef(false);

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

	const widen = useOrganizeWiden(accountId, anchorMessageId, senders);
	const { preview: probeWiden } = widen;
	// The similar door has to know before it is pressed whether it can run, so
	// the probe fires with the wizard rather than with the door (#477 3.6).
	useEffect(() => {
		probeWiden();
	}, [probeWiden]);

	const widened = mode !== "selected";
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
		widened ? accountId : undefined,
		predicate,
	);
	const matchSample = useMatchSample(widened ? matchedIds : []);

	const count: MatchCount = widened
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
	const mailboxes = useMemo<MoveMailboxOption[]>(
		() =>
			buildMoveTargets(mailboxesData?.items ?? [], folderAppointments).map(
				(mailbox) => ({
					id: mailbox.mailboxId,
					label: getMailboxDisplayName(mailbox.fullPath),
					searchValue: mailbox.fullPath,
					isCurrent: mailbox.mailboxId === mailboxId,
				}),
			),
		[mailboxesData?.items, folderAppointments, mailboxId],
	);
	const { createFolder } = useCreateMailbox(accountId);

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

	const steps = stepsFor({ verb, mode, scope: draft.scope });
	// The step the screens are on, which is the held one only while the answers
	// still hold it. Reading the URL's step here and the resolved one on screen
	// is how a footer comes to name a screen nobody is looking at.
	const current = steps[stepIndex(steps, step)];

	// A filter and a folder both belong to one account, so a selection spanning
	// accounts reaches neither and is told so on the step that asks (#477 5.5).
	// The one-off scope acts on the messages themselves and is unaffected.
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
		(next: MatchMode) => {
			setMode(next);
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
		setMode("properties");
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
					outcome: {
						done: 0,
						failedIds: [...ids],
						cancelled: false,
						error: new Error(
							verb === "junk"
								? "This account has no Junk folder appointed, so there is nowhere to file these. Appoint one under Settings › Folders."
								: "No destination was chosen, so there is nowhere to file these. Go back and pick a folder.",
						),
					},
				});
				return;
			}
			setBulkRun({ matched: ids.length });
			const outcome = await runAction(action, [...ids]);
			setBulkRun({ matched: ids.length, outcome });
		},
		[verb, named.moveMailboxId, junkMailboxId, runAction],
	);

	const { start: startJob } = organizeJob;
	const { createFilterAsync } = createFilter;

	const sendCommit = useCallback(() => {
		const scope = organizeScopeFor({ mode, ruleScope: named.scope });
		const organizeDraft = buildWizardDraft({
			mode,
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
		mode,
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

	const jobSnapshot = useCallback((): RunSnapshot => {
		const progress = organizeJob.progress;
		const shared = {
			matched: progress.matchedCount,
			applied: progress.appliedCount,
			failures: [],
		};
		if (organizeJob.isError) {
			return { ...NOT_STARTED, state: "commitFailed" };
		}
		if (organizeJob.isDone) {
			return {
				...shared,
				state:
					progress.failedCount > 0 ? "backApplyFailed" : "backApplyComplete",
				failed: progress.failedCount,
			};
		}
		if (organizeJob.isStarting || organizeJob.isRunning) {
			return { ...shared, state: "backApplyRunning", failed: 0 };
		}
		return NOT_STARTED;
	}, [organizeJob]);

	const rowsById = useMemo(() => {
		const rows = new Map<string, WizardMessage>();
		for (const message of [...selection, ...matchSample.messages]) {
			rows.set(message.id, message);
		}
		return rows;
	}, [selection, matchSample.messages]);

	const bulkSnapshot = useCallback((): RunSnapshot => {
		if (!bulkRun) return NOT_STARTED;
		const { matched, outcome } = bulkRun;
		if (!outcome) {
			return {
				state: "backApplyRunning",
				matched,
				applied: bulk.progress?.done ?? 0,
				failed: 0,
				failures: [],
			};
		}
		if (outcome.done === 0 && (outcome.error || outcome.failedIds.length > 0)) {
			return { ...NOT_STARTED, state: "commitFailed" };
		}
		const failures = outcome.failedIds
			.map((id) => rowsById.get(id))
			.filter((message): message is WizardMessage => message !== undefined);
		return {
			state:
				outcome.failedIds.length > 0 ? "backApplyFailed" : "backApplyComplete",
			matched,
			applied: outcome.done,
			failed: outcome.failedIds.length,
			failures,
		};
	}, [bulkRun, bulk.progress, rowsById]);

	const runSnapshot = (): RunSnapshot => {
		if (committedScope === "standing" || committedScope === "temporary") {
			if (createFilter.isError)
				return { ...NOT_STARTED, state: "commitFailed" };
			if (!createFilter.isSuccess) return NOT_STARTED;
			if (!backApplyDraft) return { ...NOT_STARTED, state: "filterSaved" };
			if (organizeJob.isError) {
				return { ...NOT_STARTED, state: "backApplyStartFailed" };
			}
			return jobSnapshot();
		}
		if (committedScope === "all-like-these" && widenedRunsAsJob(verb)) {
			return jobSnapshot();
		}
		return bulkSnapshot();
	};

	// Retry stays on the run screen: it re-sends the same commit rather than
	// walking back to Review, which would push an entry the wizard does not own
	// and leave Cancel rewinding to a step instead of out.
	const retry = (): void => {
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
	// aimed at are no longer a selection waiting to be acted on.
	const dismiss = useCallback(() => {
		closeWizard(steps, current);
		onFinished();
	}, [closeWizard, steps, current, onFinished]);

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

	const run = runSnapshot();
	const sample = {
		messages: widened ? matchSample.messages : selection,
		count,
		label: widened ? "A sample of what matches" : "Your selection",
		emptyReason:
			mode === "similar" && semanticUnavailable
				? ("notIndexed" as const)
				: ("noMatch" as const),
		loading: widened && (count.status === "loading" || matchSample.isPending),
	};

	return (
		<SelectionWizard
			verb={verb}
			steps={steps}
			step={current}
			blockedReason={blockedReason}
			nudged={nudgedStep === current}
			onBack={goBack}
			onExit={cancel}
			onContinue={advance}
			onCommit={commit}
			match={{
				selectedCount: selection.length,
				mode,
				onModeChange: changeMode,
				semanticUnavailable,
				semanticErrorDetail:
					widen.error instanceof Error ? widen.error.message : undefined,
				semanticFallbackTaken,
				onSemanticFallback: takeSemanticFallback,
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
				semanticFallbackTaken,
				sample: { ...sample, label: "What this matches" },
			}}
			folder={{
				mailboxes,
				mailboxId: named.moveMailboxId,
				onSelect: (moveMailboxId) =>
					setDraft((held) => ({ ...held, moveMailboxId })),
				onCreateFolder: accountId ? createFolder : undefined,
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
				onRetry: retry,
				onDismiss: dismiss,
			}}
		/>
	);
}

/**
 * The wizard's mount point, beside the list that opens it. It owns the step in
 * the URL and the history entries the wizard walks; the walk itself is a
 * separate component, mounted only while a step is held, so every answer it
 * collects is gone by the time the next one starts.
 */
export function SelectionWizardHost(props: SelectionWizardHostProps) {
	const { step, goToStep, goBack, closeWizard } = useWizardStep(OPENING_STEP);
	if (!step) return null;
	return (
		<SelectionWizardSession
			{...props}
			step={step}
			goToStep={goToStep}
			goBack={goBack}
			closeWizard={closeWizard}
		/>
	);
}
