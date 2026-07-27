import {
	Fragment,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { isAbortError } from "../lib/abort.js";
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
	type LabelOption,
	type MatchOperator,
	matchJoinWord,
	matchModeHint,
	matchModeLabel,
	matchOperatorLabel,
	type PreviewCount,
	type RuleMatchMode,
	type RuleScope,
} from "./filter-rule.js";
import { Input } from "./input.js";
import { LabelChip } from "./label-chip.js";
import { SegmentedControl } from "./segmented-control.js";
import { Select } from "./select.js";
import type { Suggestion } from "./suggest-list.js";

export interface ClauseEditState {
	mode: "add" | "edit";
	/** Present when amending an existing clause; absent when adding a new one. */
	clauseId?: string;
	draft: ClauseDraft;
}

export interface FilterRuleEditorProps {
	rule: FilterRule;
	folders: FolderOption[];
	/** The account's labels the apply-label action can target (issue #26). */
	labels?: LabelOption[];
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
	 * What the rule matches on, when the surface lets the user choose (RFC 038
	 * D2/D3). Present only where both modes are reachable — the Organize flow on
	 * a deployment that can serve the widen. Absent leaves the mode control off
	 * entirely, which is every other entry point onto this editor.
	 */
	matchMode?: RuleMatchMode;
	onChangeMatchMode?: (mode: RuleMatchMode) => void;
	/**
	 * The clause fields the add/edit picker offers, in menu order. Defaults to the
	 * whole vocabulary; a consumer narrows it to the fields its deployment can
	 * match, so the editor never offers a clause the backend cannot evaluate.
	 */
	clauseFields?: ClauseField[];
	/**
	 * Whether the semantic anchor is fixed and cannot be added, removed, or
	 * repointed (RFC 038 D6, reader #266). True for an existing, persisted
	 * filter — the update endpoint carries no anchor field at all, so
	 * repointing one would silently change what a saved filter matches with
	 * nothing visible changing, and that deserves a new filter instead. The
	 * widen chip renders display-only (no remove affordance regardless of
	 * `onRemoveWiden`) and carries a one-line note explaining why.
	 *
	 * Scope and expiry are NOT covered by this flag — they stay editable even
	 * on an existing filter (reader #266). The only other thing this locks is
	 * the "Just once" scope option, meaningless for an already-persisted
	 * filter, which is dropped from the scope toggle.
	 */
	anchorLocked?: boolean;
	/**
	 * Values worth offering for the clause being edited — the consumer derives
	 * them from the field and what has been typed so far (known senders for
	 * `From`, their domains for `FromDomain`). Absent leaves the value a plain
	 * text box, which is what a surface with nothing to suggest should be.
	 */
	clauseSuggestions?: readonly Suggestion[];
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
	 * Create a new destination folder from within the editor. Given a folder name
	 * and an abort signal, resolves to the created folder once the mail server
	 * confirms it. The editor aborts the signal on unmount or cancel. When absent,
	 * the "New folder…" option is not offered — the editor stays data-agnostic, so
	 * stories and consumers without wiring render unchanged.
	 */
	onCreateFolder?: (
		name: string,
		signal?: AbortSignal,
	) => Promise<FolderOption>;
	onChangeLabel?: (labelId: string) => void;
	/**
	 * Create a new label from within the editor (issue #26). Given a label
	 * name, resolves to the created label once the backend has saved it. When
	 * absent, the "New label…" option is not offered.
	 */
	onCreateLabel?: (name: string) => Promise<LabelOption>;
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

const matchModeOptions: { value: RuleMatchMode; label: string }[] = [
	{ value: "similar", label: matchModeLabel("similar") },
	{ value: "properties", label: matchModeLabel("properties") },
];

const scopeOptions: { value: RuleScope; label: string }[] = [
	{ value: "once", label: "Just once" },
	{ value: "standing", label: "Keep doing this" },
	{ value: "until", label: "Until a date" },
];

const CREATE_FOLDER_VALUE = "__filter_create_folder__";
const CREATE_LABEL_VALUE = "__filter_create_label__";

/**
 * The move-to destination select, plus an inline "New folder…" affordance when
 * the consumer wires `onCreateFolder`. Selecting the create option reveals a
 * name field; on resolve the new folder is added to the local option set (so it
 * is selectable even before the caller's folder list refetches) and picked as
 * the destination. Without `onCreateFolder` this is the bare select.
 *
 * The destination is a dependent write: the filter this editor commits binds to
 * the folder, so `onCreateFolder` resolves only once the folder is confirmed on
 * the mail server, not when the create is merely queued. The pending state holds
 * "Creating folder…" for that whole wait, and a create that fails or never
 * confirms rejects with its own message here — the folder is never selected, so
 * the caller cannot commit a filter against a folder that does not exist.
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
	onCreateFolder?: (
		name: string,
		signal?: AbortSignal,
	) => Promise<FolderOption>;
}) {
	const [creating, setCreating] = useState(false);
	const [name, setName] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const [createdFolders, setCreatedFolders] = useState<FolderOption[]>([]);
	// The create waits for the mail server to confirm the folder; abort it on
	// unmount or cancel so a late confirmation never binds the destination after
	// the editor is gone or the sub-form dismissed.
	const createAbort = useRef<AbortController | null>(null);
	useEffect(() => () => createAbort.current?.abort(), []);

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
		createAbort.current?.abort();
		const controller = new AbortController();
		createAbort.current = controller;
		onCreateFolder(trimmed, controller.signal)
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
			.catch((error: unknown) => {
				if (isAbortError(error)) return;
				setError(
					error instanceof Error
						? error.message
						: "Couldn't create that folder. Please try again.",
				);
				setPending(false);
			});
	};

	const cancel = () => {
		createAbort.current?.abort();
		setCreating(false);
		setName("");
		setError(undefined);
		setPending(false);
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
							{pending ? "Creating folder…" : "Create folder"}
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

/**
 * The apply-label select, plus an inline "New label…" affordance when the
 * consumer wires `onCreateLabel` (issue #26). Mirrors `MoveDestinationField`:
 * selecting the create option reveals a name field, and the created label is
 * added to the local option set and picked immediately, before the caller's
 * label list refetches.
 */
function LabelDestinationField({
	labels,
	value,
	onChangeLabel,
	onCreateLabel,
}: {
	labels: LabelOption[];
	value: string;
	onChangeLabel?: (labelId: string) => void;
	onCreateLabel?: (name: string) => Promise<LabelOption>;
}) {
	const [creating, setCreating] = useState(false);
	const [name, setName] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const [createdLabels, setCreatedLabels] = useState<LabelOption[]>([]);

	const options = useMemo(() => {
		const known = new Set(labels.map((label) => label.id));
		return [
			...labels,
			...createdLabels.filter((label) => !known.has(label.id)),
		];
	}, [labels, createdLabels]);

	const selected = options.find((label) => label.id === value);

	const handleSelectChange = (next: string) => {
		if (next === CREATE_LABEL_VALUE) {
			setError(undefined);
			setCreating(true);
			return;
		}
		onChangeLabel?.(next);
	};

	const submit = () => {
		if (!onCreateLabel) return;
		const trimmed = name.trim();
		if (trimmed === "") return;
		setPending(true);
		setError(undefined);
		onCreateLabel(trimmed)
			.then((label) => {
				setCreatedLabels((prev) =>
					prev.some((entry) => entry.id === label.id) ? prev : [...prev, label],
				);
				onChangeLabel?.(label.id);
				setCreating(false);
				setName("");
				setPending(false);
			})
			.catch((error: unknown) => {
				setError(
					error instanceof Error
						? error.message
						: "Couldn't create that label. Please try again.",
				);
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
			<div className="flex items-center gap-2">
				<Select
					aria-label="Label to apply"
					value={value}
					onChange={(event) => handleSelectChange(event.target.value)}
					className="flex-1"
				>
					<option value="">No label</option>
					{options.map((label) => (
						<option key={label.id} value={label.id}>
							{label.name}
						</option>
					))}
					{onCreateLabel && (
						<option value={CREATE_LABEL_VALUE}>＋ New label…</option>
					)}
				</Select>
				{selected && (
					<LabelChip label={{ ...selected, labelId: selected.id }} />
				)}
			</div>
			{creating && (
				<div className="space-y-2 rounded-md border border-line bg-surface-sunken p-2">
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="Label name"
						aria-label="New label name"
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
							{pending ? "Creating…" : "Create label"}
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
	labels = [],
	preview,
	notice,
	semanticAvailable = false,
	matchMode,
	onChangeMatchMode,
	clauseFields,
	anchorLocked = false,
	clauseSuggestions,
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
	onChangeLabel,
	onCreateLabel,
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
	// A persisted filter is always Standing or Temporary — "once" was never a
	// scope a saved row could hold, so an existing filter's editor never offers
	// it (reader #266).
	const availableScopeOptions = anchorLocked
		? scopeOptions.filter((option) => option.value !== "once")
		: scopeOptions;

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

				{matchMode && (
					<section className="space-y-1.5">
						<p className="text-xs font-medium text-fg-muted">Match on</p>
						<SegmentedControl
							name="rule-match-mode"
							size="sm"
							aria-label="What the rule matches on"
							options={matchModeOptions}
							value={matchMode}
							onChange={(value) => onChangeMatchMode?.(value)}
						/>
						<p className="text-2xs text-fg-subtle">
							{matchModeHint(matchMode)}
						</p>
					</section>
				)}

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
								<WidenChip
									widen={rule.widen}
									onRemove={anchorLocked ? undefined : onRemoveWiden}
								/>
							</>
						)}

						{!clauseEdit && (
							<AddChipButton label="Add clause" onClick={onStartAddClause} />
						)}
						{!rule.widen &&
							!anchorLocked &&
							semanticAvailable &&
							matchMode !== "properties" &&
							!clauseEdit && (
								<AddChipButton label="…and similar" onClick={onAddWiden} />
							)}
					</div>

					{clauseEdit && (
						<ClauseEditor
							draft={clauseEdit.draft}
							mode={clauseEdit.mode}
							fields={clauseFields}
							suggestions={clauseSuggestions}
							onChangeField={onChangeDraftField}
							onChangeValue={onChangeDraftValue}
							onSubmit={onSubmitClause}
							onCancel={onCancelClause}
						/>
					)}

					{anchorLocked && rule.widen && (
						<p className="text-2xs text-fg-subtle">
							This filter's similar-mail match is fixed to the message it was
							created from — create a new filter to change it.
						</p>
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
				</section>

				<section className="space-y-2">
					<p className="text-xs font-medium text-fg-muted">Apply a label</p>
					<LabelDestinationField
						labels={labels}
						value={rule.labelId ?? ""}
						onChangeLabel={onChangeLabel}
						onCreateLabel={onCreateLabel}
					/>
				</section>

				<section className="space-y-2">
					<p className="text-xs font-medium text-fg-muted">How long</p>
					<SegmentedControl
						name="rule-scope"
						size="sm"
						aria-label="Rule scope"
						options={availableScopeOptions}
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
