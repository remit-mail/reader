import type { RemitImapEnvelopeResponse } from "@remit/api-http-client/types.gen.ts";
import { formatDatePreset } from "@/lib/format";
import { AddressList } from "./AddressDisplay";

interface MessageHeaderProps {
	envelope: RemitImapEnvelopeResponse;
}

export const MessageHeader = ({ envelope }: MessageHeaderProps) => {
	const date = formatDatePreset(envelope.date, "full");

	return (
		<div className="border-b border-border p-4">
			<h1 className="text-xl font-semibold mb-3">
				{envelope.subject || "(No subject)"}
			</h1>
			<div className="space-y-1">
				<AddressList label="From" addresses={envelope.from} />
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
