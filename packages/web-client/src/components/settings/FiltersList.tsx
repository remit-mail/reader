import type { RemitImapFilterResponse } from "@remit/api-http-client/types.gen.ts";
import { Badge, Button } from "@remit/ui";
import { Trash2 } from "lucide-react";
import {
	filterDisplayStatus,
	formatExpiresAt,
} from "@/lib/organize/filter-status";
import { NO_ACTION } from "@/lib/organize/organize-model";

interface FiltersListProps {
	filters: RemitImapFilterResponse[];
	/** Resolve a destination mailbox id to a folder name for display. */
	mailboxName: (mailboxId: string) => string | undefined;
	onDelete: (filterId: string) => void;
	deletingFilterId?: string;
	/** Injected for deterministic status in tests; defaults to now. */
	now?: number;
}

/**
 * The account's standing filters. Expired temporary filters stay listed and
 * are marked Expired distinctly rather than hidden (RFC 034 Decision 1.2).
 */
export function FiltersList({
	filters,
	mailboxName,
	onDelete,
	deletingFilterId,
	now = Date.now(),
}: FiltersListProps) {
	if (filters.length === 0) {
		return (
			<p className="py-6 text-sm text-fg-muted">
				No filters yet. Select a few messages in the inbox and choose Organize
				to make one.
			</p>
		);
	}

	return (
		<ul className="divide-y divide-line rounded-md border border-line">
			{filters.map((filter) => {
				const status = filterDisplayStatus(filter, now);
				const expired = status === "Expired";
				const folder =
					filter.actionMailboxId !== NO_ACTION
						? mailboxName(filter.actionMailboxId)
						: undefined;
				const expiresLabel = formatExpiresAt(filter.expiresAt);

				return (
					<li
						key={filter.filterId}
						className="flex items-start gap-3 px-3 py-2.5"
					>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								<span
									className={`truncate text-sm font-medium ${
										expired ? "text-fg-muted" : "text-fg"
									}`}
								>
									{filter.name}
								</span>
								<Badge tone={expired ? "neutral" : "positive"} dot>
									{status}
								</Badge>
							</div>
							<p className="mt-0.5 text-xs text-fg-subtle">
								{folder ? `Moves matches to ${folder}` : "No move action"}
								{filter.scope === "Temporary" && expiresLabel
									? expired
										? ` · expired ${expiresLabel}`
										: ` · until ${expiresLabel}`
									: filter.scope === "Standing"
										? " · always"
										: ""}
							</p>
						</div>
						<Button
							variant="ghost"
							size="sm"
							icon={<Trash2 className="size-4 text-danger" />}
							onClick={() => onDelete(filter.filterId)}
							disabled={deletingFilterId === filter.filterId}
							aria-label={`Delete filter ${filter.name}`}
						/>
					</li>
				);
			})}
		</ul>
	);
}
