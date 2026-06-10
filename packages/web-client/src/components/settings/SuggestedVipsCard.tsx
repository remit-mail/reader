import type { RemitImapVipSuggestionEntry } from "@remit/api-http-client/types.gen.ts";
import { Avatar } from "@remit/ui";
import { Star } from "lucide-react";
import { formatVipSuggestionStats } from "./vip-suggestion-stats.js";

interface SuggestedVipsCardProps {
	suggestion: RemitImapVipSuggestionEntry;
	onAdd: () => void;
	disabled: boolean;
}

export const SuggestedVipsCard = ({
	suggestion,
	onAdd,
	disabled,
}: SuggestedVipsCardProps) => {
	const { displayName, normalizedEmail } = suggestion;
	const stats = formatVipSuggestionStats(suggestion);
	const label = displayName?.trim() || normalizedEmail;

	return (
		<li
			className="flex items-center gap-3 rounded-sm border border-line p-3 sm:p-4"
			data-testid="suggested-vip-row"
		>
			<Avatar
				name={displayName ?? normalizedEmail}
				email={normalizedEmail}
				size="md"
			/>
			<div className="flex-1 min-w-0">
				<p className="font-medium truncate" title={label}>
					{label}
				</p>
				{displayName && displayName.trim().length > 0 ? (
					<p className="text-sm text-fg-muted truncate" title={normalizedEmail}>
						{normalizedEmail}
					</p>
				) : null}
				{stats.length > 0 ? (
					<p className="text-xs text-fg-muted mt-1">{stats}</p>
				) : null}
			</div>
			<button
				type="button"
				onClick={onAdd}
				disabled={disabled}
				aria-label={`Add ${label} to VIPs`}
				className="shrink-0 inline-flex items-center gap-1 rounded-md border border-line bg-canvas px-3 py-2 text-sm font-medium hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed"
			>
				<Star className="size-4" aria-hidden="true" />
				Add to VIPs
			</button>
		</li>
	);
};
