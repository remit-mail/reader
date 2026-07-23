/**
 * Walking the onboarding wizard end to end. The flow is the product here: a
 * first-run user gets from "welcome" to a syncing account without ever seeing
 * a server setting they have to know, and when the connection test fails the
 * wizard sends them back to the step that can fix it — credentials for a
 * rejected password, servers for an unreachable host.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, mockFetch } from "../../test-support/http";
import { OnboardingWizard } from "./OnboardingWizard";

let harness: DomHarness | undefined;
let http: HttpMock;

interface TestConnectionResult {
	imapSuccess: boolean;
	smtpSuccess: boolean;
	imapError?: string;
	smtpError?: string;
}

const OK: TestConnectionResult = { imapSuccess: true, smtpSuccess: true };

interface Backend {
	test?: TestConnectionResult;
	syncPhase?: string;
	lastError?: string;
	mailboxCountTotal?: number;
	mailboxCountSynced?: number;
}

const completed: string[] = [];
const cancelled: string[] = [];

const start = (backend: Backend = {}, skipWelcome = false): DomHarness => {
	http = mockFetch((call) => {
		if (call.path === "/accounts/test-connection") return backend.test ?? OK;
		if (call.path === "/accounts") return { accountId: "acc-new" };
		if (call.path === "/config") {
			return {
				accounts: [{ accountId: "acc-new", lastError: backend.lastError }],
				mailboxes: [],
			};
		}
		if (call.path.endsWith("/sync/status")) {
			return {
				accountId: "acc-new",
				syncPhase: backend.syncPhase ?? "complete",
				mailboxCountTotal: backend.mailboxCountTotal ?? 4,
				mailboxCountSynced: backend.mailboxCountSynced ?? 4,
				mailboxes: [
					{
						mailboxId: "mbx-inbox",
						fullPath: "INBOX",
						messagesTotal: 120,
						messagesSynced: 120,
					},
				],
			};
		}
		return {};
	});
	harness = createDomHarness();
	harness.renderApp(
		createElement(OnboardingWizard, {
			skipWelcome,
			onComplete: (accountId: string) => completed.push(accountId),
			onCancel: () => cancelled.push("cancelled"),
		}),
	);
	return harness;
};

beforeEach(() => {
	completed.length = 0;
	cancelled.length = 0;
});

afterEach(() => {
	harness?.close();
	harness = undefined;
	http.restore();
});

/** The wizard's server fields carry generated ids; the placeholder is stable. */
const imapHostField = (dom: DomHarness): HTMLInputElement => {
	const input = dom.query<HTMLInputElement>(
		'input[placeholder="imap.example.com"]',
	);
	assert.ok(input, "expected the IMAP host field");
	return input;
};

const clickText = (dom: DomHarness, text: string): void => {
	dom.click(dom.byText("button", text));
};

/** Welcome → Connector → Address, with an address the provider table knows. */
const walkToServers = async (
	dom: DomHarness,
	email = "alice@fastmail.com",
): Promise<void> => {
	clickText(dom, "Add your first account");
	clickText(dom, "Continue");
	const emailField = dom.query<HTMLInputElement>("#onboarding-email");
	assert.ok(emailField);
	dom.type(emailField, email);
	clickText(dom, "Continue");
	await dom.flush();
};

const walkToTest = async (dom: DomHarness): Promise<void> => {
	await walkToServers(dom);
	clickText(dom, "Continue");
	const password = dom.query<HTMLInputElement>("#credentials-password");
	assert.ok(password);
	dom.type(password, "app-password");
	clickText(dom, "Test connection");
	await dom.flush();
	// The test step stages IMAP then SMTP on a short delay before it settles.
	await dom.wait(500);
};

/** A verified connection carries on to the sync step on its own, after a beat. */
const walkToSync = async (dom: DomHarness): Promise<void> => {
	await walkToTest(dom);
	await dom.wait(900);
	// Creation resolves, then the sync-status poll behind it.
	for (let round = 0; round < 4; round += 1) {
		await dom.flush();
		await dom.wait(20);
	}
};

describe("OnboardingWizard — the first-run path", () => {
	it("opens on the welcome step with no server settings in sight", () => {
		const dom = start();
		assert.match(dom.text(), /Welcome to Remit/);
		assert.equal(dom.query("#onboarding-email"), null);
	});

	it("starts at the connector picker when it is opened from Settings", () => {
		const dom = start({}, true);
		assert.match(dom.text(), /How does this account connect/);
	});

	it("fills the server settings from the address alone", async () => {
		const dom = start();
		await walkToServers(dom);

		assert.match(dom.text(), /Confirm server settings/);
		assert.equal(imapHostField(dom).value, "imap.fastmail.com");
	});

	it("falls back to a guess for a domain nobody has heard of", async () => {
		const dom = start();
		await walkToServers(dom, "alice@unheard-of.example");

		assert.equal(imapHostField(dom).value, "imap.unheard-of.example");
	});

	it("refuses an address that is not one, without leaving the step", async () => {
		const dom = start();
		clickText(dom, "Add your first account");
		clickText(dom, "Continue");
		const emailField = dom.query<HTMLInputElement>("#onboarding-email");
		assert.ok(emailField);
		dom.type(emailField, "not-an-address");
		clickText(dom, "Continue");
		await dom.flush();

		assert.match(dom.text(), /Enter a valid email address/);
		assert.ok(dom.query("#onboarding-email"));
	});

	it("tests the connection with what the user entered", async () => {
		const dom = start();
		await walkToTest(dom);

		const [tested] = http.to("/accounts/test-connection");
		assert.ok(tested);
		assert.equal(tested.body?.imapHost, "imap.fastmail.com");
		assert.equal(tested.body?.password, "app-password");
		assert.equal(tested.body?.username, "alice@fastmail.com");
		assert.match(dom.text(), /Connection verified/);
	});

	it("creates the account from what the wizard collected", async () => {
		const dom = start();
		await walkToSync(dom);

		const [created] = http.calls.filter(
			(call) => call.path === "/accounts" && call.method === "POST",
		);
		assert.ok(created, "a verified connection carries on to creation");
		assert.equal(created.body?.email, "alice@fastmail.com");
		assert.equal(created.body?.imapHost, "imap.fastmail.com");
		assert.equal(created.body?.password, "app-password");
	});

	it("reports sync progress and hands the new account to the caller", async () => {
		const dom = start();
		await walkToSync(dom);

		assert.match(dom.text(), /INBOX/);
		assert.match(dom.text(), /4 mailboxes found/);
		clickText(dom, "Go to inbox");
		assert.deepEqual(completed, ["acc-new"]);
	});
});

describe("OnboardingWizard — a connection that does not work", () => {
	it("sends a rejected password back to credentials, not to servers", async () => {
		const dom = start({
			test: {
				imapSuccess: false,
				smtpSuccess: false,
				imapError: "Authentication failed",
			},
		});
		await walkToTest(dom);

		assert.match(dom.text(), /Authentication failed/);
		assert.match(dom.text(), /app password/i);
		clickText(dom, "Back to credentials");
		assert.ok(dom.query("#credentials-password"));
	});

	it("sends an unreachable host back to servers", async () => {
		const dom = start({
			test: {
				imapSuccess: false,
				smtpSuccess: false,
				imapError: "ECONNREFUSED",
			},
		});
		await walkToTest(dom);

		assert.match(dom.text(), /ECONNREFUSED/);
		clickText(dom, "Back to servers");
		assert.equal(imapHostField(dom).value, "imap.fastmail.com");
	});

	it("offers a retry that runs the test again rather than a dead end", async () => {
		const dom = start({
			test: {
				imapSuccess: false,
				smtpSuccess: false,
				imapError: "ECONNREFUSED",
			},
		});
		await walkToTest(dom);

		const before = http.to("/accounts/test-connection").length;
		clickText(dom, "Retry");
		await dom.flush();
		assert.equal(http.to("/accounts/test-connection").length, before + 1);
	});

	it("never reaches account creation while the connection is broken", async () => {
		const dom = start({
			test: { imapSuccess: false, smtpSuccess: false, imapError: "no route" },
		});
		await walkToTest(dom);
		await dom.wait(50);

		assert.deepEqual(
			http.calls.filter(
				(call) => call.path === "/accounts" && call.method === "POST",
			),
			[],
		);
	});
});

describe("OnboardingWizard — a sync that stalls", () => {
	it("says the account is still there and offers a retry", async () => {
		const dom = start({
			syncPhase: "error",
			lastError: "IMAP LOGIN failed",
		});
		await walkToSync(dom);

		assert.match(dom.text(), /Sync stalled/);
		assert.match(dom.text(), /still active/);
		assert.match(dom.text(), /IMAP LOGIN failed/);
	});
});
