import { Fragment, type ReactNode } from "react";
import { BottomSheet } from "./bottom-sheet.js";
import { Button } from "./button.js";
import { Dialog } from "./dialog.js";
import {
	AddChipButton,
	ClauseChip,
	type ClauseDraft,
	ClauseEditor,
	WidenChip,
} from "./filter-clause-chip.js";
import { FilterPreviewCount } from "./filter-preview-count.js";
import {
	type ClauseField,
	commitBlockedReason,
	commitLabel,
	type FilterRule,
	type FolderOption,
	type MatchOperator,
	matchJoinWord,
	matchOperatorLabel,
	type PreviewCount,
	type RuleScope,
} from "./filter-rule.js";
import { Input } from "./input.js";
import { SegmentedControl } from "./segmented-control.js";
import { Select } from "./select.js";

export interface ClauseEditState {
	mode: "add" | "edit";
	/** Present when amending an existing clause; absent when adding a new one. */
	clauseId?: string;
	draft: ClauseDraft;
}

export interface FilterRuleEditorProps {
	rule: FilterRule;
	folders: FolderOption[];
	preview: PreviewCount;
	/**
	 * Whether the deployment can serve the semantic widen (RFC 038 D4). When
	 * false the "…and anything similar" chip is never offered — an already-present
	 * widen still renders, marked inactive.
	 */
	semanticAvailable?: boolean;
	/**
	 * The clause fields the add/edit picker offers, in menu order. Defaults to the
	 * whole vocabulary; a consumer narrows it to the fields its deployment can
	 * match, so the editor never offers a clause the backend cannot evaluate.
	 */
	clauseFields?: ClauseField[];
	/** The inline clause form, when adding or editing a clause. */
	clauseEdit?: ClauseEditState;
	onStartAddClause?: () => void;
	onStartEditClause?: (clauseId: string) => void;
	onRemoveClause?: (clauseId: string) => void;
	onChangeDraftField?: (field: ClauseField) => void;
	onChangeDraftValue?: (value: string) => void;
	onSubmitClause?: () => void;
	onCancelClause?: () => void;
	onAddWiden?: () => void;
	onRemoveWiden?: () => void;
	onChangeMatchOperator?: (operator: MatchOperator) => void;
	onChangeMove?: (mailboxId: string) => void;
	onChangeScope?: (scope: RuleScope) => void;
	onChangeName?: (name: string) => void;
	onChangeUntil?: (date: string) => void;
	onCommit?: () => void;
	onCancel?: () => void;
}

const matchOptions: { value: MatchOperator; label: string }[] = [
	{ value: "all", label: matchOperatorLabel("all") },
	{ value: "any", label: matchOperatorLabel("any") },
];

const scopeOptions: { value: RuleScope; label: string }[] = [
	{ value: "once", label: "Just once" },
	{ value: "standing", label: "Keep doing this" },
	{ value: "until", label: "Until a date" },
];

export function FilterRuleEditor({
	rule,
	folders,
	preview,
	semanticAvailable = false,
	clauseFields,
	clauseEdit,
	onStartAddClause,
	onStartEditClause,
	onRemoveClause,
	onChangeDraftField,
	onChangeDraftValue,
	onSubmitClause,
	onCancelClause,
	onAddWiden,
	onRemoveWiden,
	onChangeMatchOperator,
	onChangeMove,
	onChangeScope,
	onChangeName,
	onChangeUntil,
	onCommit,
	onCancel,
}: FilterRuleEditorProps) {
	const activeWiden = rule.widen && !rule.widen.inactive ? 1 : 0;
	const matcherCount = rule.clauses.length + activeWiden;
	const showOperator = matcherCount >= 2;
	const join = matchJoinWord(rule.matchOperator);
	const blockedReason = commitBlockedReason(rule, preview);
	const needsName = rule.scope === "standing" || rule.scope === "until";

	return (
		<div className="flex min-h-0 flex-col">
			<div className="border-b border-line px-5 py-3">
				<h2 className="text-sm font-semibold text-fg">Filter rule</h2>
				<p className="mt-0.5 text-xs text-fg-muted">
					These chips are the whole rule — what you see is what applies.
				</p>
			</div>

			<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
				<section className="space-y-3">
					<div className="flex flex-wrap items-center gap-1.5">
						{rule.clauses.map((clause, index) => (
							<Fragment key={clause.id}>
								{index > 0 && (
									<span className="text-2xs font-medium uppercase text-fg-subtle">
										{join}
									</span>
								)}
								<ClauseChip
									clause={clause}
									onEdit={() => onStartEditClause?.(clause.id)}
									onRemove={() => onRemoveClause?.(clause.id)}
								/>
							</Fragment>
						))}

						{rule.widen && (
							<>
								{rule.clauses.length > 0 && !rule.widen.inactive && (
									<span className="text-2xs font-medium uppercase text-fg-subtle">
										{join}
									</span>
								)}
								<WidenChip widen={rule.widen} onRemove={onRemoveWiden} />
							</>
						)}

						{!clauseEdit && (
							<AddChipButton label="Add clause" onClick={onStartAddClause} />
						)}
						{!rule.widen && semanticAvailable && !clauseEdit && (
							<AddChipButton label="…and similar" onClick={onAddWiden} />
						)}
					</div>

					{clauseEdit && (
						<ClauseEditor
							draft={clauseEdit.draft}
							mode={clauseEdit.mode}
							fields={clauseFields}
							onChangeField={onChangeDraftField}
							onChangeValue={onChangeDraftValue}
							onSubmit={onSubmitClause}
							onCancel={onCancelClause}
						/>
					)}

					{showOperator && (
						<div className="flex items-center gap-2">
							<span className="text-xs text-fg-muted">Match</span>
							<SegmentedControl
								name="match-operator"
								size="sm"
								aria-label="Match operator"
								options={matchOptions}
								value={rule.matchOperator}
								onChange={(value) => onChangeMatchOperator?.(value)}
							/>
						</div>
					)}
				</section>

				<section className="space-y-2">
					<p className="text-xs font-medium text-fg-muted">Move matches to</p>
					<Select
						aria-label="Destination folder"
						value={rule.moveMailboxId ?? ""}
						onChange={(e) => onChangeMove?.(e.target.value)}
					>
						<option value="">Choose a folder…</option>
						{folders.map((folder) => (
							<option key={folder.id} value={folder.id}>
								{folder.label}
							</option>
						))}
					</Select>
					<div className="flex items-center gap-2 pt-0.5">
						<span className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-2 py-0.5 text-2xs font-medium text-fg-muted">
							label them…
						</span>
						<span className="text-2xs text-fg-subtle">
							Labeling isn't available yet — arrives with mail-labeling (RFC
							031).
						</span>
					</div>
				</section>

				<section className="space-y-2">
					<p className="text-xs font-medium text-fg-muted">How long</p>
					<SegmentedControl
						name="rule-scope"
						size="sm"
						aria-label="Rule scope"
						options={scopeOptions}
						value={rule.scope}
						onChange={(value) => onChangeScope?.(value)}
					/>
					{needsName && (
						<Input
							value={rule.name ?? ""}
							onChange={(e) => onChangeName?.(e.target.value)}
							placeholder="Name this rule (e.g. Receipts)"
							aria-label="Rule name"
							className="w-full"
						/>
					)}
					{rule.scope === "until" && (
						<div className="flex items-center gap-2 text-xs text-fg-muted">
							<span>Until</span>
							<Input
								type="date"
								value={rule.until ?? ""}
								onChange={(e) => onChangeUntil?.(e.target.value)}
								aria-label="Expiry date"
								className="flex-1"
							/>
						</div>
					)}
				</section>

				<div className="border-t border-line pt-3">
					<FilterPreviewCount preview={preview} />
				</div>
			</div>

			<div className="space-y-2 border-t border-line px-5 py-3">
				{blockedReason && (
					<p className="text-xs text-fg-subtle" role="status">
						{blockedReason}
					</p>
				)}
				<Button
					variant="primary"
					onClick={onCommit}
					disabled={blockedReason !== undefined}
					className="w-full"
				>
					{commitLabel(rule.scope)}
				</Button>
				<Button variant="ghost" onClick={onCancel} className="w-full">
					Not now
				</Button>
			</div>
		</div>
	);
}

export interface FilterRuleDialogProps extends FilterRuleEditorProps {
	open: boolean;
	onClose: () => void;
}

/** Desktop home for the rule editor — the centered modal (RFC 038 D1). */
export function FilterRuleDialog({
	open,
	onClose,
	...editor
}: FilterRuleDialogProps) {
	if (!open) return null;
	return (
		<Dialog open={open} onClose={onClose} title="Filter rule">
			<FilterRuleEditor {...editor} onCancel={onClose} />
		</Dialog>
	);
}

export interface FilterRuleSheetProps extends FilterRuleEditorProps {
	open: boolean;
	onClose: () => void;
}

/** Mobile home for the rule editor — the bottom sheet (RFC 038 D1). */
export function FilterRuleSheet({
	open,
	onClose,
	...editor
}: FilterRuleSheetProps): ReactNode {
	return (
		<BottomSheet
			open={open}
			onClose={onClose}
			dismissLabel="Dismiss filter rule"
		>
			<FilterRuleEditor {...editor} onCancel={onClose} />
		</BottomSheet>
	);
}
