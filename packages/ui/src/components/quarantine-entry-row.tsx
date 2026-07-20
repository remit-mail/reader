import { Bug } from "lucide-react";
import { Badge } from "./badge.js";
import { Button } from "./button.js";
import { canonicalRoleLabel, providerLeaf } from "./folder-role.js";
import {
	type QuarantineEntry,
	quarantineSummary,
} from "./quarantine-report.js";

export interface QuarantineEntryRowProps {
	entry: QuarantineEntry;
	onCutBug: (entry: QuarantineEntry) => void;
}

function formatQuarantinedAt(epochMillis: number): string {
	return new Date(epochMillis).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

/**
 * One quarantined message. Leads with what went wrong in plain language, then
 * the parser's own words — which stay on this screen and never enter a report
 * — and the folder, uid and time as identifying detail.
 */
export function QuarantineEntryRow({
	entry,
	onCutBug,
}: QuarantineEntryRowProps) {
	return (
		<li className="flex flex-col gap-2 border-b border-line px-row-inset py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
			<div className="min-w-0 space-y-1">
				<p className="text-sm text-fg">
					{quarantineSummary(entry.failureStage)}
				</p>
				<p
					className="truncate text-xs text-fg-muted"
					title={entry.failureMessage}
				>
					{entry.failureMessage}
				</p>
				<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-subtle">
					<Badge tone="warning">{canonicalRoleLabel(entry.mailboxRole)}</Badge>
					<span className="truncate" title={entry.mailboxPath}>
						{providerLeaf(entry.mailboxPath)}
					</span>
					<span aria-hidden>·</span>
					<span>{`uid ${entry.uid}`}</span>
					<span aria-hidden>·</span>
					<span>{formatQuarantinedAt(entry.quarantinedAt)}</span>
					{entry.attempts > 1 && (
						<>
							<span aria-hidden>·</span>
							<span>{`${entry.attempts} attempts`}</span>
						</>
					)}
				</p>
			</div>
			<Button
				variant="secondary"
				size="sm"
				className="shrink-0"
				icon={<Bug className="size-3.5" />}
				onClick={() => onCutBug(entry)}
			>
				Cut a bug
			</Button>
		</li>
	);
}
