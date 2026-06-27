import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { type FolderDescriptor, FolderNameList } from "./folder-name-list.js";

const noop = () => {};

const folders: FolderDescriptor[] = [
	{
		id: "1",
		providerPath: "INBOX",
		detectedRole: "inbox",
		role: "inbox",
		name: "",
	},
	{
		id: "2",
		providerPath: "INBOX/Spam",
		detectedRole: "junk",
		role: "junk",
		name: "",
	},
];

function render(input: FolderDescriptor[] = folders): string {
	return renderToString(
		createElement(FolderNameList, {
			accountEmail: "you@example.com",
			folders: input,
			onCommit: noop,
			onReset: noop,
		}),
	);
}

describe("FolderNameList", () => {
	it("titles the section with the account email", () => {
		const html = render();
		assert.match(html, /System folders —/);
		assert.match(html, /you@example.com/);
	});

	it("renders a row per system folder", () => {
		const html = render();
		assert.match(html, /placeholder="Inbox"/);
		assert.match(html, /placeholder="Spam"/);
		assert.match(html, /INBOX\/Spam/);
	});

	it("does not render folders whose committed role is custom", () => {
		const html = render([
			...folders,
			{
				id: "3",
				providerPath: "INBOX/Nieuwsbrieven",
				detectedRole: "custom",
				role: "custom",
				name: "",
			},
		]);
		assert.doesNotMatch(html, /Nieuwsbrieven/);
	});

	it("renders a folder promoted from custom to a system role", () => {
		const html = render([
			{
				id: "1",
				providerPath: "INBOX/Verzonden",
				detectedRole: "custom",
				role: "sent",
				name: "",
			},
		]);
		assert.match(html, /INBOX\/Verzonden/);
	});
});
