import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BugReportContext } from "./bug-report";
import { buildGitHubIssueUrl } from "./bug-report";

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
			url.startsWith("https://github.com/remit-mail/remit/issues/new?"),
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
