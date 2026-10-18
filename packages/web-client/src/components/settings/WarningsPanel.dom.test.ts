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
import { meOperationsListQuarantineOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, httpError, mockFetch } from "../../test-support/http";
import { WarningsPanel } from "./WarningsPanel";

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
	warnings: [],
	warningsTotal: 0,
};

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

/**
 * The quarantine list is the read that gives the pane something to paint: until
 * it has landed, an assertion that no path is showing passes because there are
 * no rows at all, which is not what any of these cases claims to test.
 */
const quarantineLanded = (view: DomHarness): boolean =>
	view.queryClient.getQueryState(meOperationsListQuarantineOptions().queryKey)
		?.status === "success";

const mount = async (
	mailboxes: () => unknown,
	settled: (view: DomHarness) => boolean,
	description: string,
	list: () => unknown = () => QUARANTINE,
): Promise<DomHarness> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return CONFIG;
		if (call.path.endsWith("/mailboxes")) return mailboxes();
		if (call.path.endsWith("/quarantine")) return list();
		return {};
	});
	const view = createDomHarness();
	harness = view;
	view.renderApp(createElement(WarningsPanel));
	// Two waves: the mailbox-list fan-out is keyed on the accounts `/config`
	// returns, so it cannot even start until that first read has settled. How
	// many turns those waves take is the runner's business, so each case names
	// the state it needs instead of counting them.
	await view.waitFor(() => settled(view), description);
	return view;
};

describe("WarningsPanel reads", () => {
	it("lists a body that gave up and a header still retrying beside the set-aside message", async () => {
		const view = await mount(
			() => MAILBOXES,
			(pane) => /Gave up/.test(pane.text()),
			"the warning to be listed",
			() => ({
				...QUARANTINE,
				warnings: [
					{
						syncWarningId: "w-1",
						accountConfigId: "cfg-1",
						accountId: ACCOUNT_ID,
						mailboxId: MAILBOX_ID,
						uidValidity: 1_712_000_000,
						uid: 51002,
						stage: "Body",
						attempts: 3,
						createdAt: Date.parse("2026-10-17T08:12:00Z"),
					},
					{
						syncWarningId: "w-2",
						accountConfigId: "cfg-1",
						accountId: ACCOUNT_ID,
						mailboxId: MAILBOX_ID,
						uidValidity: 1_712_000_000,
						uid: 50874,
						stage: "Header",
						attempts: 5,
						createdAt: Date.parse("2026-10-16T21:40:00Z"),
					},
				],
				warningsTotal: 2,
			}),
		);

		assert.match(view.text(), /uid 51002/);
		assert.match(view.text(), /Retrying/);
		assert.match(view.text(), /uid 50874/);
		assert.match(view.text(), /Messages set aside/);
		assert.match(view.text(), /uid 40251/);
	});

	it("shows a 401 on the list as signed out, never as an empty list", async () => {
		const view = await mount(
			() => MAILBOXES,
			(pane) => /Your session has ended/.test(pane.text()),
			"the signed-out notice",
			() => httpError(401),
		);

		assert.match(view.html(), /role="alert"/);
		assert.doesNotMatch(view.text(), /Nothing has failed|Nothing is set aside/);
	});
});

describe("WarningsPanel folder names", () => {
	it("waits for the account's delimiter rather than cutting on a guess", async () => {
		// The mailbox read never resolves here, so settled means every read that
		// can land has: the entries are in hand and only the delimiter is missing.
		const view = await mount(
			() => new Promise(() => {}),
			(pane) =>
				quarantineLanded(pane) && (http?.to("/mailboxes").length ?? 0) > 0,
			"the quarantine list to land while the mailbox read hangs",
		);

		assert.match(view.text(), /Checking for warnings/);
		assert.doesNotMatch(
			view.text(),
			new RegExp(FULL_PATH.replace(/\./g, "\\.")),
		);
	});

	it("names the folder by its leaf once the delimiter has arrived", async () => {
		const view = await mount(
			() => MAILBOXES,
			(pane) => /Q3/.test(pane.text()),
			"the folder leaf to be named",
		);

		assert.match(view.text(), /Q3/);
		assert.doesNotMatch(
			view.text(),
			new RegExp(FULL_PATH.replace(/\./g, "\\.")),
		);
	});

	it("reports a failed mailbox read instead of naming folders on a guess", async () => {
		const view = await mount(
			() => httpError(500),
			(pane) => /role="alert"/.test(pane.html()),
			"the failed mailbox read to be reported",
		);

		assert.match(view.html(), /role="alert"/);
		assert.doesNotMatch(
			view.text(),
			new RegExp(FULL_PATH.replace(/\./g, "\\.")),
		);
	});
});
