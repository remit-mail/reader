import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { OrganizeSeed } from "@/lib/organize/mobile-organize-flow";
import { type FolderOption, SomethingElsePanel } from "./SomethingElsePanel";

// The node test loader transpiles remit-ui's `.tsx` with the classic JSX
// runtime, which references a global `React`. Vite uses the automatic runtime,
// so this shim only exists for the SSR test harness.
(globalThis as { React?: typeof React }).React = React;

const FOLDERS: FolderOption[] = [
	{ id: "mbx-inbox", label: "Inbox" },
	{ id: "mbx-archive", label: "Archive" },
	{ id: "mbx-junk", label: "Spam" },
];

const render = (
	folderOptions: FolderOption[] = FOLDERS,
	junkMailboxId?: string,
) =>
	renderToString(
		createElement(SomethingElsePanel, {
			folderOptions,
			junkMailboxId,
			onSeed: (_seed: OrganizeSeed) => undefined,
		}) as never,
	);

describe("SomethingElsePanel", () => {
	it("shows the plain-language prompt and input", () => {
		const html = render();
		assert.match(html, /What should Remit do\?/);
		assert.match(html, /Tell Remit what to do/);
	});

	it("derives shortcuts from the account's real folders", () => {
		const html = render();
		assert.match(html, /Always keep in Inbox/);
		assert.match(html, /File in Archive/);
	});

	it("offers the appointed Junk mailbox by its own label", () => {
		const html = render(FOLDERS, "mbx-junk");
		assert.match(html, /Move to Spam/);
	});

	it("offers no folder shortcuts when the account has none", () => {
		const html = render([]);
		assert.doesNotMatch(html, /Always keep in Inbox/);
		assert.doesNotMatch(html, /File in Archive/);
	});
});
