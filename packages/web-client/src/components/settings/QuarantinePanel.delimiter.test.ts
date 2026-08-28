/**
 * A quarantine row names the folder its message sits in, which means cutting a
 * provider path into a leaf — and that cut is only correct on the account's own
 * hierarchy separator. The separator comes from a second read (the account's
 * mailbox list), so the pane must never paint a row before that read lands:
 * `INBOX.Projects.Q3` cut on a slash is one segment, and the row would show the
 * whole path as if it were a folder name. See #900.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, httpError, mockFetch } from "../../test-support/http";
import { QuarantinePanel } from "./QuarantinePanel";

const ACCOUNT_ID = "acct-1";
const MAILBOX_ID = "mbx-q3";
const FULL_PATH = "INBOX.Projects.Q3";

const CONFIG = {
	accounts: [{ accountId: ACCOUNT_ID, folderAppointments: [] }],
};

const MAILBOXES = {
	items: [
		{
			mailboxId: MAILBOX_ID,
			fullPath: FULL_PATH,
			hierarchyDelimiter: ".",
		},
	],
};

const QUARANTINE = {
	entries: [
		{
			quarantineId: "q-1",
			accountId: ACCOUNT_ID,
			mailboxId: MAILBOX_ID,
			uidValidity: 1_712_000_000,
			uid: 40251,
			mailboxPath: FULL_PATH,
			failureStage: "BodyParse",
			failureCode: "UnreadableBody",
			failureMessage: "stream ended before the declared body length",
			quarantinedAt: Date.parse("2026-07-19T06:03:00Z"),
			attempts: 1,
			sizeBytes: 2_140,
			structure: [],
		},
	],
};

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

const mount = async (mailboxes: () => unknown): Promise<DomHarness> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return CONFIG;
		if (call.path.endsWith("/mailboxes")) return mailboxes();
		if (call.path.endsWith("/quarantine")) return QUARANTINE;
		return {};
	});
	harness = createDomHarness();
	harness.renderApp(createElement(QuarantinePanel));
	// Two waves: the mailbox-list fan-out is keyed on the accounts `/config`
	// returns, so it cannot even start until that first read has settled.
	await harness.flush();
	await harness.wait(0);
	await harness.flush();
	return harness;
};

describe("QuarantinePanel folder names", () => {
	it("waits for the account's delimiter rather than cutting on a guess", async () => {
		const view = await mount(() => new Promise(() => {}));

		assert.match(view.text(), /Checking for messages set aside/);
		assert.doesNotMatch(
			view.text(),
			new RegExp(FULL_PATH.replace(/\./g, "\\.")),
		);
	});

	it("names the folder by its leaf once the delimiter has arrived", async () => {
		const view = await mount(() => MAILBOXES);

		assert.match(view.text(), /Q3/);
		assert.doesNotMatch(
			view.text(),
			new RegExp(FULL_PATH.replace(/\./g, "\\.")),
		);
	});

	it("reports a failed mailbox read instead of naming folders on a guess", async () => {
		const view = await mount(() => httpError(500));

		assert.match(view.html(), /role="alert"/);
		assert.doesNotMatch(
			view.text(),
			new RegExp(FULL_PATH.replace(/\./g, "\\.")),
		);
	});
});
