import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quarantineDemoEntries } from "./quarantine-fixtures.js";
import {
	formatQuarantineReport,
	type QuarantineEntry,
	quarantineIssueTitle,
	quarantineSummary,
} from "./quarantine-report.js";

const entry: QuarantineEntry = {
	...quarantineDemoEntries[0],
	mailboxPath: "Clients/Acme Holdings",
	failureMessage: "invalid address: joan@acme-holdings.example",
};

describe("formatQuarantineReport", () => {
	it("names the stage, the code and the build that failed", () => {
		const report = formatQuarantineReport(entry);
		assert.match(report, /BodyParse/);
		assert.match(report, /UnterminatedMultipartBoundary/);
		assert.match(report, /worker 1\.0\.0/);
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

	it("withholds the parser's own error text, which can quote the input", () => {
		const report = formatQuarantineReport(entry);
		assert.doesNotMatch(report, /joan@acme-holdings\.example/);
		assert.doesNotMatch(report, /invalid address/);
	});

	it("strips content-type parameters, which carry attachment filenames", () => {
		const report = formatQuarantineReport({
			...entry,
			contentType: 'multipart/mixed; boundary="=_a1b2"',
			structure: {
				contentType: "multipart/mixed",
				parts: [
					{
						contentType:
							'application/octet-stream; name="Q3 payroll — Acme.pdf"',
					},
				],
			},
		});
		assert.doesNotMatch(report, /payroll/);
		assert.doesNotMatch(report, /boundary/);
		assert.match(report, /- application\/octet-stream/);
	});

	it("says so when the failure is not attributable to one part", () => {
		assert.match(formatQuarantineReport(entry), /Failing part.*whole message/);
		assert.match(
			formatQuarantineReport({ ...entry, failurePartPath: "1.2" }),
			/Failing part.*`1\.2`/,
		);
	});

	it("marks an undeclared charset rather than omitting it", () => {
		const report = formatQuarantineReport({ ...entry, charset: null });
		assert.match(report, /Charset.*not declared/);
	});
});

describe("quarantineIssueTitle", () => {
	it("carries only the closed vocabulary", () => {
		const title = quarantineIssueTitle(entry);
		assert.match(title, /UnterminatedMultipartBoundary/);
		assert.match(title, /BodyParse/);
		assert.doesNotMatch(title, /joan@/);
	});
});

describe("quarantineSummary", () => {
	it("explains the stage without parser jargon", () => {
		const summary = quarantineSummary("BodyParse");
		assert.doesNotMatch(summary, /MIME|RFC|mailparser|charset=/i);
	});
});
