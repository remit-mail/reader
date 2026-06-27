import { ChevronDown } from "lucide-react";
import { cn } from "../lib/cn.js";
import type { AccountChip } from "./app-shell-types.js";

export interface AccountChipRowProps {
	chips: AccountChip[];
	/** Trailing, low-contrast affordance for hidden accounts, e.g. "+1 muted". */
	mutedNote?: string;
	onSelectChip?: (id: string) => void;
	/** When set, renders a trailing caret that opens the fuller filter sheet. */
	onExpandFilters?: () => void;
}

/**
 * The account filter chip bar: `[ All ] [ Personal 12 ] [ Work 19 ]` with an
 * optional trailing muted note and a caret that opens the fuller filter sheet.
 * Selecting a chip filters the brief to that account. Controls are always
 * active — never disabled.
 */
export function AccountChipRow({
	chips,
	mutedNote,
	onSelectChip,
	onExpandFilters,
}: AccountChipRowProps) {
	return (
		<div className="flex items-center gap-1.5 overflow-hidden border-b border-line px-row-inset py-1">
			<div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
				{chips.map((chip) => (
					<button
						key={chip.id}
						type="button"
						onClick={() => onSelectChip?.(chip.id)}
						className={cn(
							"flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-2xs transition-colors",
							chip.active
								? "border-accent-2 bg-accent-2-soft font-medium text-accent-2"
								: "border-line text-fg-muted hover:border-line-strong",
						)}
					>
						{chip.label}
						{chip.count != null && (
							<span className="tabular-nums opacity-70">{chip.count}</span>
						)}
					</button>
				))}
			</div>
			{(mutedNote || onExpandFilters) && (
				<div className="flex shrink-0 items-center gap-1.5">
					{mutedNote && (
						<span className="text-2xs text-fg-subtle">{mutedNote}</span>
					)}
					{onExpandFilters && (
						<button
							type="button"
							onClick={onExpandFilters}
							aria-label="Filters"
							className="flex size-6 items-center justify-center rounded-full text-fg-muted hover:bg-surface-sunken hover:text-fg"
						>
							<ChevronDown className="size-4" />
						</button>
					)}
				</div>
			)}
		</div>
	);
}
