import type { ReactNode } from "react";
import { AddressList, type EnvelopeAddress } from "./address-display.js";
import { CategoryBadge, type MessageCategory } from "./category-badge.js";
import {
	type SenderTrust,
	SenderTrustIndicator,
} from "./sender-trust-indicator.js";

export interface MessageHeaderProps {
	subject?: string;
	from: EnvelopeAddress[];
	to: EnvelopeAddress[];
	cc?: EnvelopeAddress[];
	/** Pre-formatted, human-readable date. The consumer owns formatting. */
	date: string;
	category?: MessageCategory;
	senderTrust: SenderTrust;
	/**
	 * Optional slot for surfaces (hamburger menu, etc) rendered inline on the
	 * right of the subject line. Kept generic so the header doesn't need to
	 * know what action set is in play.
	 */
	actions?: ReactNode;
}

export const MessageHeader = ({
	subject,
	from,
	to,
	cc = [],
	date,
	category,
	senderTrust,
	actions,
}: MessageHeaderProps) => {
	return (
		<div className="border-b border-line p-4">
			<div className="flex items-start justify-between gap-2 mb-3">
				<div className="flex items-center gap-2 min-w-0 flex-1">
					<h1 className="text-xl font-semibold truncate">
						{subject || "(No subject)"}
					</h1>
					<CategoryBadge category={category} size="md" />
					<SenderTrustIndicator senderTrust={senderTrust} size="md" />
				</div>
				{actions && <div className="shrink-0">{actions}</div>}
			</div>
			<div className="space-y-1">
				<AddressList label="From" addresses={from} showTrustedBadge />
				<AddressList label="To" addresses={to} />
				{cc.length > 0 && <AddressList label="Cc" addresses={cc} />}
				<div className="flex gap-2 text-sm">
					<span className="text-fg-muted shrink-0 w-12">Date:</span>
					<span className="text-fg">{date}</span>
				</div>
			</div>
		</div>
	);
};
