import { CheckCircle2 } from "lucide-react";
import type { SyncWarningEntry } from "./sync-warning-report.js";
import { SyncWarningRow } from "./sync-warning-row.js";

export interface SyncWarningSectionProps {
	entries: readonly SyncWarningEntry[];
	total: number;
	onReport: (entry: SyncWarningEntry) => void;
}

export function SyncWarningSection({
	entries,
	total,
	onReport,
}: SyncWarningSectionProps) {
	return (
		<section className="space-y-3">
			<header className="space-y-1">
				<h2 className="text-sm font-semibold text-fg">
					Messages that failed to sync
				</h2>
				<p className="text-xs text-fg-muted">
					A message shows here after three failed rounds and leaves on its own
					once it syncs. The rest of the folder keeps syncing.
				</p>
			</header>

			{entries.length === 0 && (
				<div className="flex items-center gap-2 rounded-sm border border-line bg-surface px-row-inset py-3">
					<CheckCircle2 className="size-4 shrink-0 text-positive" aria-hidden />
					<p className="text-sm text-fg-muted">
						Every message is syncing. Nothing has failed.
					</p>
				</div>
			)}

			{total > entries.length && (
				<p className="text-xs text-fg-muted">
					{`Showing the ${entries.length} newest of ${total} messages that failed to sync.`}
				</p>
			)}

			{entries.length > 0 && (
				<ul className="rounded-sm border border-line bg-surface">
					{entries.map((entry) => (
						<SyncWarningRow
							key={entry.syncWarningId}
							entry={entry}
							onReport={onReport}
						/>
					))}
				</ul>
			)}
		</section>
	);
}
