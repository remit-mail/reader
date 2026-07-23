/**
 * The add/edit account form. The cases here are the ones where the form does
 * something the user did not type: it refuses a new account without a
 * password, it derives SMTP from IMAP rather than saving an account that
 * cannot send (#196), it keeps a stored password when the field was never
 * touched, and it fills the server fields from a provider preset.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { makeAccount } from "../../test-support/fixtures";
import {
	type HttpCall,
	type HttpMock,
	mockFetch,
} from "../../test-support/http";
import { AccountFormPanel } from "./AccountFormPanel";

const account = makeAccount({
	accountId: "acc-1",
	email: "alice@example.com",
	imapHost: "imap.example.com",
});

let harness: DomHarness | undefined;
let http: HttpMock;

beforeEach(() => {
	http = mockFetch((call) =>
		call.path === "/config"
			? { accounts: [account], mailboxes: [] }
			: { accountId: "acc-new" },
	);
});

afterEach(() => {
	harness?.close();
	harness = undefined;
	http.restore();
});

const mount = (
	props: Partial<Parameters<typeof AccountFormPanel>[0]> = {},
): DomHarness => {
	harness = createDomHarness();
	harness.renderApp(
		createElement(AccountFormPanel, {
			isOpen: true,
			onClose: () => undefined,
			...props,
		}),
	);
	return harness;
};

const field = (dom: DomHarness, id: string): HTMLInputElement => {
	const input = dom.query<HTMLInputElement>(`#${id}`);
	if (!input) throw new Error(`no field #${id}`);
	return input;
};

const submit = async (dom: DomHarness): Promise<void> => {
	const form = dom.query<HTMLFormElement>("#account-form");
	if (!form) throw new Error("no account form");
	dom.dispatch(form, new dom.window.Event("submit", { bubbles: true }));
	await dom.flush();
	await dom.flush();
};

const saved = (): HttpCall | undefined =>
	http.calls.find((call) => call.method === "POST" || call.method === "PATCH");

const body = (call: HttpCall | undefined): Record<string, unknown> => {
	assert.ok(call, "expected the form to reach the API");
	assert.ok(call.body, "expected a request body");
	return call.body;
};

describe("AccountFormPanel — adding an account", () => {
	it("refuses to save without a password and says so, rather than posting", async () => {
		const dom = mount();
		dom.type(field(dom, "account-email"), "alice@example.com");
		dom.type(field(dom, "imap-host"), "imap.example.com");

		await submit(dom);

		assert.match(dom.text(), /Password is required/);
		assert.equal(saved(), undefined);
	});

	it("reports a missing IMAP host in the same pass as the rest", async () => {
		const dom = mount();
		dom.type(field(dom, "account-email"), "alice@example.com");
		dom.type(field(dom, "account-password"), "hunter2");

		await submit(dom);

		assert.match(dom.text(), /IMAP host is required/);
		assert.equal(saved(), undefined);
	});

	it("derives SMTP from the IMAP host so the account can send (#196)", async () => {
		const dom = mount();
		dom.type(field(dom, "account-email"), "alice@example.com");
		dom.type(field(dom, "account-password"), "hunter2");
		dom.type(field(dom, "imap-host"), "imap.example.com");

		await submit(dom);

		const sent = body(saved());
		assert.equal(sent.smtpHost, "smtp.example.com");
		assert.equal(sent.smtpPort, 587);
		assert.equal(sent.smtpStartTls, true);
		assert.equal(sent.smtpTls, false);
	});

	it("never overrides an SMTP host the user typed", async () => {
		const dom = mount();
		dom.type(field(dom, "account-email"), "alice@example.com");
		dom.type(field(dom, "account-password"), "hunter2");
		dom.type(field(dom, "imap-host"), "imap.example.com");
		dom.type(field(dom, "smtp-host"), "relay.example.net");

		await submit(dom);

		assert.equal(body(saved()).smtpHost, "relay.example.net");
	});

	it("sends no SMTP credentials unless the user asked for separate ones", async () => {
		const dom = mount();
		dom.type(field(dom, "account-email"), "alice@example.com");
		dom.type(field(dom, "account-password"), "hunter2");
		dom.type(field(dom, "imap-host"), "imap.example.com");

		await submit(dom);

		const sent = body(saved());
		assert.equal(sent.smtpUsername, undefined);
		assert.equal(sent.smtpPassword, undefined);
	});

	it("closes itself once the account is created", async () => {
		let closed = 0;
		const dom = mount({
			onClose: () => {
				closed += 1;
			},
		});
		dom.type(field(dom, "account-email"), "alice@example.com");
		dom.type(field(dom, "account-password"), "hunter2");
		dom.type(field(dom, "imap-host"), "imap.example.com");

		await submit(dom);

		assert.equal(closed, 1);
	});
});

describe("AccountFormPanel — provider presets", () => {
	const pickFastmail = (dom: DomHarness): void => {
		const select = dom.query<HTMLSelectElement>("#account-provider");
		assert.ok(select);
		dom.select(select, "fastmail");
	};

	it("fills and locks the server fields the preset owns", () => {
		const dom = mount();
		pickFastmail(dom);

		assert.equal(field(dom, "imap-host").value, "imap.fastmail.com");
		assert.equal(field(dom, "imap-port").value, "993");
		assert.equal(field(dom, "imap-host").readOnly, true);
		assert.match(dom.text(), /locked/);
	});

	it("hands the server fields back on Advanced", () => {
		const dom = mount();
		pickFastmail(dom);

		dom.click(dom.byText("button", "Advanced"));

		assert.equal(field(dom, "imap-host").readOnly, false);
		assert.match(dom.text(), /Use preset settings/);
	});

	it("adopts the email as the username when the user left it blank", () => {
		const dom = mount();
		dom.type(field(dom, "account-email"), "alice@fastmail.com");
		pickFastmail(dom);

		assert.equal(field(dom, "account-username").value, "alice@fastmail.com");
	});

	it("points at the provider's app-password help", () => {
		const dom = mount();
		pickFastmail(dom);
		const link = dom.byText("a", "Get an app password");
		assert.match(link.getAttribute("href") ?? "", /fastmail/);
	});
});

describe("AccountFormPanel — editing an account", () => {
	it("shows a placeholder for the stored password and keeps it on save", async () => {
		const dom = mount({ account });
		assert.equal(field(dom, "account-password").value, "••••••••••");

		await submit(dom);

		const call = saved();
		assert.equal(call?.method, "PATCH");
		assert.equal(call?.path, "/accounts/acc-1");
		assert.equal(body(call).password, undefined);
	});

	it("sends the new password once the field is touched", async () => {
		const dom = mount({ account });
		dom.type(field(dom, "account-password"), "new-app-password");

		await submit(dom);

		assert.equal(body(saved()).password, "new-app-password");
	});

	it("tests the connection against the stored password rather than the placeholder", async () => {
		const dom = mount({ account });
		dom.click(dom.byText("button", "Test IMAP Connection"));
		await dom.flush();

		const [test] = http.to("/accounts/test-connection");
		const sent = body(test);
		assert.equal(sent.accountId, "acc-1");
		assert.equal(sent.password, undefined);
		assert.equal(sent.imapHost, "imap.example.com");
	});

	it("shows a read-only summary for a Microsoft OAuth account — no credential fields", () => {
		const dom = mount({
			account: makeAccount({ accountId: "acc-ms", authType: "oauthMicrosoft" }),
		});
		assert.match(dom.text(), /Microsoft OAuth \(XOAUTH2\)/);
		assert.equal(dom.query("#account-password"), null);
		assert.equal(dom.query("#imap-host"), null);
	});
});
