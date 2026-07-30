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
	it("asks for a name and states where the folder goes", () => {
		const html = render({ name: "Car hire" });
		assert.match(html, /Folder name/);
		assert.match(html, /value="Car hire"/);
		assert.match(html, /placeholder="Hotels"/);
		assert.match(html, /Inside/);
		assert.match(html, />Travel</);
	});

	it("ties the label to the field it names", () => {
		const html = render({});
		const forId = html.match(/<label[^>]*for="([^"]+)"/)?.[1];
		assert.ok(forId);
		assert.match(html, new RegExp(`<input[^>]*id="${forId}"`));
	});

	it("states the parent as text rather than a second choice", () => {
		assert.doesNotMatch(render({}), /<select/);
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

	it("says nothing about a failure that has not happened", () => {
		assert.doesNotMatch(render({}), /role="alert"/);
	});

	it("applies caller-supplied labels", () => {
		const html = render({
			labels: { create: "Map maken", cancel: "Annuleren", insideLabel: "In" },
		});
		assert.match(html, />Map maken</);
		assert.match(html, />Annuleren</);
		assert.doesNotMatch(html, /Inside/);
	});
});
