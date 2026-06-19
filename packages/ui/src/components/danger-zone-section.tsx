import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

export interface DangerZoneSectionProps {
	title: string;
	description: ReactNode;
	/** The destructive action control (a danger Button). */
	action: ReactNode;
}

/**
 * GitHub-style red offboarding block. Its own section, never bolted into a
 * list — keep markup and labels here so the story and the live route can't
 * drift (#791).
 */
export function DangerZoneSection({
	title,
	description,
	action,
}: DangerZoneSectionProps) {
	return (
		<div className="rounded-sm border border-danger/50">
			<div className="flex items-center gap-2 border-b border-danger/30 bg-danger-soft px-row-inset py-2">
				<AlertTriangle className="size-4 text-danger" />
				<h2 className="text-sm font-semibold text-danger">Danger zone</h2>
			</div>
			<div className="flex flex-col gap-3 px-row-inset py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
				<div className="min-w-0">
					<div className="text-sm font-medium text-fg">{title}</div>
					<p className="text-xs text-fg-muted">{description}</p>
				</div>
				<div className="shrink-0">{action}</div>
			</div>
		</div>
	);
}
