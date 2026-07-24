import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	Button,
	type ClauseEditState,
	type ClauseField,
	type FilterRule,
	FilterRuleEditor,
	type FolderOption,
	type MatchOperator,
	type RuleScope,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useCreateFilter } from "@/hooks/useFilters";
import { useOrganizeJob } from "@/hooks/useOrganizeJob";
import { useRulePreview } from "@/hooks/useRulePreview";
import { getMailboxDisplayName } from "@/lib/folder-roles";
import { buildMoveTargets } from "@/lib/move-targets";
import {
	buildInitialRule,
	rulePredicate,
	ruleToDraft,
	SUPPORTED_CLAUSE_FIELDS,
} from "@/lib/organize/rule-model";

interface OrganizeRuleEditorProps {
	accountId: string;
	selectedMessageIds: string[];
	/** The widen probe's matched total — seeds the live count without a re-fetch. */
	seedCount: number;
	/**
	 * The deployment ships no vector pipeline, so the widen cannot run. The rule
	 * opens on the sender-fallback `From` chips instead of the anchor.
	 */
	semanticUnavailable?: boolean;
	/** Distinct sender addresses, for the fallback clauses and the progress copy. */
	senders?: string[];
	/** A folder a "Something else" shortcut pre-picked. */
	seedMailboxId?: string;
	/** A scope a "Something else" shortcut pre-picked. */
	seedScope?: RuleScope;
	onClose: () => void;
}

/**
 * The Organize surface as the chip editor (RFC 038 D1). The rule is rendered and
 * edited over the existing preview/apply endpoints: clause chips, a
 * match-operator toggle, a move action, and a scope that maps one-time apply to
 * a back-apply job and standing/until to a `Filter`. The count is live and the
 * commit gate holds apply until it settles, so the set the editor shows is the
 * set a commit acts on. Rendered inside the desktop dialog and the mobile sheet
 * alike, so the two cannot drift.
 */
export function OrganizeRuleEditor({
	accountId,
	selectedMessageIds,
	seedCount,
	semanticUnavailable = false,
	senders = [],
	seedMailboxId,
	seedScope,
	onClose,
}: OrganizeRuleEditorProps) {
	const anchorMessageId = selectedMessageIds[0];
	const senderFallback = semanticUnavailable && senders.length > 0;

	const [rule, setRule] = useState<FilterRule>(() =>
		buildInitialRule({
			anchorMessageId,
			semanticUnavailable,
			senders,
			selectionCount: selectedMessageIds.length,
			seedMailboxId,
			seedScope,
		}),
	);
	const [clauseEdit, setClauseEdit] = useState<ClauseEditState | undefined>();
	const nextClauseId = useRef(0);

	const { data: mailboxesData } = useQuery({
		...mailboxOperationsListMailboxesOptions({ path: { accountId } }),
		staleTime: Number.POSITIVE_INFINITY,
	});

	const folders: FolderOption[] = useMemo(
		() =>
			buildMoveTargets(mailboxesData?.items ?? []).map((mailbox) => ({
				id: mailbox.mailboxId,
				label: getMailboxDisplayName(mailbox.fullPath),
			})),
		[mailboxesData?.items],
	);

	const preview = useRulePreview(
		accountId,
		rulePredicate(rule, anchorMessageId),
		seedCount,
	);

	const organizeJob = useOrganizeJob(accountId);
	const createFilter = useCreateFilter(accountId);

	const startAddClause = () =>
		setClauseEdit({
			mode: "add",
			draft: { field: SUPPORTED_CLAUSE_FIELDS[0], value: "" },
		});

	const startEditClause = (clauseId: string) => {
		const clause = rule.clauses.find((entry) => entry.id === clauseId);
		if (!clause) return;
		setClauseEdit({
			mode: "edit",
			clauseId,
			draft: { field: clause.field, value: clause.value },
		});
	};

	const changeDraftField = (field: ClauseField) =>
		setClauseEdit((edit) =>
			edit ? { ...edit, draft: { ...edit.draft, field } } : edit,
		);

	const changeDraftValue = (value: string) =>
		setClauseEdit((edit) =>
			edit ? { ...edit, draft: { ...edit.draft, value } } : edit,
		);

	const submitClause = () => {
		if (!clauseEdit) return;
		const value = clauseEdit.draft.value.trim();
		if (value === "") return;
		const field = clauseEdit.draft.field;
		setRule((current) => {
			if (clauseEdit.mode === "edit" && clauseEdit.clauseId) {
				return {
					...current,
					clauses: current.clauses.map((clause) =>
						clause.id === clauseEdit.clauseId
							? { id: clause.id, field, value }
							: clause,
					),
				};
			}
			nextClauseId.current += 1;
			return {
				...current,
				clauses: [
					...current.clauses,
					{ id: `clause-${nextClauseId.current}`, field, value },
				],
			};
		});
		setClauseEdit(undefined);
	};

	const removeClause = (clauseId: string) =>
		setRule((current) => ({
			...current,
			clauses: current.clauses.filter((clause) => clause.id !== clauseId),
		}));

	const addWiden = () =>
		setRule((current) => ({
			...current,
			widen: { anchorCount: Math.max(selectedMessageIds.length, 1) },
		}));

	const removeWiden = () =>
		setRule((current) => ({ ...current, widen: undefined }));

	const changeMatchOperator = (matchOperator: MatchOperator) =>
		setRule((current) => ({ ...current, matchOperator }));

	const changeMove = (mailboxId: string) =>
		setRule((current) => ({
			...current,
			moveMailboxId: mailboxId || undefined,
		}));

	const changeScope = (scope: RuleScope) =>
		setRule((current) => ({ ...current, scope }));

	const changeName = (name: string) =>
		setRule((current) => ({ ...current, name }));

	const changeUntil = (until: string) =>
		setRule((current) => ({ ...current, until }));

	const commit = () => {
		const draft = ruleToDraft(rule, anchorMessageId);
		if (rule.scope === "once") {
			organizeJob.start(draft);
			return;
		}
		createFilter.createFilter(
			draft,
			rule.scope === "standing" ? "standing" : "temporary",
			(rule.name ?? "").trim(),
		);
	};

	if (organizeJob.isStarting || organizeJob.isRunning || organizeJob.isDone) {
		return (
			<JobProgress
				progress={organizeJob.progress}
				isDone={organizeJob.isDone}
				senderFallback={senderFallback}
				onClose={onClose}
			/>
		);
	}

	if (createFilter.isPending) {
		return <SavingState />;
	}

	if (createFilter.isSuccess) {
		return <FilterSaved onClose={onClose} />;
	}

	if (createFilter.isError) {
		return <CommitError onRetry={createFilter.reset} onClose={onClose} />;
	}

	return (
		<FilterRuleEditor
			rule={rule}
			folders={folders}
			preview={preview}
			semanticAvailable={!semanticUnavailable}
			clauseFields={SUPPORTED_CLAUSE_FIELDS}
			clauseEdit={clauseEdit}
			onStartAddClause={startAddClause}
			onStartEditClause={startEditClause}
			onRemoveClause={removeClause}
			onChangeDraftField={changeDraftField}
			onChangeDraftValue={changeDraftValue}
			onSubmitClause={submitClause}
			onCancelClause={() => setClauseEdit(undefined)}
			onAddWiden={addWiden}
			onRemoveWiden={removeWiden}
			onChangeMatchOperator={changeMatchOperator}
			onChangeMove={changeMove}
			onChangeScope={changeScope}
			onChangeName={changeName}
			onChangeUntil={changeUntil}
			onCommit={commit}
			onCancel={onClose}
		/>
	);
}

function JobProgress({
	progress,
	isDone,
	senderFallback,
	onClose,
}: {
	progress: ReturnType<typeof useOrganizeJob>["progress"];
	isDone: boolean;
	senderFallback: boolean;
	onClose: () => void;
}) {
	const failed = progress.state === "Failed";
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
			{!isDone ? (
				<Loader2 className="size-8 animate-spin text-accent-2" />
			) : failed ? (
				<span className="text-sm font-semibold text-danger">
					Organize failed
				</span>
			) : (
				<CheckCircle2 className="size-8 text-positive" />
			)}

			{!isDone && (
				<p className="text-sm font-medium text-fg">
					{senderFallback
						? "Organizing mail from these senders…"
						: "Organizing similar mail…"}
				</p>
			)}

			{isDone && !failed && (
				<div className="text-sm text-fg">
					<p className="font-medium">Done</p>
					<p className="mt-1 text-xs text-fg-muted">
						{progress.appliedCount} of {progress.matchedCount} moved
						{progress.failedCount > 0
							? ` · ${progress.failedCount} failed`
							: ""}
						.
					</p>
				</div>
			)}

			{isDone && failed && (
				<p className="max-w-xs text-xs text-fg-muted">
					{progress.errorMessage || "Something went wrong. Please try again."}
				</p>
			)}

			{isDone && (
				<Button variant="primary" onClick={onClose} className="mt-2">
					Done
				</Button>
			)}
		</div>
	);
}

function SavingState() {
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
			<Loader2 className="size-8 animate-spin text-accent-2" />
			<p className="text-sm font-medium text-fg">Saving rule…</p>
		</div>
	);
}

function FilterSaved({ onClose }: { onClose: () => void }) {
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
			<CheckCircle2 className="size-8 text-positive" />
			<p className="text-sm font-medium text-fg">Filter saved</p>
			<p className="max-w-xs text-xs text-fg-muted">
				You can see it, and when it expires, under Settings › Filters.
			</p>
			<Button variant="primary" onClick={onClose} className="mt-2">
				Done
			</Button>
		</div>
	);
}

function CommitError({
	onRetry,
	onClose,
}: {
	onRetry: () => void;
	onClose: () => void;
}) {
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
			<p className="text-sm font-medium text-danger">Couldn't save the rule</p>
			<p className="max-w-xs text-xs text-fg-muted">Please try again.</p>
			<div className="mt-2 flex gap-2">
				<Button variant="primary" onClick={onRetry}>
					Try again
				</Button>
				<Button variant="ghost" onClick={onClose}>
					Not now
				</Button>
			</div>
		</div>
	);
}
