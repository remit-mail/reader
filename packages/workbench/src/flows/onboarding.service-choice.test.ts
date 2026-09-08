/**
 * Where the service choice sits in onboarding, and what Continue does with it
 * (#1178). The pick reaches Microsoft in the authorization request, so the step
 * has to make it before it hands the window over — and it must never hand over
 * an empty set, which the account endpoints refuse.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	StepMicrosoftEmail,
	type StepMicrosoftEmailProps,
} from "./onboarding.js";

let container: HTMLElement;
let root: Root;

const mount = (props: StepMicrosoftEmailProps = {}) => {
	act(() => {
		root.render(createElement(StepMicrosoftEmail, props));
	});
};

const boxes = () =>
	Array.from(
		container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
	);

const button = (label: string) =>
	Array.from(container.querySelectorAll("button")).find(
		(candidate) => candidate.textContent?.trim() === label,
	);

const click = (element: Element | undefined) => {
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

describe("onboarding service choice", () => {
	it("arrives with both services on", () => {
		mount();
		assert.deepEqual(
			boxes().map((box) => box.checked),
			[true, true],
		);
	});

	it("sits between the connector tile and the email field", () => {
		mount();
		const order = Array.from(
			container.querySelectorAll(
				'button, legend, input[type="checkbox"], #ms-email',
			),
		);
		const tile = order.findIndex((node) =>
			node.textContent?.includes("Outlook / Microsoft 365"),
		);
		const legend = order.findIndex((node) => node.tagName === "LEGEND");
		const email = order.findIndex((node) => node.id === "ms-email");
		assert.ok(tile >= 0 && legend > tile && email > legend);
	});

	it("refuses to hand over an empty set, and says why", () => {
		let advanced = 0;
		mount({ initialServices: [], onNext: () => advanced++ });

		click(button("Sign in with Microsoft"));

		assert.equal(advanced, 0);
		assert.match(
			container.querySelector('[role="alert"]')?.textContent ?? "",
			/Pick at least one/,
		);
	});

	it("hands over once a service is picked", () => {
		let advanced = 0;
		mount({ initialServices: [], onNext: () => advanced++ });

		click(button("Sign in with Microsoft"));
		click(boxes()[1]);
		click(button("Sign in with Microsoft"));

		assert.equal(advanced, 1);
		assert.equal(container.querySelector('[role="alert"]'), null);
	});

	it("keeps Continue live rather than disabling it on an empty set", () => {
		mount({ initialServices: [] });
		assert.equal(button("Sign in with Microsoft")?.disabled, false);
	});

	it("shows no choice at all for a connector that only carries mail", () => {
		mount({ offered: ["Mail"] });
		assert.equal(boxes().length, 0);
		assert.equal(container.querySelector("legend"), null);
		assert.ok(container.querySelector("#ms-email"));
	});

	it("offers Cancel instead of Back inside the settings embedding", () => {
		mount({ host: "settings" });
		assert.ok(button("Cancel"));
		assert.equal(button("Back"), undefined);
	});
});
