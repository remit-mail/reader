import { Sparkles } from "lucide-react";
import { cn } from "../lib/cn.js";

export type SenderTrust = "unknown" | "wellknown" | "vip";

export interface SenderTrustIndicatorProps {
	senderTrust: SenderTrust;
	/** Larger size for the open-message header. */
	size?: "sm" | "md";
	className?: string;
}

export type SenderTrustVariant = "vip" | "unknown-pill" | "hidden";

/**
 * Decide which visual to render for a given trust level + size.
 *
 *  - `vip`          → sparkles icon (every size).
 *  - `unknown-pill` → "new sender" pill, only at `size="md"` (open-message header).
 *                     Hidden at `size="sm"` (inbox row): post-rollout, most
 *                     senders start as `unknown`, so painting a "new" pill on
 *                     every row would be noisy and defeat the purpose of the
 *                     signal.
 *  - `hidden`       → render nothing. Includes `wellknown` at every size and
 *                     `unknown` at `size="sm"`.
 *
 * Pulled out of the React component so the decision is testable without a
 * DOM renderer.
 */
export const selectSenderTrustVariant = (
	senderTrust: SenderTrust,
	size: "sm" | "md",
): SenderTrustVariant => {
	if (senderTrust === "vip") return "vip";
	if (senderTrust === "unknown" && size === "md") return "unknown-pill";
	return "hidden";
};

/**
 * Inline indicator for the sender's trust gradient.
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
	const variant = selectSenderTrustVariant(senderTrust, size);

	if (variant === "vip") {
		return (
			<Sparkles
				className={cn(
					"text-warning shrink-0",
					size === "sm" && "size-3.5",
					size === "md" && "size-4",
					className,
				)}
				aria-label="VIP sender"
				data-testid="sender-trust-vip"
			/>
		);
	}

	if (variant === "unknown-pill") {
		return (
			// biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label provides useful context for assistive tech despite generic span role
			<span
				className={cn(
					"inline-flex items-center rounded border border-dashed border-fg-subtle/40 font-medium uppercase tracking-wide text-fg-muted/80 shrink-0",
					"px-2 py-0.5 text-xs",
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
