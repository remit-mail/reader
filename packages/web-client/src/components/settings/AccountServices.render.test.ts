import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { makeAccount } from "../../test-support/fixtures";
import { type HttpMock, httpError, mockFetch } from "../../test-support/http";
import { AccountServices } from "./AccountServices";

const REFUSAL =
	"This account's Microsoft consent does not cover Calendar. Grant it through POST /accounts/oauth/microsoft/start.";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

const outlook = (
	overrides: Partial<RemitImapAccountResponse> = {},
): RemitImapAccountResponse =>
	makeAccount({
		accountId: "acc-1",
		authType: "oauthMicrosoft",
		syncedServices: ["Mail"],
		...overrides,
	});

const mount = (
	account: RemitImapAccountResponse,
	onRemoveAccount: () => void = () => {},
): DomHarness => {
	const mounted = createDomHarness();
	mounted.renderApp(
		createElement(AccountServices, { account, onRemoveAccount }),
	);
	harness = mounted;
	return mounted;
};

const switchFor = (mounted: DomHarness, name: string): HTMLElement =>
	mounted.byLabel(`Sync ${name}`);

const button = (mounted: DomHarness, text: string): HTMLElement =>
	mounted.byText("button", text);

describe("AccountServices", () => {
	it("renders no switches for an IMAP account", () => {
		http = mockFetch();
		const mounted = mount(outlook({ authType: "password" }));
		assert.equal(mounted.queryAll('[role="switch"]').length, 0);
	});

	it("shows each switch in the state the server holds", () => {
		http = mockFetch();
		const mounted = mount(outlook());
		assert.equal(
			switchFor(mounted, "mail").getAttribute("aria-checked"),
			"true",
		);
		assert.equal(
			switchFor(mounted, "calendar").getAttribute("aria-checked"),
			"false",
		);
	});

	it("writes the selection with calendar added and holds the switch on while it saves", async () => {
		http = mockFetch(() => new Promise(() => {}));
		const mounted = mount(outlook());

		mounted.click(switchFor(mounted, "calendar"));
		await mounted.waitFor(() => (http?.to("/accounts/acc-1").length ?? 0) > 0);

		const [call] = http.to("/accounts/acc-1");
		assert.equal(call?.method, "PATCH");
		assert.deepEqual(call?.body, { syncedServices: ["Mail", "Calendar"] });
		assert.equal(
			switchFor(mounted, "calendar").getAttribute("aria-checked"),
			"true",
		);
	});

	it("states a refusal in the server's words, offers a report, and turns the switch back", async () => {
		http = mockFetch(() => httpError(400, REFUSAL));
		const mounted = mount(outlook());

		mounted.click(switchFor(mounted, "calendar"));
		await mounted.waitFor(
			() => mounted.text().includes(REFUSAL),
			"the refusal to show",
		);

		assert.match(mounted.text(), /Couldn't turn calendar on/);
		const report = mounted.byText("a", "Report an issue");
		assert.match(
			report.getAttribute("href") ?? "",
			/github\.com\/.+\/issues\/new/,
		);
		assert.equal(
			switchFor(mounted, "calendar").getAttribute("aria-checked"),
			"false",
		);
	});

	it("asks before mail goes off, says stored mail stays, then writes calendar alone", async () => {
		http = mockFetch(() => new Promise(() => {}));
		const mounted = mount(outlook({ syncedServices: ["Mail", "Calendar"] }));

		mounted.click(switchFor(mounted, "mail"));
		assert.match(mounted.text(), /Mail already in Remit stays/);
		assert.equal(http.to("/accounts/acc-1").length, 0);

		mounted.click(button(mounted, "Stop syncing mail"));
		await mounted.waitFor(() => (http?.to("/accounts/acc-1").length ?? 0) > 0);

		assert.deepEqual(http.to("/accounts/acc-1")[0]?.body, {
			syncedServices: ["Calendar"],
		});
		assert.equal(
			switchFor(mounted, "mail").getAttribute("aria-checked"),
			"false",
		);
	});

	it("leaves mail on when the question is cancelled", () => {
		http = mockFetch();
		const mounted = mount(outlook({ syncedServices: ["Mail", "Calendar"] }));

		mounted.click(switchFor(mounted, "mail"));
		mounted.click(button(mounted, "Cancel"));

		assert.equal(http.to("/accounts/acc-1").length, 0);
		assert.equal(
			switchFor(mounted, "mail").getAttribute("aria-checked"),
			"true",
		);
	});

	it("routes switching off the last service to removing the account", () => {
		http = mockFetch();
		let removals = 0;
		const mounted = mount(outlook(), () => {
			removals += 1;
		});

		mounted.click(switchFor(mounted, "mail"));
		mounted.click(button(mounted, "Remove account"));

		assert.equal(removals, 1);
		assert.equal(http.to("/accounts/acc-1").length, 0);
	});
});
