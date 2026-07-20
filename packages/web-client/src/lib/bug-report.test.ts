import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	QUARANTINE_REPORT_DISCLAIMER,
	type QuarantineEntry,
	quarantineDemoEntries,
	quarantineIssueTitle,
	quarantineReportSections,
} from "@remit/ui";
import type { BugReportContext } from "./bug-report";
import { buildBugReportDetails, buildGitHubIssueUrl } from "./bug-report";

const baseCtx: BugReportContext = {
	appSha: "abcdef1234567890abcdef1234567890abcdef12",
	appShortSha: "abcdef1",
	appBuildTime: "2024-01-15T10:30:00.000Z",
	userAgent: "Mozilla/5.0 (Test Browser)",
	viewport: "1440×900",
	timestamp: "2024-06-12T08:00:00.000Z",
	timezone: "Europe/Amsterdam",
	href: "https://app.example.com/mail/inbox?q=test",
	recentErrors: [],
};

/**
 * URLSearchParams encodes spaces as `+`, but decodeURIComponent does not
 * decode `+` back to space. Replace `+` first so assertions on
 * human-readable strings work as expected.
 */
function decode(url: string): string {
	return decodeURIComponent(url.replaceAll("+", " "));
}

describe("buildGitHubIssueUrl", () => {
	it("returns a URL pointing at the GitHub new-issue endpoint", () => {
		const url = buildGitHubIssueUrl(baseCtx);
		assert.ok(
			url.startsWith("https://github.com/remit-mail/reader/issues/new?"),
			`Expected GitHub issues URL, got: ${url}`,
		);
	});

	it("prefills a title param", () => {
		const url = buildGitHubIssueUrl(baseCtx);
		assert.ok(url.includes("title="), "Expected a title param");
	});

	it("includes the short SHA in the body", () => {
		const url = buildGitHubIssueUrl(baseCtx);
		const decoded = decode(url);
		assert.ok(decoded.includes("abcdef1"), "Expected short SHA in body");
	});

	it("includes the full SHA commit link in the body", () => {
		const url = buildGitHubIssueUrl(baseCtx);
		const decoded = decode(url);
		assert.ok(
			decoded.includes("abcdef1234567890abcdef1234567890abcdef12"),
			"Expected full SHA in commit link",
		);
	});

	it("includes build time in the body", () => {
		const url = buildGitHubIssueUrl(baseCtx);
		const decoded = decode(url);
		assert.ok(
			decoded.includes("2024-01-15T10:30:00.000Z"),
			"Expected build time in body",
		);
	});

	it("includes the user agent", () => {
		const url = buildGitHubIssueUrl(baseCtx);
		const decoded = decode(url);
		assert.ok(
			decoded.includes("Mozilla/5.0 (Test Browser)"),
			"Expected userAgent in body",
		);
	});

	it("includes the viewport", () => {
		const url = buildGitHubIssueUrl(baseCtx);
		const decoded = decode(url);
		assert.ok(decoded.includes("1440×900"), "Expected viewport in body");
	});

	it("includes the timestamp", () => {
		const url = buildGitHubIssueUrl(baseCtx);
		const decoded = decode(url);
		assert.ok(
			decoded.includes("2024-06-12T08:00:00.000Z"),
			"Expected timestamp in body",
		);
	});

	it("includes the timezone", () => {
		const url = buildGitHubIssueUrl(baseCtx);
		const decoded = decode(url);
		assert.ok(
			decoded.includes("Europe/Amsterdam"),
			"Expected timezone in body",
		);
	});

	it("includes the page URL", () => {
		const url = buildGitHubIssueUrl(baseCtx);
		const decoded = decode(url);
		assert.ok(
			decoded.includes("https://app.example.com/mail/inbox"),
			"Expected page href in body",
		);
	});

	it("shows (none) when there are no recent errors", () => {
		const url = buildGitHubIssueUrl({ ...baseCtx, recentErrors: [] });
		const decoded = decode(url);
		assert.ok(decoded.includes("(none)"), "Expected (none) for empty errors");
	});

	it("includes recent console errors when present", () => {
		const ctx: BugReportContext = {
			...baseCtx,
			recentErrors: [
				"TypeError: Cannot read property x of undefined",
				"Network error: 503",
			],
		};
		const url = buildGitHubIssueUrl(ctx);
		const decoded = decode(url);
		assert.ok(
			decoded.includes("TypeError: Cannot read property"),
			"Expected first error in body",
		);
		assert.ok(
			decoded.includes("Network error: 503"),
			"Expected second error in body",
		);
	});

	it("keeps the URL parseable after encoding", () => {
		const ctx: BugReportContext = {
			...baseCtx,
			recentErrors: ["Error: something & weird <happened>"],
		};
		const url = buildGitHubIssueUrl(ctx);
		assert.doesNotThrow(() => new URL(url), "URL must be valid");
	});
});

describe("buildGitHubIssueUrl — seeded from a caught error", () => {
	const seededCtx: BugReportContext = {
		...baseCtx,
		errorMessage: "date value is not finite in DateTimeFormat format()",
		stack: "Error: date value is not finite\n    at format (util.ts:12)",
		componentStack: "\n    at AccountsSettings\n    at Route",
	};

	it("puts the error message in the title", () => {
		const url = buildGitHubIssueUrl(seededCtx);
		const decoded = decode(url);
		assert.ok(
			decoded.includes("title=Bug: date value is not finite"),
			"Expected the error message in the issue title",
		);
	});

	it("includes the stacktrace and component stack in the body", () => {
		const decoded = decode(buildGitHubIssueUrl(seededCtx));
		assert.ok(
			decoded.includes("## Stacktrace"),
			"Expected a stacktrace section",
		);
		assert.ok(
			decoded.includes("at format (util.ts:12)"),
			"Expected the stack frame in the body",
		);
		assert.ok(
			decoded.includes("## Component stack"),
			"Expected a component-stack section",
		);
	});
});

describe("buildGitHubIssueUrl — truncation to fit the URL budget", () => {
	const hugeStack = `Error: boom\n${"    at frame (file.ts:1)\n".repeat(2000)}`;
	const hugeCtx: BugReportContext = {
		...baseCtx,
		errorMessage: "boom",
		stack: hugeStack,
	};

	it("keeps the truncated URL under the GitHub length limit", () => {
		const url = buildGitHubIssueUrl(hugeCtx);
		assert.ok(
			url.length <= 8000,
			`Expected a URL under 8000 chars, got ${url.length}`,
		);
	});

	it("marks the body as truncated and stays a valid URL", () => {
		const url = buildGitHubIssueUrl(hugeCtx);
		assert.ok(
			decode(url).includes("truncated"),
			"Expected a truncation marker",
		);
		assert.doesNotThrow(() => new URL(url), "Truncated URL must be valid");
	});

	it("Copy full details keeps the whole stacktrace (nothing lost)", () => {
		const details = buildBugReportDetails(hugeCtx);
		assert.ok(
			details.includes(hugeStack),
			"Expected the full untruncated stack in the copy-details report",
		);
		assert.ok(
			details.length > buildGitHubIssueUrl(hugeCtx).length,
			"Full details should be longer than the truncated URL body",
		);
	});
});

describe("quarantine reports", () => {
	// A flat multipart/mixed of 200 parts — the shape that first broke the
	// fence. A message with a pathological part count is precisely the message
	// that fails to parse, so a long report is the common case, not the tail.
	const entry: QuarantineEntry = {
		...quarantineDemoEntries[0],
		structure: [
			{ depth: 0, contentType: "multipart/mixed" },
			...Array.from({ length: 200 }, () => ({
				depth: 1,
				contentType: "application/octet-stream",
			})),
		],
	};

	const ctx = (over?: Partial<BugReportContext>): BugReportContext => ({
		...baseCtx,
		title: quarantineIssueTitle(entry),
		quarantine: quarantineReportSections(entry),
		...over,
	});

	const fenceCount = (body: string): number =>
		(body.match(/^```/gm) ?? []).length;

	it("carries the diagnostics section and the supplied title", () => {
		const decoded = decode(
			buildGitHubIssueUrl(
				ctx({ quarantine: quarantineReportSections(quarantineDemoEntries[0]) }),
			),
		);
		assert.ok(decoded.includes("UnreadableBody"));
		assert.ok(decoded.includes("Message quarantined:"));
	});

	it("truncates a long report without cutting inside the code fence", () => {
		const url = buildGitHubIssueUrl(ctx());
		const body = decode(url);
		assert.ok(
			url.length <= 8000,
			`Expected a URL under 8000 chars, got ${url.length}`,
		);
		assert.ok(body.includes("truncated"), "Expected a truncation marker");
		assert.equal(
			fenceCount(body) % 2,
			0,
			`Unbalanced code fence in truncated body:\n${body.slice(-400)}`,
		);
	});

	it("keeps the redaction disclaimer on a truncated report", () => {
		const body = decode(buildGitHubIssueUrl(ctx()));
		assert.ok(
			body.includes(QUARANTINE_REPORT_DISCLAIMER),
			"A truncated report must still state what was withheld",
		);
	});

	it("keeps the reproduction template outside the code block", () => {
		const body = decode(buildGitHubIssueUrl(ctx()));
		const afterLastFence = body.slice(body.lastIndexOf("```") + 3);
		assert.ok(afterLastFence.includes("## Steps to reproduce"));
	});

	it("truncates the longer section when a stack is present too", () => {
		const url = buildGitHubIssueUrl(
			ctx({ stack: "at foo\n".repeat(2000), errorMessage: "boom" }),
		);
		assert.ok(
			url.length <= 8000,
			`Expected a URL under 8000 chars, got ${url.length}`,
		);
	});

	it("Copy full details keeps every part the URL had to drop", () => {
		const parts = (text: string): number =>
			(text.match(/- application\/octet-stream/g) ?? []).length;
		const details = buildBugReportDetails(ctx());
		assert.equal(parts(details), 200);
		assert.ok(
			parts(decode(buildGitHubIssueUrl(ctx()))) < 200,
			"Expected the URL body to have dropped parts",
		);
	});
});
