import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Button } from "./button.js";
import { DangerZoneSection } from "./danger-zone-section.js";
import { SegmentedControl } from "./segmented-control.js";
import { SenderGroupSwitch } from "./sender-group-switch.js";
import { SettingsShell } from "./settings-screen.js";

describe("SegmentedControl (#802)", () => {
	it("is a radiogroup with one checked radio and thumb-sized targets", () => {
		const html = renderToString(
			createElement(SegmentedControl, {
				name: "density",
				value: "compact",
				onChange: () => undefined,
				options: [
					{ value: "comfortable", label: "Comfortable" },
					{ value: "compact", label: "Compact" },
				],
			}),
		);
		assert.match(html, /role="radiogroup"/);
		assert.match(html, /min-h-11/);
		assert.equal((html.match(/type="radio"/g) ?? []).length, 2);
		assert.match(html, /checked[^>]*value="compact"/);
	});

	it("active thumb uses filled card shadow (#848)", () => {
		const html = renderToString(
			createElement(SegmentedControl, {
				name: "theme",
				value: "system",
				onChange: () => undefined,
				options: [
					{ value: "system", label: "System" },
					{ value: "light", label: "Light" },
					{ value: "dark", label: "Dark" },
				],
			}),
		);
		// shadow (not shadow-sm) on the active thumb
		assert.match(html, /bg-surface[^"]*\bshadow\b/);
	});

	it("renders dividers between inactive segments (#848)", () => {
		// active = system (index 0): light→dark boundary gets a divider
		const html = renderToString(
			createElement(SegmentedControl, {
				name: "theme",
				value: "system",
				onChange: () => undefined,
				options: [
					{ value: "system", label: "System" },
					{ value: "light", label: "Light" },
					{ value: "dark", label: "Dark" },
				],
			}),
		);
		assert.match(html, /after:bg-line/);
	});
});

describe("SenderGroupSwitch (#790)", () => {
	it("renders a tablist that is a strip on mobile and a rail (lg) on desktop", () => {
		const html = renderToString(
			createElement(SenderGroupSwitch, {
				active: "vip",
				onSelect: () => undefined,
				options: [
					{ id: "vip", label: "VIPs", count: 12 },
					{ id: "muted", label: "Muted", count: null },
					{ id: "blocked", label: "Blocked", count: null },
				],
			}),
		);
		assert.match(html, /role="tablist"/);
		assert.match(html, /lg:w-44/);
		assert.match(html, /lg:flex-col/);
		assert.match(html, /aria-selected="true"/);
		assert.match(html, /—/);
	});
});

describe("DangerZoneSection (#791)", () => {
	it("keeps the strong 'Delete your Remit account' label and renders its action", () => {
		const html = renderToString(
			createElement(DangerZoneSection, {
				title: "Delete your Remit account",
				description: "Disconnects every account.",
				action: createElement(
					Button,
					{ variant: "danger", size: "sm" },
					"Delete your Remit account",
				),
			}),
		);
		assert.equal(
			(html.match(/Delete your Remit account/g) ?? []).length >= 2,
			true,
		);
		assert.match(html, /Danger zone/);
	});
});

describe("SettingsShell responsive (#789)", () => {
	const shell = (flush?: boolean) =>
		renderToString(
			createElement(SettingsShell, {
				items: [
					{ id: "accounts", label: "Accounts" },
					{ id: "senders", label: "Senders & Rules" },
				],
				activeId: "accounts",
				title: "Accounts",
				help: createElement("p", null, "tips"),
				flush,
				children: createElement("div", null, "pane body"),
			}),
		);

	const shellNoHelp = () =>
		renderToString(
			createElement(SettingsShell, {
				items: [
					{ id: "accounts", label: "Accounts" },
					{ id: "senders", label: "Senders & Rules" },
				],
				activeId: "accounts",
				title: "Accounts",
				children: createElement("div", null, "pane body"),
			}),
		);

	it("hides the nav rail below desktop and shows a menu button to reach it", () => {
		const html = shell();
		assert.match(html, /hidden w-60[^"]*lg:flex/);
		assert.match(html, /aria-label="Open settings menu"/);
	});

	it("folds the tips rail to desktop-only with a mobile tips disclosure", () => {
		const html = shell();
		assert.match(html, /hidden w-64[^"]*lg:flex/);
		assert.match(html, /aria-label="Tips"/);
	});

	it("renders the active pane content so it is reachable on every width", () => {
		assert.match(shell(), /pane body/);
		assert.match(shell(true), /pane body/);
	});

	it("omits the tips toggle when no help prop is passed (#872)", () => {
		const html = shellNoHelp();
		assert.doesNotMatch(html, /aria-label="Tips"/);
		assert.doesNotMatch(html, /aria-label="Show tips"/);
	});
});
