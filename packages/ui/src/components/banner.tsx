import { X } from "lucide-react";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";

export type BannerTone = "info" | "success" | "warning" | "danger";
export type BannerVariant = "framed" | "soft";

export interface BannerProps extends HTMLAttributes<HTMLDivElement> {
	tone?: BannerTone;
	variant?: BannerVariant;
	onDismiss?: () => void;
}

const framedTones: Record<BannerTone, string> = {
	info: "bg-accent-2/15 text-accent-2 border-accent-2/40",
	success: "bg-positive/15 text-positive border-positive/40",
	warning: "bg-warning/15 text-warning border-warning/40",
	danger: "bg-danger/15 text-danger border-danger/40",
};

const softTones: Record<BannerTone, string> = {
	info: "bg-surface-sunken text-fg-muted",
	success: "bg-positive/10 text-positive",
	warning: "bg-warning/10 text-warning",
	danger: "bg-danger-soft text-danger",
};

const roles: Record<BannerTone, "status" | "alert"> = {
	info: "status",
	success: "status",
	warning: "alert",
	danger: "alert",
};

export function Banner({
	tone = "info",
	variant = "framed",
	onDismiss,
	role,
	className,
	children,
	...props
}: BannerProps) {
	const soft = variant === "soft";
	return (
		<div
			role={role ?? roles[tone]}
			className={cn(
				"flex gap-2 px-3 py-2 text-sm",
				soft
					? cn("items-start rounded-md", softTones[tone])
					: cn("items-center border", framedTones[tone]),
				className,
			)}
			{...props}
		>
			<div className="flex-1 min-w-0">{children}</div>
			{onDismiss &&
				(soft ? (
					<Button
						variant="ghost"
						size="sm"
						icon={<X className="size-3.5" />}
						onClick={onDismiss}
						aria-label="Dismiss"
						className="-mr-1 shrink-0"
					/>
				) : (
					<button
						type="button"
						onClick={onDismiss}
						aria-label="Dismiss"
						className="shrink-0 rounded-md p-1 hover:bg-fg/10 transition-colors"
					>
						<X className="size-4" aria-hidden="true" />
					</button>
				))}
		</div>
	);
}
