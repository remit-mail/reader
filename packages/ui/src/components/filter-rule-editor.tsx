import { Fragment, type ReactNode, useMemo, useState } from "react";
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
	 * Content rendered above the clause chips — the filter-from-search conversion
	 * notice (RFC 038 D5) uses it to state what the search carried that the rule
	 * cannot. Absent on the Organize surface, which converts nothing.
	 */
	notice?: ReactNode;
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
	/**
	 * Render the scope and expiry read-only (RFC 038 D6). A persisted filter's
	 * scope, expiry, and semantic anchor are fixed at creation — the update
	 * endpoint carries none of them — so editing a filter shows them as a static
	 * summary with a note rather than live controls that would silently discard
	 * the change (reader #266 tracks lifting this). The name and the literal
	 * predicate stay editable.
	 */
	lifecycleLocked?: boolean;
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
	/**
	 * Create a new destination folder from within the editor. Given a folder
	 * name, resolves to the created folder once the backend has queued it. When
	 * absent, the "New folder…" option is not offered — the editor stays
	 * data-agnostic, so stories and consumers without wiring render unchanged.
	 */
	onCreateFolder?: (name: string) => Promise<FolderOption>;
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

const CREATE_FOLDER_VALUE = "__filter_create_folder__";

/**
 * The move-to destination select, plus an inline "New folder…" affordance when
 * the consumer wires `onCreateFolder`. Selecting the create option reveals a
 * name field; on resolve the new folder is added to the local option set (so it
 * is selectable even before the caller's folder list refetches) and picked as
 * the destination. Without `onCreateFolder` this is the bare select.
 */
function MoveDestinationField({
	folders,
	value,
	onChangeMove,
	onCreateFolder,
}: {
	folders: FolderOption[];
	value: string;
	onChangeMove?: (mailboxId: string) => void;
	onCreateFolder?: (name: string) => Promise<FolderOption>;
}) {
	const [creating, setCreating] = useState(false);
	const [name, setName] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const [createdFolders, setCreatedFolders] = useState<FolderOption[]>([]);

	const options = useMemo(() => {
		const known = new Set(folders.map((folder) => folder.id));
		return [
			...folders,
			...createdFolders.filter((folder) => !known.has(folder.id)),
		];
	}, [folders, createdFolders]);

	const handleSelectChange = (next: string) => {
		if (next === CREATE_FOLDER_VALUE) {
			setError(undefined);
			setCreating(true);
			return;
		}
		onChangeMove?.(next);
	};

	const submit = () => {
		if (!onCreateFolder) return;
		const trimmed = name.trim();
		if (trimmed === "") return;
		setPending(true);
		setError(undefined);
		onCreateFolder(trimmed)
			.then((folder) => {
				setCreatedFolders((prev) =>
					prev.some((entry) => entry.id === folder.id)
						? prev
						: [...prev, folder],
				);
				onChangeMove?.(folder.id);
				setCreating(false);
				setName("");
				setPending(false);
			})
<<<<<<< HEAD
			.catch(() => {
				setError("Couldn't create that folder. Please try again.");
=======
			.catch((error: unknown) => {
				setError(
					error instanceof Error
						? error.message
						: "Couldn't create that folder. Please try again.",
				);
>>>>>>> origin/main
				setPending(false);
			});
	};

	const cancel = () => {
		setCreating(false);
		setName("");
		setError(undefined);
	};

	return (
		<div className="space-y-2">
			<Select
				aria-label="Destination folder"
				value={value}
				onChange={(event) => handleSelectChange(event.target.value)}
			>
				<option value="">Choose a folder…</option>
				{options.map((folder) => (
					<option key={folder.id} value={folder.id}>
						{folder.label}
					</option>
				))}
				{onCreateFolder && (
					<option value={CREATE_FOLDER_VALUE}>＋ New folder…</option>
				)}
			</Select>
			{creating && (
				<div className="space-y-2 rounded-md border border-line bg-surface-sunken p-2">
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="Folder name"
						aria-label="New folder name"
						disabled={pending}
						autoFocus
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								submit();
							}
							if (event.key === "Escape") {
								event.preventDefault();
								cancel();
							}
						}}
					/>
					{error && (
						<p className="text-2xs text-danger" role="alert">
							{error}
						</p>
					)}
					<div className="flex gap-2">
						<Button
							variant="primary"
							size="sm"
							onClick={submit}
							disabled={pending || name.trim() === ""}
						>
							{pending ? "Creating…" : "Create folder"}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={cancel}
							disabled={pending}
						>
							Cancel
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

export function FilterRuleEditor({
	rule,
	folders,
	preview,
	notice,
	semanticAvailable = false,
	clauseFields,
	lifecycleLocked = false,
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
	onCreateFolder,
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
				{notice}
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
					<MoveDestinationField
						folders={folders}
						value={rule.moveMailboxId ?? ""}
						onChangeMove={onChangeMove}
						onCreateFolder={onCreateFolder}
					/>
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
					{lifecycleLocked ? (
						<p className="text-xs text-fg">
							{rule.scope === "until"
								? `Until ${rule.until ?? ""}`
								: "Always — runs on matching mail"}
						</p>
					) : (
						<SegmentedControl
							name="rule-scope"
							size="sm"
							aria-label="Rule scope"
							options={scopeOptions}
							value={rule.scope}
							onChange={(value) => onChangeScope?.(value)}
						/>
					)}
					{needsName && (
						<Input
							value={rule.name ?? ""}
							onChange={(e) => onChangeName?.(e.target.value)}
							placeholder="Name this rule (e.g. Receipts)"
							aria-label="Rule name"
							className="w-full"
						/>
					)}
					{!lifecycleLocked && rule.scope === "until" && (
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
					{lifecycleLocked && (
						<p className="text-2xs text-fg-subtle">
							{rule.widen
								? "The scope, expiry, and similar-mail match are set when a filter is created."
								: "The scope and expiry are set when a filter is created."}
						</p>
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
