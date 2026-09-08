/**
 * The onboarding service choice (#1178). Both services on is the caller's
 * default, so what is asserted here is the choice's own contract: a provider
 * that syncs one service renders no choice at all, the empty set is refused
 * rather than submitted, and the re-consent line names the provider.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
	ACCOUNT_SERVICE_EMPTY_MESSAGE,
	type AccountService,
	AccountServiceChoice,
	type AccountServiceChoiceProps,
} from "./account-service-choice.js";

const bothServices: AccountService[] = ["Mail", "Calendar"];

const render = (props: Partial<AccountServiceChoiceProps> = {}): string =>
	renderToString(
		createElement(AccountServiceChoice, {
			providerName: "Microsoft",
			offered: bothServices,
			selected: bothServices,
			onChange: () => {},
			...props,
		}),
	);

describe("AccountServiceChoice", () => {
	it("offers mail and calendar, mail first", () => {
		const html = render();
		assert.match(html, /Mail/);
		assert.match(html, /Calendar/);
		assert.ok(html.indexOf("Mail") < html.indexOf("Calendar"));
	});

	it("ticks the services it is given and leaves the rest clear", () => {
		const html = render({ selected: ["Calendar"] });
		assert.equal(html.match(/checked=""/g)?.length, 1);
	});

	it("ticks both when both are selected", () => {
		assert.equal(render().match(/checked=""/g)?.length, 2);
	});

	it("names the provider adding a service sends you back to", () => {
		assert.match(
			render(),
			/Adding a service later means signing in with Microsoft again\./,
		);
	});

	it("renders nothing for a provider that only syncs mail", () => {
		assert.equal(render({ offered: ["Mail"], selected: ["Mail"] }), "");
	});

	it("still shows the refusal when there are no rows to show", () => {
		assert.match(
			render({
				offered: ["Mail"],
				selected: [],
				error: ACCOUNT_SERVICE_EMPTY_MESSAGE,
			}),
			/Pick at least one/,
		);
	});

	it("shows a refusal only when it is given one", () => {
		assert.doesNotMatch(render({ selected: [] }), /Pick at least one/);
		assert.match(
			render({ selected: [], error: ACCOUNT_SERVICE_EMPTY_MESSAGE }),
			/Pick at least one/,
		);
	});

	it("announces the refusal", () => {
		assert.match(
			render({ selected: [], error: ACCOUNT_SERVICE_EMPTY_MESSAGE }),
			/role="alert"/,
		);
	});

	it("adds and removes one service at a time", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const changes: AccountService[][] = [];

		act(() => {
			root.render(
				createElement(AccountServiceChoice, {
					providerName: "Microsoft",
					offered: bothServices,
					selected: bothServices,
					onChange: (next) => changes.push(next),
				}),
			);
		});

		const boxes = container.querySelectorAll<HTMLInputElement>(
			'input[type="checkbox"]',
		);
		act(() => {
			boxes[1]?.click();
		});
		act(() => {
			boxes[0]?.click();
		});

		assert.deepEqual(changes, [["Mail"], ["Calendar"]]);

		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("restores a service in the stored order", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const changes: AccountService[][] = [];

		act(() => {
			root.render(
				createElement(AccountServiceChoice, {
					providerName: "Microsoft",
					offered: bothServices,
					selected: ["Calendar"],
					onChange: (next) => changes.push(next),
				}),
			);
		});

		act(() => {
			container
				.querySelector<HTMLInputElement>('input[type="checkbox"]')
				?.click();
		});

		assert.deepEqual(changes, [["Mail", "Calendar"]]);

		act(() => {
			root.unmount();
		});
		container.remove();
	});
});
