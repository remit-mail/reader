import { Button } from "@remit/ui";
import { Bug } from "lucide-react";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";

interface BugReportButtonProps {
	/**
	 * `icon` (default) is the compact ghost icon button used in the desktop
	 * message toolbar. `drawer` renders a full-width labeled row to sit beside
	 * Settings in the mobile drawer footer, where an icon-only control would be
	 * unreachable/ambiguous (#685).
	 */
	variant?: "icon" | "drawer";
}

const openBugReport = () => {
	const ctx = buildBugReportContext();
	const url = buildGitHubIssueUrl(ctx);
	window.open(url, "_blank", "noopener,noreferrer");
};

export function BugReportButton({ variant = "icon" }: BugReportButtonProps) {
	if (variant === "drawer") {
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

	return (
		<Button
			variant="ghost"
			size="sm"
			icon={<Bug className="size-4" />}
			title="Report a bug"
			aria-label="Report a bug"
			onClick={openBugReport}
		/>
	);
}
