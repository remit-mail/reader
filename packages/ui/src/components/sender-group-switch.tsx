import { cn } from "../lib/cn.js";

export interface SenderGroupOption<T extends string> {
	id: T;
	label: string;
	count: number | null;
}

export interface SenderGroupSwitchProps<T extends string> {
	options: SenderGroupOption<T>[];
	active: T;
	onSelect: (id: T) => void;
}

/**
 * VIP / Muted / Blocked selector for Senders & Rules. A vertical rail on
 * desktop; a horizontal tab strip below it so the dense table can own the
 * full width on phone and tablet.
 */
export function SenderGroupSwitch<T extends string>({
	options,
	active,
	onSelect,
}: SenderGroupSwitchProps<T>) {
	return (
		<div
			role="tablist"
			className={cn(
				"flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2",
				"lg:w-44 lg:flex-col lg:gap-0 lg:overflow-visible lg:border-r lg:border-b-0 lg:py-2 lg:pr-2 lg:pl-3",
			)}
		>
			{options.map((option) => {
				const selected = option.id === active;
				return (
					<button
						key={option.id}
						type="button"
						role="tab"
						aria-selected={selected}
						onClick={() => onSelect(option.id)}
						className={cn(
							"flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-left text-sm transition-colors lg:min-h-0 lg:px-2 lg:py-1",
							selected
								? "bg-accent-2-soft font-medium text-accent-2"
								: "text-fg-muted hover:bg-surface-sunken hover:text-fg",
						)}
					>
						<span className="flex-1 truncate">{option.label}</span>
						<span
							className={cn(
								"text-2xs tabular-nums",
								selected ? "text-accent-2" : "text-fg-subtle",
							)}
						>
							{option.count ?? "—"}
						</span>
					</button>
				);
			})}
		</div>
	);
}
