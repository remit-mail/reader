import { cn } from "../lib/cn.js";
import type { BannerTone } from "./banner.js";

export interface ProgressBarProps {
	/** Units completed so far. Ignored when `indeterminate`. */
	value: number;
	/** Total units. Ignored when `indeterminate`. */
	max: number;
	tone?: BannerTone;
	/** Unknown total (or unknown rate) — an animated fill with no fixed end. */
	indeterminate?: boolean;
	className?: string;
}

const tones: Record<BannerTone, string> = {
	info: "bg-accent-2",
	success: "bg-positive",
	warning: "bg-warning",
	danger: "bg-danger",
};

/**
 * Determinate (or indeterminate) progress meter for a bulk operation, e.g. a
 * multi-thousand-message delete running in batches. A bare running count
 * gives no sense of rate over a long operation; a filling bar answers "is
 * this stuck?" pre-attentively.
 */
export function ProgressBar({
	value,
	max,
	tone = "info",
	indeterminate = false,
	className,
}: ProgressBarProps) {
	const pct = indeterminate
		? 100
		: max <= 0
			? 0
			: Math.min(100, Math.max(0, (value / max) * 100));

	return (
		<div
			role="progressbar"
			aria-valuenow={indeterminate ? undefined : value}
			aria-valuemin={indeterminate ? undefined : 0}
			aria-valuemax={indeterminate ? undefined : max}
			className={cn(
				"h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken",
				className,
			)}
		>
			<div
				className={cn(
					"h-full rounded-full transition-[width] duration-300 ease-out",
					tones[tone],
					indeterminate && "w-1/3 animate-pulse",
				)}
				style={indeterminate ? undefined : { width: `${pct}%` }}
			/>
		</div>
	);
}
