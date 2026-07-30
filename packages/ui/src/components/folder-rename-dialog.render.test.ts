import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	FolderRenameDialog,
	type FolderRenameDialogProps,
} from "./folder-rename-dialog.js";

const render = (props: Partial<FolderRenameDialogProps>) =>
	renderToString(
		createElement(FolderRenameDialog, {
			open: true,
			folderLabel: "Trash",
			defaultLabel: "Deleted Messages",
			name: "Trash",
			onNameChange: () => undefined,
			onSubmit: () => undefined,
			onClose: () => undefined,
			...props,
		}),
	);

describe("FolderRenameDialog", () => {
	it("renders nothing when closed", () => {
		assert.equal(render({ open: false }), "");
	});

	it("names the folder it is renaming", () => {
		assert.match(render({}), /Rename Trash/);
	});

	it("states what clearing the name falls back to", () => {
		const html = render({});
		assert.match(html, /Leave it blank to use/);
		assert.match(html, />Deleted Messages</);
	});

	it("holds the wait while the name is saved", () => {
		const html = render({ pending: true });
		assert.match(html, /Saving…/);
		assert.match(html, /disabled/);
	});

	it("states a failure where it happened", () => {
		assert.match(
			render({ error: "Couldn't save that name." }),
			/role="alert"[^>]*>Couldn&#x27;t save that name./,
		);
	});
});
