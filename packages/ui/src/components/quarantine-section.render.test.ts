import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QuarantineBugDialog } from "./quarantine-bug-dialog.js";
import type { QuarantineEntry } from "./quarantine-report.js";
import { QuarantineSection } from "./quarantine-section.js";

const noop = () => {};

const base: QuarantineEntry = {
	quarantineId: "q-1",
	uid: 40217,
	mailboxRole: "inbox",
	mailboxPath: "INBOX",
	failureStage: "MimeStructure",
	failureCode: "UnterminatedMultipartBoundary",
	failureMessage: "multipart boundary was never closed",
	quarantinedAt: Date.parse("2026-07-18T09:12:00Z"),
	attempts: 3,
	sizeBytes: 184_233,
	contentType: "multipart/mixed",
	transferEncoding: "7bit",
	charset: "utf-8",
	structure: { contentType: "multipart/mixed" },
	headerNames: ["Date", "From"],
	messageIdHash: "sha256:6f1c4a",
	appVersion: "0.14.2",
};

const second: QuarantineEntry = {
	...base,
	quarantineId: "q-2",
	uid: 40219,
	failureStage: "CharsetDecode",
};

const render = (entries: readonly QuarantineEntry[], retryingIds?: string[]) =>
	renderToString(
		createElement(QuarantineSection, {
			entries,
			onCutBug: noop,
			onRetry: noop,
			retryingIds,
		}),
	);

describe("QuarantineSection", () => {
	it("reassures when nothing is set aside", () => {
		const html = render([]);
		assert.match(html, /Nothing is set aside/);
		assert.doesNotMatch(html, /role="alert"/);
	});

	it("shows a single entry as a fact, without an alert", () => {
		const html = render([base]);
		assert.match(html, /uid 40217/);
		assert.match(html, /could not take apart/);
		assert.doesNotMatch(html, /role="alert"/);
	});

	it("raises an alert once more than one message is set aside", () => {
		const html = render([base, second]);
		assert.match(html, /role="alert"/);
		assert.match(html, /2 messages could not be read/);
	});

	it("offers both recovery affordances on every entry", () => {
		const html = render([base]);
		assert.match(html, /Cut a bug/);
		assert.match(html, /Try again/);
	});

	it("marks only the entry that is retrying", () => {
		const html = render([base, second], ["q-1"]);
		assert.match(html, /Retrying…/);
		assert.equal(html.match(/Retrying…/g)?.length, 1);
	});
});

describe("QuarantineBugDialog", () => {
	it("shows the whole report before anything is filed", () => {
		const html = renderToString(
			createElement(QuarantineBugDialog, {
				entry: base,
				onClose: noop,
				onCopy: noop,
				repositoryUrl: "https://github.com/remit-mail/reader",
			}),
		);
		assert.match(html, /UnterminatedMultipartBoundary/);
		assert.match(html, /never its contents, addresses, subject/);
		assert.match(html, /issues\/new\?/);
		assert.match(html, /Copy report/);
	});

	it("renders nothing without an entry", () => {
		const html = renderToString(
			createElement(QuarantineBugDialog, {
				entry: null,
				onClose: noop,
				onCopy: noop,
				repositoryUrl: "https://github.com/remit-mail/reader",
			}),
		);
		assert.equal(html, "");
	});
});
