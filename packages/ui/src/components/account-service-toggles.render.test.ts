/**
 * The service switches on account settings (#1179). What is pinned here is the
 * contract the ADR binds: an IMAP account gets no switches at all, a service the
 * grant never covered names the sign-in round trip before it is pressed, and a
 * press asks the host rather than flipping anything itself.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import type { AccountService } from "./account-service-choice.js";
import {
	type AccountServiceIntent,
	AccountServiceToggles,
	type AccountServiceTogglesProps,
} from "./account-service-toggles.js";

const bothServices: AccountService[] = ["Mail", "Calendar"];

const props = (
	overrides: Partial<AccountServiceTogglesProps> = {},
): AccountServiceTogglesProps => ({
	providerName: "Microsoft",
	offered: bothServices,
	enabled: bothServices,
	consented: bothServices,
	onRequestChange: () => {},
	...overrides,
});

const render = (overrides: Partial<AccountServiceTogglesProps> = {}): string =>
	renderToString(createElement(AccountServiceToggles, props(overrides)));

interface Press {
	service: AccountService;
	intent: AccountServiceIntent;
}

function pressSwitch(
	index: number,
	overrides: Partial<AccountServiceTogglesProps> = {},
): Press[] {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const presses: Press[] = [];

	act(() => {
		root.render(
			createElement(
				AccountServiceToggles,
				props({
					...overrides,
					onRequestChange: (service, intent) =>
						presses.push({ service, intent }),
				}),
			),
		);
	});

	const switches =
		container.querySelectorAll<HTMLButtonElement>('[role="switch"]');
	act(() => {
		switches[index]?.click();
	});

	act(() => {
		root.unmount();
	});
	container.remove();
	return presses;
}

describe("AccountServiceToggles", () => {
	it("offers a switch per service, mail first", () => {
		const html = render();
		assert.equal(html.match(/role="switch"/g)?.length, 2);
		assert.ok(html.indexOf("Mail") < html.indexOf("Calendar"));
	});

	it("shows each switch in the state the account is in", () => {
		const html = render({ enabled: ["Calendar"] });
		assert.equal(html.match(/aria-checked="true"/g)?.length, 1);
		assert.equal(html.match(/aria-checked="false"/g)?.length, 1);
	});

	it("renders nothing for an IMAP account, which syncs mail alone", () => {
		assert.equal(render({ offered: ["Mail"], enabled: ["Mail"] }), "");
	});

	it("names the sign-in round trip on a service the grant never covered", () => {
		assert.match(
			render({ enabled: ["Mail"], consented: ["Mail"] }),
			/Turning this on means signing in with Microsoft again\./,
		);
	});

	it("says nothing about signing in for a service the grant covers", () => {
		assert.doesNotMatch(
			render({ enabled: ["Mail"] }),
			/signing in with Microsoft again/,
		);
	});

	it("says nothing about signing in for a service already on", () => {
		assert.doesNotMatch(
			render({ consented: ["Mail"] }),
			/signing in with Microsoft again/,
		);
	});

	it("asks the host to switch a running service off", () => {
		assert.deepEqual(pressSwitch(0), [{ service: "Mail", intent: "off" }]);
	});

	it("asks the host to switch a stopped service on", () => {
		assert.deepEqual(pressSwitch(1, { enabled: ["Mail"] }), [
			{ service: "Calendar", intent: "on" },
		]);
	});
});
