import type { QuarantineReportSections } from "@remit/ui";
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
	"\n… (truncated — the copy action on this screen has the full report)";

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
		quarantine: seed?.quarantine,
		title: seed?.title,
	};
}

function fencedBlock(content: string): string {
	return ["```", content, "```"].join("\n");
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
