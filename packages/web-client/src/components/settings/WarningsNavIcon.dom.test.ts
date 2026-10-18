import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { meOperationsListQuarantineOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, httpError, mockFetch } from "../../test-support/http";
import { WarningsNavIcon } from "./WarningsNavIcon";

const EMPTY = { entries: [], warnings: [], warningsTotal: 0 };

const WARNING = {
	syncWarningId: "w-1",
	accountConfigId: "cfg-1",
	accountId: "acct-1",
	mailboxId: "mbx-1",
	uidValidity: 1_712_000_000,
	uid: 51002,
	stage: "Body",
	attempts: 3,
	createdAt: Date.parse("2026-10-17T08:12:00Z"),
};

const SET_ASIDE = {
	quarantineId: "q-1",
	accountId: "acct-1",
	mailboxId: "mbx-1",
	uidValidity: 1_712_000_000,
	uid: 40251,
	mailboxPath: "INBOX",
	failureStage: "BodyParse",
	failureCode: "UnknownCharset",
	failureMessage: "declared charset is not a known encoding",
	quarantinedAt: Date.parse("2026-10-17T06:03:00Z"),
	attempts: 1,
	sizeBytes: 2_140,
	structure: [],
};

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

const mount = async (list: () => unknown): Promise<DomHarness> => {
	http = mockFetch((call) => (call.path.endsWith("/quarantine") ? list() : {}));
	const view = createDomHarness();
	harness = view;
	view.renderApp(createElement(WarningsNavIcon));
	await view.waitFor(() => {
		const state = view.queryClient.getQueryState(
			meOperationsListQuarantineOptions().queryKey,
		);
		return state !== undefined && state.status !== "pending";
	}, "the warnings list read to settle");
	return view;
};

const dotted = (view: DomHarness): boolean =>
	view.container.querySelector('[data-testid="attention-dot"]') !== null;

describe("the Warnings dot", () => {
	it("shows while a message is failing to sync", async () => {
		const view = await mount(() => ({
			...EMPTY,
			warnings: [WARNING],
			warningsTotal: 1,
		}));
		assert.ok(dotted(view));
		assert.match(view.text(), /Sync warnings/);
	});

	it("shows while a message is set aside", async () => {
		const view = await mount(() => ({ ...EMPTY, entries: [SET_ASIDE] }));
		assert.ok(dotted(view));
	});

	it("stays dark when nothing failed", async () => {
		const view = await mount(() => EMPTY);
		assert.equal(dotted(view), false);
	});

	it("shows when the list cannot be read, so a failure never reads as none", async () => {
		const view = await mount(() => httpError(403));
		assert.ok(dotted(view));
		assert.match(view.text(), /Warnings could not be read/);
	});

	it("shows a signed-out session as one, not as no warnings", async () => {
		const view = await mount(() => httpError(401));
		assert.ok(dotted(view));
		assert.match(view.text(), /Session ended/);
	});
});
