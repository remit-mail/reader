import { Bug } from "lucide-react";
import { Badge } from "./badge.js";
import { Button } from "./button.js";
import {
	type SyncWarningEntry,
	syncWarningSummary,
} from "./sync-warning-report.js";

export interface SyncWarningRowProps {
	entry: SyncWarningEntry;
	onReport: (entry: SyncWarningEntry) => void;
}

function formatCreatedAt(epochMillis: number): string {
	return new Date(epochMillis).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

export function SyncWarningRow({ entry, onReport }: SyncWarningRowProps) {
	const gaveUp = entry.state === "GaveUp";
	return (
		<li className="flex flex-col gap-2 border-b border-line px-row-inset py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
			<div className="min-w-0 space-y-1">
				<p className="text-sm text-fg">{syncWarningSummary(entry)}</p>
				<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-subtle">
					<Badge tone={gaveUp ? "danger" : "warning"}>
						{gaveUp ? "Gave up" : "Retrying"}
					</Badge>
					<span className="truncate">{entry.folderLabel}</span>
					<span aria-hidden>·</span>
					<span>{`uid ${entry.uid}`}</span>
					<span aria-hidden>·</span>
					<span>{`since ${formatCreatedAt(entry.createdAt)}`}</span>
					<span aria-hidden>·</span>
					<span>{`${entry.attempts} attempts`}</span>
				</p>
			</div>
			<Button
				variant="secondary"
				size="sm"
				className="shrink-0"
				icon={<Bug className="size-3.5" />}
				onClick={() => onReport(entry)}
			>
				Cut a bug
			</Button>
		</li>
	);
}
