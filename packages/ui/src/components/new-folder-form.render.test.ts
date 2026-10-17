import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { NewFolderForm, type NewFolderFormProps } from "./new-folder-form.js";

const render = (props: Partial<NewFolderFormProps>) =>
	renderToString(
		createElement(NewFolderForm, {
			parentLabel: "Travel",
			name: "",
			onNameChange: () => {},
			onSubmit: () => {},
			onCancel: () => {},
			...props,
		}),
	);

describe("NewFolderForm", () => {
	it("ties the label to the field it names", () => {
		const html = render({});
		const forId = html.match(/<label[^>]*for="([^"]+)"/)?.[1];
		assert.ok(forId);
		assert.match(html, new RegExp(`<input[^>]*id="${forId}"`));
	});

	it("holds the wait and refuses a second submit while it runs", () => {
		const html = render({ pending: true });
		assert.match(html, /Creating folder…/);
		assert.match(html, /<button[^>]*disabled/);
		assert.doesNotMatch(html, />Create folder</);
	});

	it("states a failure where it happened", () => {
		const html = render({ error: "The mail server refused that name." });
		assert.match(html, /role="alert"[^>]*>The mail server refused that name\./);
	});
});
