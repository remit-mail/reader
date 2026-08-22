import { Check, ChevronRight, Folder } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { cn } from "../lib/cn.js";

export const FOLDER_ROW_BASE =
	"flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

export const FOLDER_INDENT_STEP = 14;

/**
 * Where a row's text starts: `px-3` plus the chevron and folder icon columns
 * with their gaps. The hairline separator is inset to it, so the line begins
 * under the label the way a native mobile list draws it.
 */
export const FOLDER_ROW_TEXT_INSET = 60;

export const FolderRowIndent = ({ depth }: { depth: number }) =>
	depth > 0 ? (
		<span
			aria-hidden="true"
			className="shrink-0"
			style={{ width: depth * FOLDER_INDENT_STEP }}
		/>
	) : null;

export const FolderRowSeparator = ({ depth }: { depth: number }) => (
	<span
		aria-hidden="true"
		className="pointer-events-none absolute right-0 bottom-0 h-px bg-line"
		style={{ left: FOLDER_ROW_TEXT_INSET + depth * FOLDER_INDENT_STEP }}
	/>
);

export interface FolderRowProps {
	label: string;
	/** Indents the row and carries the nesting to `aria-level`. */
	depth: number;
	/** Its children are on screen. */
	expanded: boolean;
	/** What the row is announced as, e.g. `Move to Archive`. */
	ariaLabel: string;
	/** Chosen as the destination: checked, and announced as selected. */
	selected?: boolean;
	/**
	 * On screen only to hold a match below it. A branch reads and never
	 * operates, so it is neither focusable nor a target.
	 */
	context?: boolean;
	/** Where the messages live now: a marker, never a disabled control. */
	current?: boolean;
	/** Inline tag shown on the current row, e.g. `current`. */
	currentTag?: string;
	/**
	 * How much mail the folder holds, right-aligned. The accessible name is the
	 * caller's `ariaLabel`, so a surface that needs the count announced folds it
	 * in there rather than relying on this.
	 */
	messageCount?: number;
	/** A hairline under the label, drawn for every row but the last. */
	separated?: boolean;
	/**
	 * Controls that operate on the folder rather than open it. They sit beside
	 * the row instead of inside it — a button nested in a button is invalid, and
	 * a tree item that swallows its own actions cannot be reached by keyboard.
	 */
	actions?: ReactNode;
	tabIndex?: number;
	onActivate?: () => void;
	onFocus?: () => void;
	ref?: Ref<HTMLButtonElement>;
}

/**
 * One folder in a tree: opens where you tap it, and says whether it is the
 * destination, the folder you are in, or a branch on the way to a match.
 */
export const FolderRow = ({
	label,
	depth,
	expanded,
	ariaLabel,
	selected = false,
	context = false,
	current = false,
	currentTag,
	messageCount,
	separated = false,
	actions,
	tabIndex,
	onActivate,
	onFocus,
	ref,
}: FolderRowProps) => {
	const chevron = (
		<ChevronRight
			className={cn(
				"size-4 shrink-0 text-fg-subtle transition-transform",
				expanded && "rotate-90",
			)}
			aria-hidden="true"
		/>
	);
	const icon = (
		<Folder className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
	);
	const count =
		messageCount === undefined ? null : (
			<span aria-hidden="true" className="shrink-0 text-2xs text-fg-subtle">
				{messageCount} {messageCount === 1 ? "msg" : "msgs"}
			</span>
		);
	if (context) {
		return (
			<div className="relative flex items-center">
				{/* biome-ignore lint/a11y/useFocusableInteractive: an ancestor held on screen by a match below it — a branch, not a destination */}
				<div
					role="treeitem"
					aria-level={depth + 1}
					aria-selected={false}
					aria-expanded={expanded}
					aria-label={ariaLabel}
					className={cn(FOLDER_ROW_BASE, "opacity-60")}
				>
					<FolderRowIndent depth={depth} />
					{chevron}
					{icon}
					<span className="min-w-0 flex-1 truncate">{label}</span>
					{count}
				</div>
				{actions}
				{separated && <FolderRowSeparator depth={depth} />}
			</div>
		);
	}
	return (
		<div className="relative flex items-center">
			<button
				ref={ref}
				type="button"
				role="treeitem"
				aria-level={depth + 1}
				aria-selected={selected}
				aria-expanded={expanded}
				aria-current={current ? "true" : undefined}
				aria-label={ariaLabel}
				tabIndex={tabIndex}
				onClick={onActivate}
				onFocus={onFocus}
				className={cn(
					FOLDER_ROW_BASE,
					"hover:bg-surface-raised active:bg-surface-sunken",
					current && "text-fg-muted",
				)}
			>
				<FolderRowIndent depth={depth} />
				{chevron}
				{icon}
				<span className="min-w-0 flex-1 truncate">{label}</span>
				{count}
				{current && currentTag && (
					<span className="shrink-0 text-xs text-fg-muted">{currentTag}</span>
				)}
				{selected && (
					<Check className="size-4 shrink-0 text-accent" aria-hidden="true" />
				)}
			</button>
			{actions}
			{separated && <FolderRowSeparator depth={depth} />}
		</div>
	);
};
