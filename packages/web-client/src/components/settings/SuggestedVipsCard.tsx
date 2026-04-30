import type { RemitImapVipSuggestionEntry } from "@remit/api-http-client/types.gen.ts";
import { Star } from "lucide-react";
import { Avatar } from "../ui/Avatar";
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
			className="flex items-center gap-3 rounded-lg border border-border p-3 sm:p-4"
			data-testid="suggested-vip-row"
		>
			<Avatar name={displayName} email={normalizedEmail} size={40} />
			<div className="flex-1 min-w-0">
				<p className="font-medium truncate" title={label}>
					{label}
				</p>
				{displayName && displayName.trim().length > 0 ? (
					<p
						className="text-sm text-muted-foreground truncate"
						title={normalizedEmail}
					>
						{normalizedEmail}
					</p>
				) : null}
				{stats.length > 0 ? (
					<p className="text-xs text-muted-foreground mt-1">{stats}</p>
				) : null}
			</div>
			<button
				type="button"
				onClick={onAdd}
				disabled={disabled}
				aria-label={`Add ${label} to VIPs`}
				className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
			>
				<Star className="size-4" aria-hidden="true" />
				Add to VIPs
			</button>
		</li>
	);
};
