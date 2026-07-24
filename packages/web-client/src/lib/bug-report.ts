import type { QuarantineReportSections } from "@remit/ui";
import {
	APP_BUILD_TIME,
	APP_SHORT_SHA,
	GITHUB_COMMIT_URL,
	GITHUB_NEW_ISSUE_URL,
} from "./app-info";
import { getRecentErrors } from "./console-errors";
import {
	getFailingRequest,
	getRecentRequests,
	type RequestBreadcrumb,
} from "./request-breadcrumbs";
import { getRecentRoutes, type RouteBreadcrumb } from "./route-breadcrumbs";

/**
 * A GitHub new-issue URL is capped (~8 KB). We budget below that so the stack
 * is truncated to fit rather than producing a URL GitHub silently rejects. The
 * untruncated report is always available via `buildBugReportDetails` (the
 * overlay's "Copy full details" action).
 */
const MAX_ISSUE_URL_LENGTH = 7500;

const TRUNCATION_MARKER =
	"\n… (truncated — the copy action on this screen has the full report)";

export interface BugReportContext {
	appShortSha: string;
	/** Commit URL for the build, or undefined for a local "dev" build (no link). */
	appCommitUrl?: string;
	appBuildTime: string;
	userAgent: string;
	viewport: string;
	timestamp: string;
	timezone: string;
	href: string;
	recentErrors: readonly string[];
	/** Recent API calls, metadata only — method/path/status/duration/correlation. */
	requests: readonly RequestBreadcrumb[];
	/** Recent in-app navigations, oldest first. */
	routes: readonly RouteBreadcrumb[];
	/** The request that most likely triggered the report (transport or >= 400). */
	failingRequest?: RequestBreadcrumb;
	/** The message of the error that triggered the report, when seeded from one. */
	errorMessage?: string;
	/** The error's stacktrace, when available. */
	stack?: string;
	/** React component stack from the error boundary, when available. */
	componentStack?: string;
	/**
	 * A quarantined message's diagnostics, when the report is filed from the
	 * quarantine surface. Split into sections by `quarantineReportSections` in
	 * @remit/ui so the MIME tree is fenced after truncation, never before.
	 */
	quarantine?: QuarantineReportSections;
	/** Overrides the derived title, e.g. for a quarantine report. */
	title?: string;
}

/** Fields callers can seed from a caught error. */
export interface BugReportSeed {
	errorMessage?: string;
	stack?: string;
	componentStack?: string;
	quarantine?: QuarantineReportSections;
	/** Overrides the derived title, e.g. for a quarantine report. */
	title?: string;
}

export function buildBugReportContext(seed?: BugReportSeed): BugReportContext {
	return {
		appShortSha: APP_SHORT_SHA,
		appCommitUrl: GITHUB_COMMIT_URL,
		appBuildTime: APP_BUILD_TIME,
		userAgent: navigator.userAgent,
		viewport: `${window.innerWidth}×${window.innerHeight}`,
		timestamp: new Date().toISOString(),
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		href: window.location.href,
		recentErrors: getRecentErrors(),
		requests: getRecentRequests(),
		routes: getRecentRoutes(),
		failingRequest: getFailingRequest(),
		errorMessage: seed?.errorMessage,
		stack: seed?.stack,
		componentStack: seed?.componentStack,
		quarantine: seed?.quarantine,
		title: seed?.title,
	};
}

function fencedBlock(content: string): string {
	return ["```", content, "```"].join("\n");
}

/** `2024-06-12T08:00:01.234Z` → `08:00:01` — the wall-clock time, compact. */
function clockTime(iso: string): string {
	const match = /T(\d{2}:\d{2}:\d{2})/.exec(iso);
	return match ? match[1] : iso;
}

function versionLine(ctx: BugReportContext): string {
	const version = ctx.appCommitUrl
		? `[\`${ctx.appShortSha}\`](${ctx.appCommitUrl})`
		: `\`${ctx.appShortSha}\``;
	return `- **Version**: ${version} built ${ctx.appBuildTime}`;
}

function failingRequestSection(request: RequestBreadcrumb): string[] {
	const status =
		request.status === 0
			? "no response (transport failure)"
			: `${request.status}`;
	return [
		"## Failing request",
		`- **Endpoint**: \`${request.path}\``,
		`- **Method**: ${request.method}`,
		`- **Status**: ${status}`,
		`- **Correlation id**: ${request.correlationId ?? "(none)"}`,
		"",
	];
}

function requestsSection(requests: readonly RequestBreadcrumb[]): string[] {
	if (requests.length === 0) {
		return ["## Recent API requests", "(none)", ""];
	}
	const rows = requests.map((r) => {
		const status = r.status === 0 ? "ERR" : `${r.status}`;
		return `| ${clockTime(r.timestamp)} | ${r.method} | \`${r.path}\` | ${status} | ${r.durationMs}ms | ${r.correlationId ?? ""} |`;
	});
	return [
		"## Recent API requests",
		"| Time | Method | Path | Status | Duration | Correlation |",
		"| --- | --- | --- | --- | --- | --- |",
		...rows,
		"",
	];
}

function navigationSection(routes: readonly RouteBreadcrumb[]): string[] {
	if (routes.length === 0) {
		return ["## Navigation trail", "(none)", ""];
	}
	const rows = routes.map((r) => `- ${clockTime(r.timestamp)} \`${r.path}\``);
	return ["## Navigation trail", ...rows, ""];
}

interface BodyOverrides {
	stack?: string;
	/** Replaces the MIME-tree section only; it is fenced after this is applied. */
	quarantineStructure?: string;
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
		versionLine(ctx),
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

	if (ctx.failingRequest) {
		lines.push(...failingRequestSection(ctx.failingRequest));
	}

	if (ctx.quarantine) {
		const structure =
			overrides?.quarantineStructure ?? ctx.quarantine.structure;
		lines.push(
			ctx.quarantine.head,
			"",
			fencedBlock(structure),
			"",
			ctx.quarantine.disclaimer,
			"",
		);
	}

	const resolvedStack = overrides?.stack ?? ctx.stack;
	if (resolvedStack) {
		lines.push("## Stacktrace", fencedBlock(resolvedStack), "");
	}

	if (ctx.componentStack) {
		lines.push("## Component stack", fencedBlock(ctx.componentStack), "");
	}

	lines.push(...requestsSection(ctx.requests));
	lines.push(...navigationSection(ctx.routes));

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
 * URL budget, the longest truncatable section — a stacktrace, or a quarantine
 * report's MIME tree — is binary-searched to the longest prefix that fits and
 * marked; everything else is preserved. The component stack is dropped from
 * the URL when truncation kicks in — it survives in the copy-details report.
 *
 * The quarantine MIME tree is handed over unfenced and fenced by
 * `buildIssueBody` afterwards, so a cut can never land inside a code fence.
 * The disclaimer is appended by the builder rather than carried in the
 * truncated text, so a truncated report still states what was withheld.
 */
export function buildGitHubIssueUrl(ctx: BugReportContext): string {
	const full = issueUrl(ctx);
	if (full.length <= MAX_ISSUE_URL_LENGTH) return full;

	const withoutComponentStack: BugReportContext = {
		...ctx,
		componentStack: undefined,
	};

	// Both sections can be present — a seed is not discriminated — and cutting
	// one to nothing does not necessarily fit the other. Truncate the longest
	// first and keep going while the budget is still exceeded.
	const sections: Array<[keyof BodyOverrides, string]> = [];
	if (ctx.stack) sections.push(["stack", ctx.stack]);
	if (ctx.quarantine?.structure) {
		sections.push(["quarantineStructure", ctx.quarantine.structure]);
	}
	sections.sort((a, b) => b[1].length - a[1].length);

	let overrides: BodyOverrides = {};
	for (const [field, text] of sections) {
		if (
			issueUrl(withoutComponentStack, overrides).length <= MAX_ISSUE_URL_LENGTH
		) {
			break;
		}
		let lo = 0;
		let hi = text.length;
		let best = 0;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const candidate = issueUrl(withoutComponentStack, {
				...overrides,
				[field]: text.slice(0, mid) + TRUNCATION_MARKER,
			});
			if (candidate.length <= MAX_ISSUE_URL_LENGTH) {
				best = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		overrides = {
			...overrides,
			[field]: text.slice(0, best) + TRUNCATION_MARKER,
		};
	}

	return issueUrl(withoutComponentStack, overrides);
}
