import { Bug, Loader2, RotateCw } from "lucide-react";
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
	onRetry: (entry: QuarantineEntry) => void;
	/** The row is waiting on a re-queue it already asked for. */
	retrying?: boolean;
}

function formatQuarantinedAt(epochMillis: number): string {
	return new Date(epochMillis).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

/**
 * One quarantined message. Leads with what went wrong in plain language; the
 * folder, uid and time sit underneath as the identifying detail. The two
 * actions are the only two things a user can do about it — file the bug, or
 * ask for another attempt.
 */
export function QuarantineEntryRow({
	entry,
	onCutBug,
	onRetry,
	retrying = false,
}: QuarantineEntryRowProps) {
	return (
		<li className="flex flex-col gap-2 border-b border-line px-row-inset py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
			<div className="min-w-0 space-y-1">
				<p className="text-sm text-fg">
					{quarantineSummary(entry.failureStage)}
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
			<div className="flex shrink-0 gap-2">
				<Button
					variant="secondary"
					size="sm"
					icon={<Bug className="size-3.5" />}
					onClick={() => onCutBug(entry)}
				>
					Cut a bug
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={retrying}
					icon={
						retrying ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<RotateCw className="size-3.5" />
						)
					}
					onClick={() => onRetry(entry)}
				>
					{retrying ? "Retrying…" : "Try again"}
				</Button>
			</div>
		</li>
	);
}
