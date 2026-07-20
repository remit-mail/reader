import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QuarantineBugDialog } from "./quarantine-bug-dialog.js";
import { quarantineDemoEntries } from "./quarantine-fixtures.js";
import type { QuarantineEntry } from "./quarantine-report.js";
import { QuarantineSection } from "./quarantine-section.js";

const noop = () => {};
const [base, second, unappointedFolder] = quarantineDemoEntries;
const ISSUE_URL = "https://github.com/remit-mail/reader/issues/new?title=x";

const render = (entries: readonly QuarantineEntry[]) =>
	renderToString(createElement(QuarantineSection, { entries, onCutBug: noop }));

describe("QuarantineSection", () => {
	it("reassures when nothing is set aside", () => {
		const html = render([]);
		assert.match(html, /Nothing is set aside/);
		assert.doesNotMatch(html, /role="alert"/);
	});

	it("shows a single entry as a fact, without an alert", () => {
		const html = render([base]);
		assert.match(html, /uid 40217/);
		assert.doesNotMatch(html, /role="alert"/);
	});

	it("raises an alert once more than one message is set aside", () => {
		const html = render([base, second]);
		assert.match(html, /role="alert"/);
		assert.match(html, /2 messages could not be read/);
	});

	it("shows the parser's own words on screen, where the report will not", () => {
		const html = render([base]);
		assert.match(html, /multipart boundary was never closed/);
	});

	it("names no role for a folder the user never appointed one to", () => {
		const html = render([unappointedFolder]);
		assert.doesNotMatch(html, /Inbox|Spam|Archive/);
		assert.match(html, /Acme Holdings/);
	});

	it("offers reporting as the only per-row action", () => {
		const html = render([base]);
		assert.match(html, /Cut a bug/);
		assert.doesNotMatch(html, /Try again|Retry/);
	});
});

describe("QuarantineBugDialog", () => {
	it("shows the whole report before anything is filed", () => {
		const html = renderToString(
			createElement(QuarantineBugDialog, {
				entry: base,
				onClose: noop,
				onCopy: noop,
				issueUrl: ISSUE_URL,
			}),
		);
		assert.match(html, /UnreadableBody/);
		assert.match(html, /attachment names, or the parser&#x27;s own error text/);
		assert.match(html, /Copy report/);
	});

	it("never renders the parser's own error text into the report", () => {
		const html = renderToString(
			createElement(QuarantineBugDialog, {
				entry: base,
				onClose: noop,
				onCopy: noop,
				issueUrl: ISSUE_URL,
			}),
		);
		// The row shows it; the report must not. Locked at the render boundary,
		// which is where the regression would actually happen.
		assert.doesNotMatch(html, /multipart boundary was never closed/);
	});

	it("files through the supplied url with hardened external rel", () => {
		const html = renderToString(
			createElement(QuarantineBugDialog, {
				entry: base,
				onClose: noop,
				onCopy: noop,
				issueUrl: ISSUE_URL,
			}),
		);
		assert.match(html, /rel="noopener noreferrer"/);
		assert.match(html, /focus-visible:ring-2/);
	});

	it("renders nothing without an entry", () => {
		const html = renderToString(
			createElement(QuarantineBugDialog, {
				entry: null,
				onClose: noop,
				onCopy: noop,
				issueUrl: ISSUE_URL,
			}),
		);
		assert.equal(html, "");
	});
});
