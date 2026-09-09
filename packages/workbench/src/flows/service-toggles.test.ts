/**
 * The account settings screen driving a service change end to end (#1179). What
 * is pinned here is the order: a switch asks, the confirmation states what stays
 * and what stops, and only an answered confirmation moves anything.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	AccountServiceSettings,
	type AccountServiceSettingsProps,
} from "./service-toggles.js";

let container: HTMLElement;
let root: Root;

const mount = (props: AccountServiceSettingsProps = {}) => {
	act(() => {
		root.render(createElement(AccountServiceSettings, props));
	});
};

const switches = () =>
	Array.from(container.querySelectorAll<HTMLElement>('[role="switch"]'));

const dialog = () => container.querySelector('[role="dialog"]');

const button = (label: string) =>
	Array.from(container.querySelectorAll("button")).find(
		(candidate) => candidate.textContent?.trim() === label,
	);

const click = (element: Element | undefined | null) => {
	assert.ok(element, "expected the element to be in the document");
	act(() => {
		(element as HTMLElement).click();
	});
};

beforeEach(() => {
	(globalThis as { React?: typeof React }).React = React;
	container = document.getElementById("root") as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
});

describe("account settings service toggles", () => {
	it("shows one switch per service, both on", () => {
		mount();
		assert.deepEqual(
			switches().map((element) => element.getAttribute("aria-checked")),
			["true", "true"],
		);
	});

	it("asks before it stops a sync, and moves nothing until it is answered", () => {
		mount();
		click(switches()[0]);

		assert.match(dialog()?.textContent ?? "", /Mail already in Remit stays/);
		assert.match(dialog()?.textContent ?? "", /Nothing is deleted/);
		assert.equal(switches()[0]?.getAttribute("aria-checked"), "true");
	});

	it("leaves the account syncing what it did when the question is dismissed", () => {
		mount();
		click(switches()[0]);
		click(button("Cancel"));

		assert.equal(dialog(), null);
		assert.equal(switches()[0]?.getAttribute("aria-checked"), "true");
	});

	it("stops the sync once the confirmation is answered", () => {
		mount();
		click(switches()[0]);
		click(button("Stop syncing mail"));

		assert.equal(dialog(), null);
		assert.equal(switches()[0]?.getAttribute("aria-checked"), "false");
		assert.match(container.textContent ?? "", /mail sync off/);
	});

	it("names the round trip before adding a service the grant never covered", () => {
		mount({ services: ["Mail"], consented: ["Mail"] });
		click(switches()[1]);

		assert.match(
			dialog()?.textContent ?? "",
			/Remit sends you to Microsoft to ask for it/,
		);
		assert.equal(switches()[1]?.getAttribute("aria-checked"), "false");
	});

	it("adds the service once the round trip comes back", () => {
		mount({ services: ["Mail"], consented: ["Mail"] });
		click(switches()[1]);
		click(button("Continue to Microsoft"));

		assert.equal(switches()[1]?.getAttribute("aria-checked"), "true");
		assert.match(container.textContent ?? "", /granted calendar access/);
	});

	it("adds a service the grant already covers without a round trip", () => {
		mount({ services: ["Mail"] });
		click(switches()[1]);

		assert.equal(dialog(), null);
		assert.equal(switches()[1]?.getAttribute("aria-checked"), "true");
	});

	it("sends the last service off to removing the account", () => {
		mount({ services: ["Mail"], consented: ["Mail"] });
		click(switches()[0]);

		assert.match(
			dialog()?.textContent ?? "",
			/An account has to sync something/,
		);
		assert.ok(button("Remove account"));
	});

	it("offers an IMAP account no switches at all", () => {
		mount({ connector: "imap", services: ["Mail"], consented: ["Mail"] });

		assert.equal(switches().length, 0);
		assert.match(container.textContent ?? "", /carries mail and nothing else/);
	});
});
