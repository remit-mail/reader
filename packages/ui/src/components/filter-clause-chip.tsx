import { Plus, X } from "lucide-react";
import { cn } from "../lib/cn.js";
import { useSuggestList } from "../lib/use-suggest-list.js";
import { Button } from "./button.js";
import {
	type ClauseField,
	clauseFieldHint,
	clauseFieldLabel,
	clauseFieldOrder,
	type RuleClause,
} from "./filter-rule.js";
import { Input } from "./input.js";
import { Select } from "./select.js";
import { type Suggestion, SuggestList } from "./suggest-list.js";

const chipShell =
	"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs";

export interface ClauseChipProps {
	clause: RuleClause;
	onEdit?: () => void;
	onRemove?: () => void;
}

export function ClauseChip({ clause, onEdit, onRemove }: ClauseChipProps) {
	return (
		<span
			className={cn(
				chipShell,
				clause.derived
					? "border-dashed border-line-strong bg-surface-sunken"
					: "border-line bg-surface",
			)}
		>
			<button
				type="button"
				onClick={onEdit}
				aria-label={`Edit ${clauseFieldLabel(clause.field)} clause`}
				className="flex items-center gap-1 text-left"
			>
				<span className="font-medium text-fg-muted">
					{clauseFieldLabel(clause.field)}
				</span>
				<span className="text-fg">{clause.value}</span>
			</button>
			{clause.derived && (
				<span className="text-2xs text-fg-subtle">from sender</span>
			)}
			{onRemove && (
				<button
					type="button"
					onClick={onRemove}
					aria-label={`Remove ${clauseFieldLabel(clause.field)} clause`}
					className="flex size-4 items-center justify-center rounded-full text-fg-subtle hover:bg-surface-sunken hover:text-fg-muted"
				>
					<X className="size-3" />
				</button>
			)}
		</span>
	);
}

export interface AddChipButtonProps {
	label: string;
	onClick?: () => void;
}

export function AddChipButton({ label, onClick }: AddChipButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				chipShell,
				"border-dashed border-line-strong text-fg-muted hover:border-accent-2 hover:text-accent-2",
			)}
		>
			<Plus className="size-3" aria-hidden="true" />
			{label}
		</button>
	);
}

export interface ClauseDraft {
	field: ClauseField;
	value: string;
}

export interface ClauseEditorProps {
	draft: ClauseDraft;
	/** `add` seeds a new clause; `edit` amends an existing one. */
	mode: "add" | "edit";
	/**
	 * The fields offered in the picker, in menu order. Defaults to the whole
	 * vocabulary; a consumer narrows it to the fields its deployment can actually
	 * match, so the editor never offers a clause the backend cannot evaluate.
	 */
	fields?: ClauseField[];
	/**
	 * Values worth offering for the field being edited — known senders for a
	 * `From` clause, their domains for a `FromDomain` one. A shortcut and never a
	 * constraint: whatever is typed stands, matches or not, and a field with
	 * nothing to offer is a plain text box.
	 */
	suggestions?: readonly Suggestion[];
	onChangeField?: (field: ClauseField) => void;
	onChangeValue?: (value: string) => void;
	onSubmit?: () => void;
	onCancel?: () => void;
}

/**
 * Inline form for adding or editing one clause — field picker plus a value
 * input, from the design-system primitives so it never drifts from the rest of
 * the editor. The chip it produces renders through {@link ClauseChip}.
 *
 * The suggestion list sits under the row in normal flow rather than floating
 * over it, so on a phone a soft keyboard can never hide the field the list
 * belongs to.
 */
export function ClauseEditor({
	draft,
	mode,
	fields = clauseFieldOrder,
	suggestions = [],
	onChangeField,
	onChangeValue,
	onSubmit,
	onCancel,
}: ClauseEditorProps) {
	const hint = clauseFieldHint(draft.field);
	const suggest = useSuggestList({
		count: suggestions.length,
		onAccept: (index) => onChangeValue?.(suggestions[index].value),
	});
	return (
		<div className="space-y-1.5 rounded-lg border border-accent-2 bg-surface p-2">
			<div className="flex flex-wrap items-center gap-2">
				<Select
					aria-label="Clause field"
					value={draft.field}
					onChange={(e) => onChangeField?.(e.target.value as ClauseField)}
					className="h-8 w-32 shrink-0"
				>
					{fields.map((field) => (
						<option key={field} value={field}>
							{clauseFieldLabel(field)}
						</option>
					))}
				</Select>
				<Input
					aria-label="Clause value"
					value={draft.value}
					placeholder="value…"
					autoComplete="off"
					onChange={(e) => {
						suggest.reopen();
						onChangeValue?.(e.target.value);
					}}
					onKeyDown={(e) => {
						if (suggest.handleKeyDown(e)) return;
						if (e.key === "Enter") onSubmit?.();
					}}
					className="h-8 min-w-40 flex-1"
					{...suggest.comboboxProps}
				/>
				<Button
					variant="primary"
					size="sm"
					onClick={onSubmit}
					disabled={draft.value.trim() === ""}
					className="shrink-0"
				>
					{mode === "add" ? "Add" : "Save"}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={onCancel}
					aria-label="Cancel clause edit"
					icon={<X className="size-4" />}
					className="shrink-0 px-2"
				/>
			</div>
			{suggest.open && (
				<SuggestList
					id={suggest.listId}
					suggestions={suggestions}
					activeIndex={suggest.activeIndex}
					optionId={suggest.optionId}
					onPick={(suggestion) => {
						onChangeValue?.(suggestion.value);
						suggest.dismiss();
					}}
					onHighlight={suggest.setActiveIndex}
					label={`${clauseFieldLabel(draft.field)} suggestions`}
				/>
			)}
			{hint && <p className="px-0.5 text-2xs text-fg-subtle">{hint}</p>}
		</div>
	);
}
