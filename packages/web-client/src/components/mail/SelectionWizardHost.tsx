import {
	type ClauseDraft,
	type ClauseEditState,
	type MatchCount,
	type MatchMode,
	type RunState,
	SelectionWizard,
	type StepId,
	stepBlockedReason,
	stepIndex,
	stepsFor,
	type Verb,
	type WizardDraft,
	type WizardMessage,
} from "@remit/ui";
import { useCallback, useState } from "react";
import { useWizardStep } from "@/lib/wizard-history";

const OPENING_STEP: StepId = "match";
const UNCOUNTED: MatchCount = { status: "uncounted" };
const EMPTY_DRAFT: WizardDraft = { clauses: [], matchOperator: "all" };

/** How the commit ended, once something commits it (#483). */
export interface WizardOutcome {
	state: RunState;
	matched: number;
	applied: number;
	failures: readonly WizardMessage[];
}

/** Nothing has been sent anywhere, so nothing can have been done. */
const NOTHING_COMMITTED: WizardOutcome = {
	state: "commitFailed",
	matched: 0,
	applied: 0,
	failures: [],
};

export interface SelectionWizardHostProps {
	verb: Verb;
	selectedCount: number;
	outcome?: WizardOutcome;
}

export function SelectionWizardHost({
	verb,
	selectedCount,
	outcome = NOTHING_COMMITTED,
}: SelectionWizardHostProps) {
	const { step, goToStep, goBack, closeWizard } = useWizardStep(OPENING_STEP);
	const [mode, setMode] = useState<MatchMode>("selected");
	const [draft, setDraft] = useState<WizardDraft>(EMPTY_DRAFT);
	const [clauseEdit, setClauseEdit] = useState<ClauseEditState | undefined>(
		undefined,
	);
	const [nudgedStep, setNudgedStep] = useState<StepId | undefined>(undefined);

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
			setDraft((held) => ({
				...held,
				clauses: edit.clauseId
					? held.clauses.map((clause) =>
							clause.id === edit.clauseId
								? { ...clause, ...edit.draft }
								: clause,
						)
					: [...held.clauses, { id: crypto.randomUUID(), ...edit.draft }],
			}));
			return undefined;
		});
	}, []);

	if (!step) return null;

	const steps = stepsFor({ verb, mode, scope: draft.scope });
	// The step the screens are on, which is the held one only while the answers
	// still hold it. Reading the URL's step here and the resolved one on screen
	// is how a footer comes to name a screen nobody is looking at.
	const current = steps[stepIndex(steps, step)];
	const blockedReason = stepBlockedReason(current, draft, UNCOUNTED);
	const sample = {
		messages: [],
		count: UNCOUNTED,
		label: "Messages this covers",
	};

	const advance = () => {
		if (blockedReason) {
			setNudgedStep(current);
			return;
		}
		const next = steps[stepIndex(steps, current) + 1];
		if (next) goToStep(next);
	};

	return (
		<SelectionWizard
			verb={verb}
			steps={steps}
			step={current}
			blockedReason={blockedReason}
			nudged={nudgedStep === current}
			onBack={goBack}
			onExit={() => closeWizard(steps, current)}
			onContinue={advance}
			onCommit={() => goToStep("run")}
			match={{
				selectedCount,
				mode,
				onModeChange: setMode,
				onSemanticFallback: () => setMode("properties"),
				sample,
			}}
			properties={{
				clauses: draft.clauses,
				matchOperator: draft.matchOperator,
				onMatchOperatorChange: (matchOperator) =>
					setDraft((held) => ({ ...held, matchOperator })),
				clauseEdit,
				onStartAddClause: startAddClause,
				onStartEditClause: startEditClause,
				onRemoveClause: removeClause,
				onChangeDraft: changeClauseDraft,
				onSubmitClause: submitClause,
				onCancelClause: () => setClauseEdit(undefined),
				sample,
			}}
			rule={{
				draft,
				onScopeChange: (scope) => setDraft((held) => ({ ...held, scope })),
				onUntilChange: (until) => setDraft((held) => ({ ...held, until })),
			}}
			name={{
				name: draft.name ?? "",
				onNameChange: (name) => setDraft((held) => ({ ...held, name })),
				nudged: nudgedStep === current,
			}}
			review={{
				verb,
				mode,
				selectedCount,
				clauses: draft.clauses,
				matchOperator: draft.matchOperator,
				scope: draft.scope,
				until: draft.until,
				ruleName: draft.name,
				sample,
			}}
			run={{
				state: outcome.state,
				verb,
				scope: draft.scope,
				matched: outcome.matched,
				applied: outcome.applied,
				failures: outcome.failures,
				onRetry: goBack,
				onDismiss: () => closeWizard(steps, current),
			}}
		/>
	);
}
