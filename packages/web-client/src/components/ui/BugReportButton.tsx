import { Button } from "@remit/ui";
import { Bug } from "lucide-react";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";

export function BugReportButton() {
	const handleClick = () => {
		const ctx = buildBugReportContext();
		const url = buildGitHubIssueUrl(ctx);
		window.open(url, "_blank", "noopener,noreferrer");
	};

	return (
		<Button
			variant="ghost"
			size="sm"
			icon={<Bug className="size-4" />}
			title="Report a bug"
			aria-label="Report a bug"
			onClick={handleClick}
		/>
	);
}
