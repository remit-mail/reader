import { X } from "lucide-react";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

export type BannerTone = "info" | "success" | "warning" | "danger";

export interface BannerProps extends HTMLAttributes<HTMLDivElement> {
	tone?: BannerTone;
	onDismiss?: () => void;
}

const tones: Record<BannerTone, string> = {
	info: "bg-accent-2/15 text-accent-2 border-accent-2/40",
	success: "bg-positive/15 text-positive border-positive/40",
	warning: "bg-warning/15 text-warning border-warning/40",
	danger: "bg-danger/15 text-danger border-danger/40",
};

const roles: Record<BannerTone, "status" | "alert"> = {
	info: "status",
	success: "status",
	warning: "alert",
	danger: "alert",
};

export function Banner({
	tone = "info",
	onDismiss,
	className,
	children,
	...props
}: BannerProps) {
	return (
		<div
			role={roles[tone]}
			className={cn(
				"flex items-center gap-2 border px-3 py-2 text-sm",
				tones[tone],
				className,
			)}
			{...props}
		>
			<div className="flex-1 min-w-0">{children}</div>
			{onDismiss && (
				<button
					type="button"
					onClick={onDismiss}
					aria-label="Dismiss"
					className="shrink-0 rounded-md p-1 hover:bg-fg/10 transition-colors"
				>
					<X className="size-4" aria-hidden="true" />
				</button>
			)}
		</div>
	);
}
