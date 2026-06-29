import { ShieldCheck } from "lucide-react";
import { cn } from "../lib/cn.js";
import { Avatar } from "./avatar.js";
import { Badge } from "./badge.js";
import { Checkbox } from "./checkbox.js";
import {
	type SenderTrust,
	SenderTrustIndicator,
} from "./sender-trust-indicator.js";

export interface RescueCandidate {
	id: string;
	senderName: string;
	senderAddress: string;
	subject: string;
	snippet: string;
	/** Plain-language headline chip, e.g. "We can verify this sender". */
	trustReason: string;
	/** Why we trust it, e.g. "You've emailed them before". Never DKIM/SPF jargon. */
	trustSubReason: string;
	senderTrust?: SenderTrust;
}

export interface RescueCandidateRowProps {
	candidate: RescueCandidate;
	selected: boolean;
	onToggle: () => void;
}

/**
 * A single suspected-safe message in the Rescue-from-Spam review list. The whole
 * row is a label around a real checkbox: tapping anywhere toggles selection for
 * the bulk move. The green trust chip explains, in plain language, why we
 * believe it isn't spam.
 */
export function RescueCandidateRow({
	candidate,
	selected,
	onToggle,
}: RescueCandidateRowProps) {
	const {
		senderName,
		senderAddress,
		subject,
		snippet,
		trustReason,
		trustSubReason,
		senderTrust,
	} = candidate;

	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: label wraps a custom Checkbox component that handles focus
		<label
			className={cn(
				"flex w-full cursor-pointer items-start gap-3 px-3 py-2.5 text-left transition-colors",
				selected ? "bg-positive/10" : "bg-surface hover:bg-surface-sunken",
			)}
		>
			<Checkbox
				className="mt-0.5"
				checked={selected}
				onChange={onToggle}
				aria-label={`${selected ? "Deselect" : "Select"} message from ${senderName}`}
			/>

			<Avatar name={senderName} email={senderAddress} size="sm" />

			<span className="min-w-0 flex-1">
				<span className="flex items-center gap-1.5">
					<span className="truncate text-sm font-medium text-fg">
						{senderName}
					</span>
					{senderTrust && (
						<SenderTrustIndicator senderTrust={senderTrust} size="sm" />
					)}
					<span className="truncate text-2xs text-fg-subtle">
						{senderAddress}
					</span>
				</span>
				<span className="block truncate text-sm text-fg-muted">{subject}</span>
				<span className="block line-clamp-1 text-xs text-fg-subtle">
					{snippet}
				</span>
				<span className="mt-1.5 flex flex-wrap items-center gap-1.5">
					<Badge tone="positive">
						<ShieldCheck className="size-3" aria-hidden />
						{trustReason}
					</Badge>
					<span className="text-2xs text-fg-subtle">{trustSubReason}</span>
				</span>
			</span>
		</label>
	);
}
