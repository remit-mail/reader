import {
	APP_BUILD_TIME,
	APP_SHA,
	APP_SHORT_SHA,
	GITHUB_NEW_ISSUE_URL,
} from "./app-info";
import { getRecentErrors } from "./console-errors";

/**
 * A GitHub new-issue URL is capped (~8 KB). We budget below that so the stack
 * is truncated to fit rather than producing a URL GitHub silently rejects. The
 * untruncated report is always available via `buildBugReportDetails` (the
 * overlay's "Copy full details" action).
 */
const MAX_ISSUE_URL_LENGTH = 7500;

const TRUNCATION_MARKER =
	"\n… (truncated — use “Copy full details” for the full report)";

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
	/** The message of the error that triggered the report, when seeded from one. */
	errorMessage?: string;
	/** The error's stacktrace, when available. */
	stack?: string;
	/** React component stack from the error boundary, when available. */
	componentStack?: string;
	/**
	 * A quarantined message's diagnostics, when the report is filed from the
	 * quarantine surface. Rendered by `formatQuarantineReport` in @remit/ui.
	 */
	quarantineReport?: string;
	/** Overrides the derived title, e.g. for a quarantine report. */
	title?: string;
}

/** Fields callers can seed from a caught error. */
export interface BugReportSeed {
	errorMessage?: string;
	stack?: string;
	componentStack?: string;
	quarantineReport?: string;
	/** Overrides the derived title, e.g. for a quarantine report. */
	title?: string;
}

export function buildBugReportContext(seed?: BugReportSeed): BugReportContext {
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
		errorMessage: seed?.errorMessage,
		stack: seed?.stack,
		componentStack: seed?.componentStack,
		quarantineReport: seed?.quarantineReport,
		title: seed?.title,
	};
}

function fencedBlock(content: string): string {
	return ["```", content, "```"].join("\n");
}

interface BodyOverrides {
	stack?: string;
	quarantineReport?: string;
}

function buildIssueBody(
	ctx: BugReportContext,
	overrides?: BodyOverrides,
): string {
	const errorSection =
		ctx.recentErrors.length > 0
			? ctx.recentErrors.map((e) => `  - ${e}`).join("\n")
			: "  (none)";

	const lines: string[] = [
		"## Environment",
		`- **Version**: [\`${ctx.appShortSha}\`](https://github.com/remit-mail/reader/commit/${ctx.appSha}) built ${ctx.appBuildTime}`,
		`- **Browser**: ${ctx.userAgent}`,
		`- **Viewport**: ${ctx.viewport}`,
		`- **Time**: ${ctx.timestamp} (${ctx.timezone})`,
		"",
		"## URL",
		ctx.href,
		"",
	];

	if (ctx.errorMessage) {
		lines.push("## Error", ctx.errorMessage, "");
	}

	const resolvedQuarantine =
		overrides?.quarantineReport ?? ctx.quarantineReport;
	if (resolvedQuarantine) {
		lines.push(resolvedQuarantine, "");
	}

	const resolvedStack = overrides?.stack ?? ctx.stack;
	if (resolvedStack) {
		lines.push("## Stacktrace", fencedBlock(resolvedStack), "");
	}

	if (ctx.componentStack) {
		lines.push("## Component stack", fencedBlock(ctx.componentStack), "");
	}

	lines.push(
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
	);

	return lines.join("\n");
}

function buildIssueTitle(ctx: BugReportContext): string {
	if (ctx.title) return ctx.title;
	if (!ctx.errorMessage) return "Bug: ";
	const firstLine = ctx.errorMessage.split("\n")[0].trim();
	const clipped =
		firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
	return `Bug: ${clipped}`;
}

function issueUrl(ctx: BugReportContext, overrides?: BodyOverrides): string {
	const params = new URLSearchParams({
		title: buildIssueTitle(ctx),
		body: buildIssueBody(ctx, overrides),
	});
	return `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`;
}

/**
 * The full, untruncated report — every field including the complete stacktrace
 * and component stack. Backs the overlay's "Copy full details" action so
 * nothing is lost when the URL-bound report has to truncate the stack.
 */
export function buildBugReportDetails(ctx: BugReportContext): string {
	return buildIssueBody(ctx);
}

/**
 * Build a prefilled GitHub new-issue URL. When the full body would exceed the
 * URL budget, the stacktrace is truncated (binary-searched to the longest
 * prefix that fits) and marked; everything else is preserved. The component
 * stack is dropped from the URL when truncation kicks in — it survives in the
 * "Copy full details" report.
 */
export function buildGitHubIssueUrl(ctx: BugReportContext): string {
	const full = issueUrl(ctx);
	if (full.length <= MAX_ISSUE_URL_LENGTH) return full;

	// Only one long section is ever present: a report seeded from a JS error
	// carries a stack, one seeded from quarantine carries the diagnostics.
	const field = ctx.stack !== undefined ? "stack" : "quarantineReport";
	const long = ctx.stack ?? ctx.quarantineReport ?? "";
	const withoutComponentStack: BugReportContext = {
		...ctx,
		componentStack: undefined,
	};
	const candidateFor = (text: string): string =>
		issueUrl(withoutComponentStack, { [field]: text });

	let lo = 0;
	let hi = long.length;
	let best = 0;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (
			candidateFor(long.slice(0, mid) + TRUNCATION_MARKER).length <=
			MAX_ISSUE_URL_LENGTH
		) {
			best = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}

	return candidateFor(long.slice(0, best) + TRUNCATION_MARKER);
}
