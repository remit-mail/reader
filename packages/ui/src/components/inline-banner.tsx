import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";

type Tone = "positive" | "danger" | "neutral";

export interface InlineBannerProps {
	tone: Tone;
	children: ReactNode;
	onDismiss?: () => void;
	/** role override; defaults to "status" for positive, "alert" otherwise. */
	role?: "status" | "alert";
	"data-testid"?: string;
}

const toneClass: Record<Tone, string> = {
	positive: "bg-positive/10 text-positive",
	danger: "bg-danger-soft text-danger",
	neutral: "bg-surface-sunken text-fg-muted",
};

export function InlineBanner({
	tone,
	children,
	onDismiss,
	role,
	"data-testid": testId,
}: InlineBannerProps) {
	const resolvedRole = role ?? (tone === "positive" ? "status" : "alert");
	return (
		<div
			role={resolvedRole}
			data-testid={testId}
			className={cn(
				"flex items-start gap-2 rounded-md px-3 py-2 text-sm",
				toneClass[tone],
			)}
		>
			<div className="min-w-0 flex-1">{children}</div>
			{onDismiss && (
				<Button
					variant="ghost"
					size="sm"
					icon={<X className="size-3.5" />}
					onClick={onDismiss}
					aria-label="Dismiss"
					className="-mr-1 shrink-0"
				/>
			)}
		</div>
	);
}
