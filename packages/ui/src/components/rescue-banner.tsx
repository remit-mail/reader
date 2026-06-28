import { ShieldCheck } from "lucide-react";
import { Banner } from "./banner.js";
import { Button } from "./button.js";

export interface RescueBannerProps {
	/** How many messages in this folder look safe to rescue. */
	count: number;
	onReview: () => void;
	onDismiss?: () => void;
	/** Override the call-to-action label. */
	actionLabel?: string;
}

const plural = (n: number): string => (n === 1 ? "message" : "messages");

/**
 * Entry call-to-action shown atop a Spam folder when some messages look safe.
 * Plain language only — no talk of authentication, scores or rules.
 */
export function RescueBanner({
	count,
	onReview,
	onDismiss,
	actionLabel = "Review & rescue",
}: RescueBannerProps) {
	return (
		<Banner tone="info" variant="soft" onDismiss={onDismiss}>
			<div className="flex flex-col gap-2">
				<p className="flex items-start gap-2 text-sm text-fg">
					<ShieldCheck
						className="mt-0.5 size-4 shrink-0 text-positive"
						aria-hidden
					/>
					<span>
						<span className="font-semibold text-fg">{`${count} ${plural(count)} here`}</span>{" "}
						may not be spam — they're from senders we can verify.
					</span>
				</p>
				<Button
					variant="primary"
					size="sm"
					onClick={onReview}
					className="self-start"
				>
					{actionLabel}
				</Button>
			</div>
		</Banner>
	);
}
