import type { RemitImapFilterResponse } from "@remit/api-http-client/types.gen.ts";
import {
	Button,
	type ClauseEditState,
	type ClauseField,
	type FilterRule,
	FilterRuleEditor,
	type FolderOption,
	type LabelOption,
	type MatchOperator,
	previewCountSummary,
	type RuleScope,
} from "@remit/ui";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useCreateMailbox } from "@/hooks/useCreateMailbox";
import { useCreateLabel } from "@/hooks/useLabels";
import { useOrganizeJob } from "@/hooks/useOrganizeJob";
import { useRulePreview } from "@/hooks/useRulePreview";
import { useUpdateFilter } from "@/hooks/useUpdateFilter";
import {
	buildUpdateFilterInput,
	filterToRule,
	ruleChangesPredicateOrAction,
	ruleChangesScopeOrExpiry,
} from "@/lib/organize/filter-edit-model";
import {
	normalizeClauseValue,
	rulePredicate,
	ruleToDraft,
	SUPPORTED_CLAUSE_FIELDS,
} from "@/lib/organize/rule-model";

interface FilterEditorProps {
	accountId: string;
	filter: RemitImapFilterResponse;
	folders: FolderOption[];
	labels: LabelOption[];
	/**
	 * This deployment ships no vector pipeline, so a semantic anchor cannot be
	 * evaluated (RFC 038 D4). The filter's widen chip lists inactive and the rule
	 * matches by its literal clauses only.
	 */
	semanticUnavailable?: boolean;
	onClose: () => void;
}

/**
 * Editing a standing filter in the same chip editor the Organize surface uses
 * (RFC 038 D6). The row's persisted rule opens in the editor — clauses, match
 * operator, move action, scope, expiry, and the semantic anchor as a widen
 * chip. Saving a predicate, action, scope, or expiry change bumps
 * `ruleChangedAt` and offers, never runs, a re-back-apply over existing mail;
 * a cosmetic rename does neither (RFC 034 Decision 3.2, reader #266). The
 * re-apply carries exactly the previewed predicate and is held behind the
 * same settled-count commit gate as creation. The anchor stays fixed at
 * creation regardless — repointing it would silently change what the filter
 * matches, which deserves a new filter instead.
 */
export function FilterEditor({
	accountId,
	filter,
	folders,
	labels,
	semanticUnavailable = false,
	onClose,
}: FilterEditorProps) {
	const original = useMemo(
		() => filterToRule(filter, semanticUnavailable),
		[filter, semanticUnavailable],
	);
	const [rule, setRule] = useState<FilterRule>(original);
	const [clauseEdit, setClauseEdit] = useState<ClauseEditState | undefined>();
	const [offerReapply, setOfferReapply] = useState(false);
	const nextClauseId = useRef(0);

	const preview = useRulePreview(accountId, rulePredicate(rule));
	const update = useUpdateFilter(accountId, filter.filterId);
	const organizeJob = useOrganizeJob(accountId);
	const { createFolder } = useCreateMailbox(accountId);
	const { createLabel } = useCreateLabel(accountId);
	const onCreateLabel = async (name: string): Promise<LabelOption> => {
		const label = await createLabel(name);
		return { id: label.labelId, name: label.name, color: label.color };
	};

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
		const field = clauseEdit.draft.field;
		const value = normalizeClauseValue(field, clauseEdit.draft.value);
		if (value === "") return;
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
					{ id: `new-${nextClauseId.current}`, field, value },
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

	const changeMatchOperator = (matchOperator: MatchOperator) =>
		setRule((current) => ({ ...current, matchOperator }));

	const changeMove = (mailboxId: string) =>
		setRule((current) => ({
			...current,
			moveMailboxId: mailboxId || undefined,
		}));

	const changeLabel = (labelId: string) =>
		setRule((current) => ({
			...current,
			labelId: labelId || undefined,
		}));

	const changeName = (name: string) =>
		setRule((current) => ({ ...current, name }));

	const changeScope = (scope: RuleScope) =>
		setRule((current) => ({
			...current,
			scope,
			until: scope === "until" ? current.until : undefined,
		}));

	const changeUntil = (until: string) =>
		setRule((current) => ({ ...current, until }));

	const commit = () => {
		const rulesChanged =
			ruleChangesPredicateOrAction(rule, original) ||
			ruleChangesScopeOrExpiry(rule, original);
		const body = buildUpdateFilterInput(rule, original);
		if (Object.keys(body).length === 0) {
			onClose();
			return;
		}
		setOfferReapply(rulesChanged);
		update.updateFilter(body);
	};

	const reapply = () => organizeJob.start(ruleToDraft(rule));

	if (organizeJob.isStarting || organizeJob.isRunning || organizeJob.isDone) {
		return (
			<ReapplyProgress
				progress={organizeJob.progress}
				isDone={organizeJob.isDone}
				onClose={onClose}
			/>
		);
	}

	if (update.isPending) return <SavingState />;

	if (update.isError) {
		return <SaveError onRetry={update.reset} onClose={onClose} />;
	}

	if (update.isSuccess) {
		if (!offerReapply) return <FilterUpdated onClose={onClose} />;
		return (
			<ReapplyOffer
				preview={previewCountSummary(preview)}
				blocked={preview.status !== "ready" || preview.stale === true}
				onReapply={reapply}
				onClose={onClose}
			/>
		);
	}

	return (
		<FilterRuleEditor
			rule={rule}
			folders={folders}
			labels={labels}
			preview={preview}
			// The update endpoint carries no anchor field at all (reader #266), so a
			// widen can be neither added nor removed here: the "…and similar" add is
			// never offered, and the existing chip is display-only (no
			// onRemoveWiden — anchorLocked enforces that regardless).
			// `semanticUnavailable` only drives the chip's inactive styling via
			// `filterToRule`.
			semanticAvailable={false}
			clauseFields={SUPPORTED_CLAUSE_FIELDS}
			anchorLocked
			clauseEdit={clauseEdit}
			onStartAddClause={startAddClause}
			onStartEditClause={startEditClause}
			onRemoveClause={removeClause}
			onChangeDraftField={changeDraftField}
			onChangeDraftValue={changeDraftValue}
			onSubmitClause={submitClause}
			onCancelClause={() => setClauseEdit(undefined)}
			onChangeMatchOperator={changeMatchOperator}
			onChangeMove={changeMove}
			onCreateFolder={createFolder}
			onChangeLabel={changeLabel}
			onCreateLabel={onCreateLabel}
			onChangeName={changeName}
			onChangeScope={changeScope}
			onChangeUntil={changeUntil}
			onCommit={commit}
			onCancel={onClose}
		/>
	);
}

function SavingState() {
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
			<Loader2 className="size-8 animate-spin text-accent-2" />
			<p className="text-sm font-medium text-fg">Saving changes…</p>
		</div>
	);
}

function FilterUpdated({ onClose }: { onClose: () => void }) {
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
			<CheckCircle2 className="size-8 text-positive" />
			<p className="text-sm font-medium text-fg">Filter updated</p>
			<Button variant="primary" onClick={onClose} className="mt-2">
				Done
			</Button>
		</div>
	);
}

function ReapplyOffer({
	preview,
	blocked,
	onReapply,
	onClose,
}: {
	preview: string;
	blocked: boolean;
	onReapply: () => void;
	onClose: () => void;
}) {
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
			<CheckCircle2 className="size-8 text-positive" />
			<p className="text-sm font-medium text-fg">Rule saved</p>
			<p className="max-w-xs text-xs text-fg-muted">
				New mail follows the rule automatically. {preview} — move the mail
				already in your mailbox too?
			</p>
			<div className="mt-2 flex gap-2">
				<Button variant="primary" onClick={onReapply} disabled={blocked}>
					Move existing mail
				</Button>
				<Button variant="ghost" onClick={onClose}>
					Not now
				</Button>
			</div>
		</div>
	);
}

function ReapplyProgress({
	progress,
	isDone,
	onClose,
}: {
	progress: ReturnType<typeof useOrganizeJob>["progress"];
	isDone: boolean;
	onClose: () => void;
}) {
	const failed = progress.state === "Failed";
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
			{!isDone ? (
				<Loader2 className="size-8 animate-spin text-accent-2" />
			) : failed ? (
				<span className="text-sm font-semibold text-danger">Move failed</span>
			) : (
				<CheckCircle2 className="size-8 text-positive" />
			)}

			{!isDone && (
				<p className="text-sm font-medium text-fg">Moving existing mail…</p>
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

function SaveError({
	onRetry,
	onClose,
}: {
	onRetry: () => void;
	onClose: () => void;
}) {
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
			<p className="text-sm font-medium text-danger">Couldn't save changes</p>
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
