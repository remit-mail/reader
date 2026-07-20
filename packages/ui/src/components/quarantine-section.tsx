import { CheckCircle2, TriangleAlert } from "lucide-react";
import { Banner } from "./banner.js";
import { QuarantineEntryRow } from "./quarantine-entry-row.js";
import type { QuarantineEntry } from "./quarantine-report.js";

export interface QuarantineSectionProps {
	entries: readonly QuarantineEntry[];
	onCutBug: (entry: QuarantineEntry) => void;
}

/**
 * The quarantine list in settings.
 *
 * A message that could not be read was never written, so it cannot be found
 * anywhere else — this list is the only record that it existed. One entry is a
 * fact and reads as one. More than one is a pattern, and a pattern is a bug, so
 * it raises an alert.
 */
export function QuarantineSection({
	entries,
	onCutBug,
}: QuarantineSectionProps) {
	return (
		<section className="space-y-3">
			<header className="space-y-1">
				<h2 className="text-sm font-semibold text-fg">Messages set aside</h2>
				<p className="text-xs text-fg-muted">
					Mail Remit could not read is set aside here instead of being skipped,
					so nothing goes missing quietly. The rest of the folder keeps syncing.
					Recovering a set-aside message is a re-sync, not a per-row action.
				</p>
			</header>

			{entries.length === 0 && (
				<div className="flex items-center gap-2 rounded-sm border border-line bg-surface px-row-inset py-3">
					<CheckCircle2 className="size-4 shrink-0 text-positive" aria-hidden />
					<p className="text-sm text-fg-muted">
						Every message has been read successfully. Nothing is set aside.
					</p>
				</div>
			)}

			{entries.length > 1 && (
				<Banner tone="warning">
					<p className="flex items-start gap-2">
						<TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
						<span>
							<span className="font-semibold">
								{`${entries.length} messages could not be read.`}
							</span>{" "}
							More than one means something is wrong with how Remit reads mail,
							not with the mail. Reporting one of these gets it fixed.
						</span>
					</p>
				</Banner>
			)}

			{entries.length > 0 && (
				<ul className="rounded-sm border border-line bg-surface">
					{entries.map((entry) => (
						<QuarantineEntryRow
							key={entry.quarantineId}
							entry={entry}
							onCutBug={onCutBug}
						/>
					))}
				</ul>
			)}
		</section>
	);
}
