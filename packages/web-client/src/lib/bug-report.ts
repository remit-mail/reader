import {
	APP_BUILD_TIME,
	APP_SHA,
	APP_SHORT_SHA,
	GITHUB_NEW_ISSUE_URL,
} from "./app-info";
import { getRecentErrors } from "./console-errors";

export interface BugReportContext {
	appSha: string;
	appShortSha: string;
	appBuildTime: string;
	userAgent: string;
	viewport: string;
	timestamp: string;
	timezone: string;
	href: string;
	recentErrors: readonly string[];
}

export function buildBugReportContext(): BugReportContext {
	return {
		appSha: APP_SHA,
		appShortSha: APP_SHORT_SHA,
		appBuildTime: APP_BUILD_TIME,
		userAgent: navigator.userAgent,
		viewport: `${window.innerWidth}×${window.innerHeight}`,
		timestamp: new Date().toISOString(),
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		href: window.location.href,
		recentErrors: getRecentErrors(),
	};
}

function buildIssueBody(ctx: BugReportContext): string {
	const errorSection =
		ctx.recentErrors.length > 0
			? ctx.recentErrors.map((e) => `  - ${e}`).join("\n")
			: "  (none)";

	return [
		"## Environment",
		`- **Version**: [\`${ctx.appShortSha}\`](https://github.com/remit-mail/remit/commit/${ctx.appSha}) built ${ctx.appBuildTime}`,
		`- **Browser**: ${ctx.userAgent}`,
		`- **Viewport**: ${ctx.viewport}`,
		`- **Time**: ${ctx.timestamp} (${ctx.timezone})`,
		"",
		"## URL",
		ctx.href,
		"",
		"## Recent console errors",
		errorSection,
		"",
		"## Steps to reproduce",
		"1. ",
		"",
		"## Expected behaviour",
		"",
		"## Actual behaviour",
		"",
	].join("\n");
}

export function buildGitHubIssueUrl(ctx: BugReportContext): string {
	const title = `Bug: `;
	const body = buildIssueBody(ctx);
	const params = new URLSearchParams({ title, body });
	return `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`;
}
