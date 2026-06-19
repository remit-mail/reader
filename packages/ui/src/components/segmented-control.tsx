import { cn } from "../lib/cn.js";

export interface SegmentedOption<T extends string> {
	value: T;
	label: string;
}

export interface SegmentedControlProps<T extends string> {
	name: string;
	options: SegmentedOption<T>[];
	value: T;
	onChange: (value: T) => void;
	size?: "sm" | "md";
	"aria-label"?: string;
}

const sizeClass = {
	sm: "min-h-9 px-3 text-xs",
	md: "min-h-11 px-4 text-sm",
};

export function SegmentedControl<T extends string>({
	name,
	options,
	value,
	onChange,
	size = "md",
	"aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
	return (
		<div
			role="radiogroup"
			aria-label={ariaLabel}
			className="inline-flex rounded-md border border-line bg-surface-sunken p-0.5"
		>
			{options.map((option) => {
				const selected = option.value === value;
				return (
					<label
						key={option.value}
						className={cn(
							"flex cursor-pointer items-center justify-center rounded-[5px] font-medium transition-colors",
							sizeClass[size],
							selected
								? "bg-surface text-fg shadow-sm"
								: "text-fg-muted hover:text-fg",
						)}
					>
						<input
							type="radio"
							name={name}
							value={option.value}
							checked={selected}
							onChange={() => onChange(option.value)}
							className="sr-only"
						/>
						{option.label}
					</label>
				);
			})}
		</div>
	);
}
