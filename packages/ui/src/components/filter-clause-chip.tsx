import { Plus, Sparkles, X } from "lucide-react";
import { cn } from "../lib/cn.js";
import {
	type ClauseField,
	clauseFieldLabel,
	clauseFieldOrder,
	type RuleClause,
	type RuleWiden,
	widenChipLabel,
} from "./filter-rule.js";
import { Input } from "./input.js";
import { Select } from "./select.js";

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

export interface WidenChipProps {
	widen: RuleWiden;
	onRemove?: () => void;
}

/**
 * The semantic widen as one chip (RFC 038 D3). Active it reads "…and anything
 * similar" with the anchor count and can be removed; inactive it says the
 * deployment cannot evaluate it and the rule matches by its literal clauses
 * only (D4) — no remove, because there is nothing running to stop.
 */
export function WidenChip({ widen, onRemove }: WidenChipProps) {
	if (widen.inactive) {
		return (
			<span
				className={cn(
					chipShell,
					"border-dashed border-line-strong bg-surface-sunken text-fg-subtle",
				)}
			>
				<Sparkles className="size-3 shrink-0" aria-hidden="true" />
				<span className="line-through">{widenChipLabel(widen)}</span>
				<span className="text-2xs">not available here</span>
			</span>
		);
	}

	return (
		<span
			className={cn(
				chipShell,
				"border-accent-2 bg-accent-2-soft text-accent-2",
			)}
		>
			<Sparkles className="size-3 shrink-0" aria-hidden="true" />
			<span className="font-medium">…and anything similar</span>
			<span className="text-2xs opacity-80">{widenChipLabel(widen)}</span>
			{onRemove && (
				<button
					type="button"
					onClick={onRemove}
					aria-label="Remove the similar-mail widen"
					className="flex size-4 items-center justify-center rounded-full hover:bg-accent-2/15"
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
	onChangeField?: (field: ClauseField) => void;
	onChangeValue?: (value: string) => void;
	onSubmit?: () => void;
	onCancel?: () => void;
}

/**
 * Inline form for adding or editing one clause — field picker plus a value
 * input, from the design-system primitives so it never drifts from the rest of
 * the editor. The chip it produces renders through {@link ClauseChip}.
 */
export function ClauseEditor({
	draft,
	mode,
	onChangeField,
	onChangeValue,
	onSubmit,
	onCancel,
}: ClauseEditorProps) {
	return (
		<div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent-2 bg-surface p-2">
			<Select
				aria-label="Clause field"
				value={draft.field}
				onChange={(e) => onChangeField?.(e.target.value as ClauseField)}
				className="h-8 w-32 shrink-0"
			>
				{clauseFieldOrder.map((field) => (
					<option key={field} value={field}>
						{clauseFieldLabel(field)}
					</option>
				))}
			</Select>
			<Input
				aria-label="Clause value"
				value={draft.value}
				placeholder="value…"
				onChange={(e) => onChangeValue?.(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") onSubmit?.();
				}}
				className="h-8 min-w-40 flex-1"
			/>
			<button
				type="button"
				onClick={onSubmit}
				disabled={draft.value.trim() === ""}
				className="h-8 shrink-0 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-50"
			>
				{mode === "add" ? "Add" : "Save"}
			</button>
			<button
				type="button"
				onClick={onCancel}
				aria-label="Cancel clause edit"
				className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-sunken"
			>
				<X className="size-4" />
			</button>
		</div>
	);
}
