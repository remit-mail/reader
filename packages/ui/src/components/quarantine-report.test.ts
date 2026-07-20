import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatQuarantineReport,
	type QuarantineEntry,
	quarantineIssueUrl,
	quarantineSummary,
} from "./quarantine-report.js";

const entry: QuarantineEntry = {
	quarantineId: "q-1",
	uid: 40217,
	mailboxRole: "inbox",
	mailboxPath: "Clients/Acme Holdings",
	failureStage: "MimeStructure",
	failureCode: "UnterminatedMultipartBoundary",
	failureMessage: "multipart boundary was never closed",
	quarantinedAt: Date.parse("2026-07-18T09:12:00Z"),
	attempts: 3,
	sizeBytes: 184_233,
	contentType: "multipart/mixed",
	transferEncoding: "7bit",
	charset: "utf-8",
	structure: {
		contentType: "multipart/mixed",
		parts: [
			{
				contentType: "multipart/alternative",
				parts: [{ contentType: "text/plain" }, { contentType: "text/html" }],
			},
			{ contentType: "application/pdf" },
		],
	},
	headerNames: ["Date", "From", "Subject", "Content-Type"],
	messageIdHash: "sha256:6f1c4a",
	appVersion: "0.14.2",
};

describe("formatQuarantineReport", () => {
	it("names the stage, the code and the build that failed", () => {
		const report = formatQuarantineReport(entry);
		assert.match(report, /MimeStructure/);
		assert.match(report, /UnterminatedMultipartBoundary/);
		assert.match(report, /0\.14\.2/);
	});

	it("renders the MIME tree as structure with no content", () => {
		const report = formatQuarantineReport(entry);
		assert.match(report, /\n- multipart\/mixed/);
		assert.match(report, /\n {2}- multipart\/alternative/);
		assert.match(report, /\n {4}- text\/html/);
		assert.match(report, /\n {2}- application\/pdf/);
	});

	it("withholds the user's own folder name", () => {
		const report = formatQuarantineReport(entry);
		assert.doesNotMatch(report, /Acme Holdings/);
		assert.match(report, /Folder role.*inbox/);
	});

	it("carries header names without header values", () => {
		const report = formatQuarantineReport(entry);
		assert.match(report, /Date, From, Subject, Content-Type/);
	});

	it("marks an undeclared charset rather than omitting it", () => {
		const report = formatQuarantineReport({ ...entry, charset: null });
		assert.match(report, /Charset.*not declared/);
	});
});

describe("quarantineIssueUrl", () => {
	it("prefills a titled, labelled issue against the repository", () => {
		const url = quarantineIssueUrl(
			entry,
			"https://github.com/remit-mail/reader",
		);
		assert.ok(
			url.startsWith("https://github.com/remit-mail/reader/issues/new?"),
		);
		const params = new URLSearchParams(url.split("?")[1]);
		assert.equal(params.get("labels"), "quarantine");
		assert.match(params.get("title") ?? "", /UnterminatedMultipartBoundary/);
		assert.equal(params.get("body"), formatQuarantineReport(entry));
	});
});

describe("quarantineSummary", () => {
	it("explains each stage without parser jargon", () => {
		const summary = quarantineSummary("CharsetDecode");
		assert.match(summary, /encoding/);
		assert.doesNotMatch(summary, /MIME|RFC|parser|charset=/i);
	});
});
