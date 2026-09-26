import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { configOperationsGetConfigOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { MICROSOFT_SERVICE_SCOPES } from "@remit/mail-oauth-service";
import { useQuery } from "@tanstack/react-query";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { makeAccount } from "../../test-support/fixtures";
import {
	type HttpCall,
	type HttpMock,
	httpError,
	mockFetch,
} from "../../test-support/http";
import { AccountServices } from "./AccountServices";

const CONSENT_URL = "http://localhost/#microsoft-consent";
const MAIL_SCOPES = [...MICROSOFT_SERVICE_SCOPES.Mail];
const BOTH_SCOPES = [...MAIL_SCOPES, ...MICROSOFT_SERVICE_SCOPES.Calendar];
const REFUSAL = "The mail server refused the change. Try again later.";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	window.location.hash = "";
});

const outlook = (
	overrides: Partial<RemitImapAccountResponse> = {},
): RemitImapAccountResponse =>
	makeAccount({
		accountId: "acc-1",
		authType: "oauthMicrosoft",
		syncedServices: ["Mail"],
		grantedScopes: BOTH_SCOPES,
		...overrides,
	});

type Patch = (call: HttpCall) => unknown;

const hang: Patch = () => new Promise(() => {});

const Screen = ({ onRemoveAccount }: { onRemoveAccount: () => void }) => {
	const { data } = useQuery(configOperationsGetConfigOptions());
	const account = data?.accounts[0];
	if (!account) return null;
	return createElement(AccountServices, { account, onRemoveAccount });
};

const mount = async (
	initial: RemitImapAccountResponse,
	patch: Patch = hang,
	onRemoveAccount: () => void = () => {},
): Promise<DomHarness> => {
	let stored = initial;
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return { accounts: [stored] };
		if (call.path.endsWith("/oauth/microsoft/start")) {
			return { authorizationUrl: CONSENT_URL };
		}
		if (call.method === "PATCH") {
			const answer = patch(call);
			if (answer !== undefined) return answer;
			stored = { ...stored, ...call.body };
			return stored;
		}
		return {};
	});
	const mounted = createDomHarness();
	harness = mounted;
	mounted.renderApp(createElement(Screen, { onRemoveAccount }));
	await mounted.waitFor(
		() => (http?.to("/config").length ?? 0) > 0,
		"the account to load",
	);
	await mounted.wait(10);
	return mounted;
};

const switchFor = (mounted: DomHarness, name: string): HTMLButtonElement =>
	mounted.byLabel(`Sync ${name}`) as HTMLButtonElement;

const checked = (mounted: DomHarness, name: string): string | null =>
	switchFor(mounted, name).getAttribute("aria-checked");

const press = (mounted: DomHarness, text: string): void =>
	mounted.click(mounted.byText("button", text));

const patches = (): HttpCall[] =>
	(http?.calls ?? []).filter((call) => call.method === "PATCH");

describe("AccountServices", () => {
	it("renders no switches for an IMAP account", async () => {
		const mounted = await mount(
			outlook({ authType: "password", grantedScopes: [] }),
		);
		assert.equal(mounted.queryAll('[role="switch"]').length, 0);
	});

	it("shows each switch in the state the server holds", async () => {
		const mounted = await mount(outlook());
		assert.equal(checked(mounted, "mail"), "true");
		assert.equal(checked(mounted, "calendar"), "false");
	});

	it("saves calendar on and settles on the value the server returns", async () => {
		const mounted = await mount(outlook(), () => undefined);

		mounted.click(switchFor(mounted, "calendar"));
		await mounted.waitFor(
			() => (http?.to("/config").length ?? 0) >= 2,
			"the refetch after the save",
		);
		await mounted.flush();

		assert.deepEqual(patches()[0]?.body, {
			syncedServices: ["Mail", "Calendar"],
		});
		assert.equal(checked(mounted, "calendar"), "true");
		assert.equal(switchFor(mounted, "calendar").disabled, false);
	});

	it("holds both switches still while a save is in flight", async () => {
		const mounted = await mount(outlook());

		mounted.click(switchFor(mounted, "calendar"));
		await mounted.waitFor(
			() => patches().length > 0 && switchFor(mounted, "calendar").disabled,
			"the save to start",
		);

		assert.equal(checked(mounted, "calendar"), "true");
		assert.equal(switchFor(mounted, "mail").disabled, true);
		assert.equal(switchFor(mounted, "calendar").disabled, true);
		mounted.click(switchFor(mounted, "mail"));
		assert.equal(patches().length, 1);
		assert.doesNotMatch(mounted.text(), /Stop syncing mail/);
	});

	it("states a refused calendar-on in the server's words, offers a report, and turns the switch back", async () => {
		const mounted = await mount(outlook(), () => httpError(400, REFUSAL));

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
		assert.equal(checked(mounted, "calendar"), "false");
		assert.equal(switchFor(mounted, "calendar").disabled, false);
	});

	it("asks before mail goes off and keeps mail on when the server refuses", async () => {
		const mounted = await mount(
			outlook({ syncedServices: ["Mail", "Calendar"] }),
			() => httpError(400, REFUSAL),
		);

		mounted.click(switchFor(mounted, "mail"));
		assert.match(mounted.text(), /Mail already in Remit stays/);
		assert.equal(patches().length, 0);

		press(mounted, "Stop syncing mail");
		await mounted.waitFor(
			() => mounted.text().includes(REFUSAL),
			"the refusal to show",
		);

		assert.deepEqual(patches()[0]?.body, { syncedServices: ["Calendar"] });
		assert.match(mounted.text(), /Couldn't turn mail off/);
		assert.equal(checked(mounted, "mail"), "true");
	});

	it("clears the refusal on the next try", async () => {
		let answer: Patch = () => httpError(400, REFUSAL);
		const mounted = await mount(outlook(), (call) => answer(call));

		mounted.click(switchFor(mounted, "calendar"));
		await mounted.waitFor(
			() => mounted.text().includes(REFUSAL),
			"the refusal to show",
		);

		answer = hang;
		mounted.click(switchFor(mounted, "calendar"));
		await mounted.waitFor(() => patches().length === 2, "the second save");

		assert.doesNotMatch(mounted.text(), /Couldn't turn calendar on/);
	});

	it("sends an ungranted calendar through the Microsoft sign-in, saying so first", async () => {
		const mounted = await mount(outlook({ grantedScopes: MAIL_SCOPES }));

		assert.match(mounted.text(), /signing in with Microsoft again/);
		mounted.click(switchFor(mounted, "calendar"));
		assert.match(mounted.text(), /Sign in with Microsoft to add calendar\?/);

		press(mounted, "Continue to Microsoft");
		await mounted.waitFor(
			() => window.location.hash === "#microsoft-consent",
			"the redirect to Microsoft",
		);

		const [start] = http?.to("/oauth/microsoft/start") ?? [];
		assert.deepEqual(start?.body, {
			email: "alice@example.com",
			services: ["Mail", "Calendar"],
		});
		assert.equal(patches().length, 0);
		assert.equal(switchFor(mounted, "calendar").disabled, true);
	});

	it("reflects the granted scopes once the sign-in returns", async () => {
		const mounted = await mount(
			outlook({ syncedServices: ["Mail", "Calendar"] }),
		);
		assert.equal(checked(mounted, "calendar"), "true");
		assert.doesNotMatch(mounted.text(), /signing in with Microsoft again/);
	});

	it("leaves mail on when the question is cancelled", async () => {
		const mounted = await mount(
			outlook({ syncedServices: ["Mail", "Calendar"] }),
		);

		mounted.click(switchFor(mounted, "mail"));
		press(mounted, "Cancel");

		assert.equal(patches().length, 0);
		assert.equal(checked(mounted, "mail"), "true");
	});

	it("routes switching off the last service to removing the account", async () => {
		let removals = 0;
		const mounted = await mount(outlook(), hang, () => {
			removals += 1;
		});

		mounted.click(switchFor(mounted, "mail"));
		press(mounted, "Remove account");

		assert.equal(removals, 1);
		assert.equal(patches().length, 0);
	});
});
