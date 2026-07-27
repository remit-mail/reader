import { cn } from "../lib/cn.js";
import { isLabelColorValue, labelDotClass } from "../lib/label-color.js";

export interface LabelChipData {
	labelId: string;
	name: string;
	color: string;
}

export interface LabelChipProps {
	label: LabelChipData;
	/** Renders a remove affordance — the manual "just these" unlabel action. */
	onRemove?: (labelId: string) => void;
	className?: string;
}

/**
 * A label applied to a message (issue #26) — a colored dot plus its name, the
 * same shape a category badge or the widen chip takes. `color` renders from
 * the literal palette (never a semantic tone): a label's color is a user
 * choice, not a status the design system assigns meaning to.
 */
export function LabelChip({ label, onRemove, className }: LabelChipProps) {
	const dotClass = isLabelColorValue(label.color)
		? labelDotClass[label.color]
		: labelDotClass.Default;

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-2xs font-medium text-fg-muted shrink-0",
				className,
			)}
		>
			<span className={cn("size-1.5 shrink-0 rounded-full", dotClass)} />
			<span className="truncate">{label.name}</span>
			{onRemove && (
				<button
					type="button"
					onClick={() => onRemove(label.labelId)}
					aria-label={`Remove label ${label.name}`}
					className="ml-0.5 rounded-full text-fg-subtle hover:text-fg"
				>
					×
				</button>
			)}
		</span>
	);
}
