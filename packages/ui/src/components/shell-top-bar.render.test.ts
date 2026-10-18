import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	ShellTopBar,
	type ShellTopBarProps,
	type ShellTopBarSearch,
} from "./shell-top-bar.js";

const search = (
	overrides: Partial<ShellTopBarSearch> = {},
): ShellTopBarSearch => ({
	value: "",
	scope: "global",
	onChange: () => undefined,
	onClear: () => undefined,
	onClearQuery: () => undefined,
	...overrides,
});

const render = (overrides: Partial<ShellTopBarProps> = {}): string =>
	renderToString(
		createElement(ShellTopBar, {
			search: search(),
			onCompose: () => undefined,
			onReportBug: () => undefined,
			onOpenSettings: () => undefined,
			refreshControl: createElement(
				"div",
				{ "data-testid": "refresh" },
				"refresh",
			),
			account: createElement("div", { "data-testid": "account" }, "account"),
			...overrides,
		}),
	);

describe("ShellTopBar", () => {
	it("words the compose tooltip around the host's bare key", () => {
		assert.match(render({ composeShortcut: "c" }), /title="Compose \(c\)"/);
	});

	it("names the action alone when the host binds no key to it", () => {
		assert.match(render(), /title="Compose"/);
	});

	it("only claims to search all mail when nothing narrows it", () => {
		assert.match(render(), /placeholder="Search all mail"/);
	});

	it("says which folder a scoped view searches", () => {
		assert.match(
			render({ search: search({ scope: "scoped" }) }),
			/placeholder="Search this folder"/,
		);
	});

	it("carries the route's scope as a chip and drops the claim to search all mail", () => {
		const html = render({
			search: search({
				scope: "scoped",
				chips: [{ id: "in:spam", label: "in:spam", tone: "scope" }],
			}),
		});
		assert.match(html, /in:spam/);
		assert.doesNotMatch(html, /Search all mail/);
	});

	it("falls back to neutral wording while a mailbox name is still loading", () => {
		const html = render({ search: search({ scope: "pending" }) });
		assert.match(html, /placeholder="Search mail"/);
		assert.doesNotMatch(html, /Search all mail/);
	});
});
