import type { RemitImapEnvelopeResponse } from "@remit/api-http-client/types.gen.ts";
import { formatDatePreset } from "@/lib/format";
import { AddressList } from "./AddressDisplay";

interface MessageHeaderProps {
	envelope: RemitImapEnvelopeResponse;
	/**
	 * Optional slot for surfaces (hamburger menu, etc) rendered inline on the
	 * right of the subject line. Kept generic so the header doesn't need to
	 * know what action set is in play.
	 */
	actions?: React.ReactNode;
}

export const MessageHeader = ({ envelope, actions }: MessageHeaderProps) => {
	const date = formatDatePreset(envelope.date, "full");

	return (
		<div className="border-b border-border p-4">
			<div className="flex items-start justify-between gap-2 mb-3">
				<h1 className="text-xl font-semibold">
					{envelope.subject || "(No subject)"}
				</h1>
				{actions && <div className="shrink-0">{actions}</div>}
			</div>
			<div className="space-y-1">
				<AddressList label="From" addresses={envelope.from} showTrustedBadge />
				<AddressList label="To" addresses={envelope.to} />
				{envelope.cc.length > 0 && (
					<AddressList label="Cc" addresses={envelope.cc} />
				)}
				<div className="flex gap-2 text-sm">
					<span className="text-muted-foreground shrink-0 w-12">Date:</span>
					<span className="text-foreground">{date}</span>
				</div>
			</div>
		</div>
	);
};
