import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	FolderManageActions,
	type FolderManageActionsProps,
} from "./folder-manage-actions.js";

const render = (props: Partial<FolderManageActionsProps>) =>
	renderToString(
		createElement(FolderManageActions, {
			label: "Travel",
			onRename: () => undefined,
			onDelete: () => undefined,
			...props,
		}),
	);

describe("FolderManageActions", () => {
	it("names both controls after the folder they act on", () => {
		const html = render({});
		assert.match(html, /aria-label="Rename Travel"/);
		assert.match(html, /aria-label="Delete Travel"/);
	});

	it("leaves a deletable folder's delete pressable", () => {
		assert.doesNotMatch(render({}), /disabled=""/);
	});

	it("states why a folder stays, in the control's own name", () => {
		const html = render({
			deleteBlockedReason: "The inbox can't be deleted.",
		});
		assert.match(
			html,
			/aria-label="Delete Travel — The inbox can&#x27;t be deleted."/,
		);
		assert.match(html, /disabled=""/);
		assert.match(html, /title="The inbox can&#x27;t be deleted."/);
	});

	it("takes the surface's own wording for each control", () => {
		const html = render({
			renameLabel: (label) => `Hernoem ${label}`,
			deleteLabel: (label) => `Verwijder ${label}`,
		});
		assert.match(html, /aria-label="Hernoem Travel"/);
		assert.match(html, /aria-label="Verwijder Travel"/);
	});
});
