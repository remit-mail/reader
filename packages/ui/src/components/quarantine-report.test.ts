import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quarantineDemoEntries } from "./quarantine-fixtures.js";
import {
	formatQuarantineReport,
	QUARANTINE_REPORT_DISCLAIMER,
	type QuarantineEntry,
	quarantineIssueTitle,
	quarantineReportSections,
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
		assert.match(report, /UnreadableBody/);
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
			structure: [
				{ depth: 0, contentType: "multipart/mixed" },
				{
					depth: 1,
					contentType: 'application/octet-stream; name="Q3 payroll — Acme.pdf"',
				},
			],
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

	it("says no role was appointed rather than inventing one", () => {
		const report = formatQuarantineReport({
			...entry,
			mailboxRole: undefined,
		});
		assert.match(report, /Folder role.*none appointed/);
	});

	it("marks an undeclared charset rather than omitting it", () => {
		const report = formatQuarantineReport({ ...entry, charset: undefined });
		assert.match(report, /Charset.*not declared/);
	});

	// Absent is the wire shape: the API omits an optional diagnostic and the
	// repo maps a null column to undefined. A report that printed `undefined`
	// into a public issue would do it on the common case — a whole-body parse
	// failure has no failing part, which is every failure today.
	it("never prints undefined for a diagnostic the message did not carry", () => {
		const report = formatQuarantineReport({
			...entry,
			failurePartPath: undefined,
			charset: undefined,
			contentType: undefined,
			transferEncoding: undefined,
			sizeBytes: undefined,
			messageIdHash: undefined,
			structure: [],
		});
		assert.doesNotMatch(report, /undefined|null/);
		assert.match(report, /Failing part.*whole message/);
		assert.match(report, /Message-ID hash.*none declared/);
		assert.match(report, /no MIME structure was read/);
	});
});

describe("sender-controlled BODYSTRUCTURE strings", () => {
	// charset, transferEncoding and contentType are arbitrary quoted strings
	// chosen by whoever sent the message, echoed into an issue filed under the
	// user's own account. They are hostile input.
	const injection = "`\n\n**Click here:** https://evil.example\n\n`";

	it("cannot break out of the code span and inject markdown", () => {
		const report = formatQuarantineReport({ ...entry, charset: injection });
		const line = report.split("\n").find((l) => l.startsWith("- **Charset**:"));
		assert.ok(line, "Expected a charset line");
		// Neutralised, not deleted: the payload survives as literal text inside
		// a code span, which needs the value to carry no raw newline and no
		// backtick beyond the two delimiters.
		assert.equal((line.match(/`/g) ?? []).length, 2);
		assert.doesNotMatch(report, /^\s*\*\*Click here:\*\*/m);
	});

	it("keeps the malformed value visible, since it is usually the bug", () => {
		const report = formatQuarantineReport({ ...entry, charset: injection });
		assert.match(report, /malformed/);
		assert.match(report, /evil\.example/);
	});

	it("renders a conforming value as itself", () => {
		const report = formatQuarantineReport({ ...entry, charset: "utf-8" });
		assert.match(report, /\*\*Charset\*\*: `utf-8`/);
		assert.doesNotMatch(report, /malformed/);
	});

	it("keeps a hostile node type from closing the MIME fence", () => {
		const report = formatQuarantineReport({
			...entry,
			structure: [
				{ depth: 0, contentType: "multipart/mixed" },
				{ depth: 1, contentType: "```\n## Injected heading" },
			],
		});
		assert.equal((report.match(/^```/gm) ?? []).length, 2);
		assert.doesNotMatch(report, /^## Injected heading/m);
	});
});

describe("a message that failed before its shape was read", () => {
	const shapeless: QuarantineEntry = {
		...entry,
		contentType: undefined,
		transferEncoding: undefined,
		sizeBytes: undefined,
		structure: [],
	};

	it("says the shape was never read rather than guessing one", () => {
		const report = formatQuarantineReport(shapeless);
		assert.match(report, /Content-Type.*not read/);
		assert.match(report, /Content-Transfer-Encoding.*not read/);
		assert.match(report, /Size.*not read/);
	});

	it("keeps the fence balanced with an empty tree", () => {
		const report = formatQuarantineReport(shapeless);
		assert.equal((report.match(/^```/gm) ?? []).length, 2);
	});
});

describe("quarantineReportSections", () => {
	it("hands the MIME tree over unfenced, so it can be truncated safely", () => {
		const { head, structure, disclaimer } = quarantineReportSections(entry);
		assert.doesNotMatch(structure, /```/);
		assert.doesNotMatch(head, /```/);
		assert.equal(disclaimer, QUARANTINE_REPORT_DISCLAIMER);
	});

	it("assembles back into the fenced report the dialog shows", () => {
		const report = formatQuarantineReport(entry);
		assert.equal((report.match(/^```/gm) ?? []).length, 2);
		assert.ok(report.endsWith(QUARANTINE_REPORT_DISCLAIMER));
	});
});

describe("quarantineIssueTitle", () => {
	it("carries only the closed vocabulary", () => {
		const title = quarantineIssueTitle(entry);
		assert.match(title, /UnreadableBody/);
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
