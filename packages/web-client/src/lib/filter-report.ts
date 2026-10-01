import { buildBugReportContext, buildGitHubIssueUrl } from "./bug-report";

export function filterToggleReportHref(message: string): string {
	return buildGitHubIssueUrl(
		buildBugReportContext({
			title: `Filter toggle: ${message}`,
			errorMessage: message,
		}),
	);
}

export function filterRunReportHref(message: string): string {
	return buildGitHubIssueUrl(
		buildBugReportContext({
			title: `Filter run now: ${message}`,
			errorMessage: message,
		}),
	);
}
