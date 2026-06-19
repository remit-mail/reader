import {
	AlertCircle,
	AlertTriangle,
	CheckCircle,
	Clock,
	Loader2,
} from "lucide-react";
import { cn } from "../lib/cn.js";

/** The non-draft outbox lifecycle states (drafts live in a separate view). */
export type OutboxStatus = "queued" | "sending" | "sent" | "failed" | "blocked";

interface StatusConfig {
	icon: typeof Clock;
	label: string;
	className: string;
	spin?: boolean;
}

export const outboxStatusConfig: Record<OutboxStatus, StatusConfig> = {
	queued: { icon: Clock, label: "Queued", className: "text-warning" },
	sending: {
		icon: Loader2,
		label: "Sending…",
		className: "text-accent-2",
		spin: true,
	},
	sent: { icon: CheckCircle, label: "Sent", className: "text-positive" },
	failed: { icon: AlertCircle, label: "Failed", className: "text-danger" },
	blocked: { icon: AlertTriangle, label: "Blocked", className: "text-warning" },
};

export interface OutboxStatusBadgeProps {
	status: OutboxStatus;
	/** Hide the text label, leaving only the tinted icon. */
	iconOnly?: boolean;
	className?: string;
}

/** Status-tinted icon + label for an outbox message row. */
export function OutboxStatusBadge({
	status,
	iconOnly,
	className,
}: OutboxStatusBadgeProps) {
	const config = outboxStatusConfig[status];
	const Icon = config.icon;
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 text-xs font-medium",
				config.className,
				className,
			)}
		>
			<Icon className={cn("size-4", config.spin && "animate-spin")} />
			{!iconOnly && config.label}
		</span>
	);
}
