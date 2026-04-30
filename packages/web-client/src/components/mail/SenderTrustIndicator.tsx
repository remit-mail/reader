import type { RemitImapSenderTrust } from "@remit/api-http-client/types.gen.ts";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface SenderTrustIndicatorProps {
	senderTrust: RemitImapSenderTrust;
	/** Larger size for the open-message header. */
	size?: "sm" | "md";
	className?: string;
}

/**
 * Inline indicator for the sender's trust gradient.
 *
 *  - `unknown`   — small "new sender" pill, low-emphasis muted text.
 *  - `vip`       — sparkles icon next to the From name.
 *  - `wellknown` — no chrome (the absence of an unknown badge IS the signal).
 *
 * Per EDD #232: trust is a UI hint, not a security boundary. Keep visuals
 * subtle. The `trusted` flag (image rendering) stays orthogonal — handled
 * separately by `AddressDisplay`.
 */
export const SenderTrustIndicator = ({
	senderTrust,
	size = "sm",
	className,
}: SenderTrustIndicatorProps) => {
	if (senderTrust === "vip") {
		return (
			<Sparkles
				className={cn(
					"text-amber-500 dark:text-amber-400 shrink-0",
					size === "sm" && "size-3.5",
					size === "md" && "size-4",
					className,
				)}
				aria-label="VIP sender"
				data-testid="sender-trust-vip"
			/>
		);
	}

	if (senderTrust === "unknown") {
		return (
			<span
				className={cn(
					"inline-flex items-center rounded border border-dashed border-muted-foreground/40 font-medium uppercase tracking-wide text-muted-foreground/80 shrink-0",
					size === "sm" && "px-1.5 py-0 text-[10px] leading-4",
					size === "md" && "px-2 py-0.5 text-xs",
					className,
				)}
				title="First message from this sender"
				aria-label="First message from this sender"
				data-testid="sender-trust-unknown"
			>
				new
			</span>
		);
	}

	return null;
};
