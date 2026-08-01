import { Bug } from "lucide-react";
import { openBugReport } from "@/lib/bug-report";

/**
 * The mobile drawer's bug-report row — a full-width labeled control beside
 * Settings, where an icon-only button would be unreachable and ambiguous
 * (#685). Above the drawer, the shell's top bar carries this action.
 */
export function BugReportButton() {
	return (
		<button
			type="button"
			onClick={openBugReport}
			className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm text-fg-muted transition-colors hover:bg-surface hover:text-fg"
		>
			<Bug className="size-4 shrink-0" />
			<span className="flex-1 truncate text-left">Report a bug</span>
		</button>
	);
}
