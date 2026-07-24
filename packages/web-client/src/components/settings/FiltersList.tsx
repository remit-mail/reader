import type { RemitImapFilterResponse } from "@remit/api-http-client/types.gen.ts";
import { Badge, Button, WidenChip } from "@remit/ui";
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
	/** Open the row's rule in the editor (RFC 038 D6). */
	onEdit: (filterId: string) => void;
	onDelete: (filterId: string) => void;
	deletingFilterId?: string;
	/**
	 * This deployment ships no vector pipeline (RFC 038 D4). A filter carrying a
	 * semantic anchor lists with its widen chip inactive — it matches by its
	 * literal clauses only.
	 */
	semanticUnavailable?: boolean;
	/** Injected for deterministic status in tests; defaults to now. */
	now?: number;
}

/**
 * The account's standing filters, each opening its rule in the editor (RFC 038
 * D6). Expired temporary filters stay listed and are marked Expired distinctly
 * rather than hidden (RFC 034 Decision 1.2). A filter with a semantic anchor
 * shows the widen chip — inactive where this deployment cannot evaluate it
 * (D4), so the list says honestly that it matches by literal clauses only.
 */
export function FiltersList({
	filters,
	mailboxName,
	onEdit,
	onDelete,
	deletingFilterId,
	semanticUnavailable = false,
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
						<button
							type="button"
							onClick={() => onEdit(filter.filterId)}
							aria-label={`Edit filter ${filter.name}`}
							className="min-w-0 flex-1 rounded-sm text-left hover:opacity-80"
						>
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
							{filter.hasAnchor && (
								<div className="mt-1.5 flex flex-wrap gap-1.5">
									<WidenChip
										widen={{
											anchorCount: 1,
											...(semanticUnavailable ? { inactive: true } : {}),
										}}
									/>
								</div>
							)}
						</button>
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
