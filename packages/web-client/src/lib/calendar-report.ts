import { buildBugReportContext, buildGitHubIssueUrl } from "./bug-report";

/** A prefilled issue for an invitation answer or read that did not land. */
export function calendarReportHref(what: string): string {
	return buildGitHubIssueUrl(
		buildBugReportContext({
			title: `Calendar invitation: ${what}`,
			errorMessage: what,
		}),
	);
}

/** A prefilled issue for an event the calendar could not look up. */
export function calendarEventReportHref(what: string): string {
	return buildGitHubIssueUrl(
		buildBugReportContext({
			title: `Calendar event: ${what}`,
			errorMessage: what,
		}),
	);
}
