import type { RemitImapFilterResponse } from "@remit/api-http-client/types.gen.ts";
import {
	Badge,
	Button,
	LabelChip,
	type LabelOption,
	WidenChip,
} from "@remit/ui";
import { Trash2 } from "lucide-react";
import type { FilterRunStatus } from "@/lib/organize/filter-run";
import {
	disabledReasonCopy,
	filterDisplayStatus,
	formatExpiresAt,
} from "@/lib/organize/filter-status";
import { NO_ACTION } from "@/lib/organize/organize-model";

const runStatusLine = (status: FilterRunStatus): string | undefined => {
	switch (status.kind) {
		case "queuing":
		case "running":
			return "Running over the inbox…";
		case "done":
			return status.matched === 0
				? "Done. Nothing in the inbox matched."
				: `Done. Filed ${status.applied} of ${status.matched} matching messages in the inbox.`;
		case "failed":
			return undefined;
	}
};

interface FiltersListProps {
	filters: RemitImapFilterResponse[];
	/** Resolve a destination mailbox id to a folder name for display. */
	mailboxName: (mailboxId: string) => string | undefined;
	/** Resolve a label id to its name/color for the applied-label chip (issue #26). */
	labelById: Map<string, LabelOption>;
	/** Open the row's rule in the editor (RFC 038 D6). */
	onEdit: (filterId: string) => void;
	onDelete: (filterId: string) => void;
	deletingFilterId?: string;
	onToggle: (filterId: string, enabled: boolean) => void;
	togglingFilterId?: string;
	/** Run the filter over the inbox now (#1354). */
	onRunNow: (filterId: string) => void;
	/** The filter the last Run now was for. */
	runFilterId?: string;
	/** How that run stands; a failure is reported above the list. */
	runStatus?: FilterRunStatus;
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
	labelById,
	onEdit,
	onDelete,
	deletingFilterId,
	onToggle,
	togglingFilterId,
	onRunNow,
	runFilterId,
	runStatus,
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
				const disabled = status === "Disabled";
				const reason = disabled ? disabledReasonCopy(filter) : undefined;
				const folder =
					filter.actionMailboxId !== NO_ACTION
						? mailboxName(filter.actionMailboxId)
						: undefined;
				const label =
					filter.actionLabelId !== NO_ACTION
						? labelById.get(filter.actionLabelId)
						: undefined;
				const expiresLabel = formatExpiresAt(filter.expiresAt);
				const run = runFilterId === filter.filterId ? runStatus : undefined;
				const busy = run?.kind === "queuing" || run?.kind === "running";
				const runLine = run ? runStatusLine(run) : undefined;
				const runnable =
					status === "Active" &&
					(filter.actionMailboxId !== NO_ACTION ||
						filter.actionLabelId !== NO_ACTION);

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
										expired || disabled ? "text-fg-muted" : "text-fg"
									}`}
								>
									{filter.name}
								</span>
								<Badge
									tone={expired ? "neutral" : disabled ? "warning" : "positive"}
									dot
								>
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
							{reason && (
								<p className="mt-0.5 text-xs text-warning">{reason}</p>
							)}
							{runLine && (
								<p role="status" className="mt-0.5 text-xs text-fg-muted">
									{runLine}
								</p>
							)}
							{(filter.hasAnchor || label) && (
								<div className="mt-1.5 flex flex-wrap gap-1.5">
									{filter.hasAnchor && (
										<WidenChip
											widen={{
												anchorCount: 1,
												...(semanticUnavailable ? { inactive: true } : {}),
											}}
										/>
									)}
									{label && (
										<LabelChip
											label={{
												labelId: label.id,
												name: label.name,
												color: label.color,
											}}
										/>
									)}
								</div>
							)}
						</button>
						{runnable && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => onRunNow(filter.filterId)}
								disabled={busy}
								aria-label={`Run now: filter ${filter.name}`}
							>
								{busy ? "Running…" : "Run now"}
							</Button>
						)}
						{!expired && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => onToggle(filter.filterId, disabled)}
								disabled={togglingFilterId === filter.filterId}
								aria-label={`${disabled ? "Turn on" : "Turn off"} filter ${filter.name}`}
							>
								{disabled ? "Turn on" : "Turn off"}
							</Button>
						)}
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
