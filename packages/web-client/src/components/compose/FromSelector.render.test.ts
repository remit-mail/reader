/**
 * Issue #1014: when compose cannot resolve the sending account, the `<select>`
 * had no option carrying `value=""`, so the browser fell back to showing the
 * first account's address even though nothing was actually selected. The
 * unresolved state now gets its own disabled placeholder option, so no real
 * identity is shown while nothing is chosen.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { configOperationsGetConfigQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { makeAccount, makeConfig } from "../../test-support/fixtures";
import { FromSelector } from "./FromSelector";

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
});

const ACCOUNTS = [
	makeAccount({ accountId: "acc-1", email: "alice@example.com" }),
	makeAccount({ accountId: "acc-2", email: "bob@example.com" }),
];

const mount = (selectedAccountId: string | undefined): DomHarness => {
	harness = createDomHarness();
	harness.queryClient.setQueryData(
		configOperationsGetConfigQueryKey(),
		makeConfig(ACCOUNTS),
	);
	harness.renderApp(
		createElement(FromSelector, {
			selectedAccountId,
			onSelect: () => undefined,
		}),
	);
	return harness;
};

const select = (dom: DomHarness): HTMLSelectElement => {
	const found = dom.query<HTMLSelectElement>("#from-account-selector");
	if (!found) throw new Error("the from-account select is not mounted");
	return found;
};

describe("FromSelector with an unresolved account (#1014)", () => {
	it("shows a disabled placeholder instead of the first account's address", () => {
		const dom = mount(undefined);
		const node = select(dom);

		assert.equal(node.value, "", "the select should sit on the placeholder");

		const placeholder =
			node.querySelector<HTMLOptionElement>('option[value=""]');
		assert.ok(placeholder, "no placeholder option was rendered");
		assert.equal(
			placeholder.disabled,
			true,
			"the placeholder option should not be a pickable account",
		);
		assert.notEqual(
			placeholder.textContent,
			ACCOUNTS[0]?.email,
			"the placeholder must not read as the first account's address",
		);
	});

	it("selects the resolved account and shows its address", () => {
		const dom = mount("acc-2");
		const node = select(dom);

		assert.equal(node.value, "acc-2");
		assert.equal(
			node.selectedOptions[0]?.textContent,
			"bob@example.com",
			"the selected option should show the resolved account's address",
		);
	});

	it("shows the placeholder when selectedAccountId names an account no longer in config", () => {
		const dom = mount("acc-missing");
		const node = select(dom);

		assert.equal(node.value, "", "the select should sit on the placeholder");

		const placeholder =
			node.querySelector<HTMLOptionElement>('option[value=""]');
		assert.ok(placeholder, "no placeholder option was rendered");
		assert.notEqual(
			node.selectedOptions[0]?.textContent,
			ACCOUNTS[0]?.email,
			"an unresolved selection must not read as the first account's address",
		);
	});
});
