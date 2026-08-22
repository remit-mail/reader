import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { FolderTreeNode } from "../lib/folder-tree.js";
import {
	RoleAppointmentPrompt,
	type RoleAppointmentPromptProps,
	roleAppointmentPromptCopy,
} from "./role-appointment-prompt.js";

const folders: FolderTreeNode[] = [
	{ id: "mb-inbox", label: "INBOX", path: "INBOX", messageCount: 4821 },
	{
		id: "mb-deleted",
		label: "Deleted Messages",
		path: "Deleted Messages",
		messageCount: 512,
	},
	{
		id: "mb-prullenbak",
		label: "Prullenbak",
		path: "Prullenbak",
		messageCount: 0,
	},
];

const noop = () => {};

const render = (props: Partial<RoleAppointmentPromptProps>) =>
	renderToString(
		createElement(RoleAppointmentPrompt, {
			open: true,
			reason: "none",
			action: { kind: "delete", count: 12 },
			folders,
			delimiter: "/",
			phase: { kind: "choosing" },
			onSelect: noop,
			onConfirm: noop,
			onCancel: noop,
			...props,
		}),
	);

describe("roleAppointmentPromptCopy", () => {
	it("says nothing was deleted, and what reader files deletes in", () => {
		const copy = roleAppointmentPromptCopy("none", {
			kind: "delete",
			count: 12,
		});
		assert.equal(copy.title, "No folder is set as Trash");
		assert.equal(
			copy.description,
			"Nothing has been deleted. reader files deleted mail in the folder you set as Trash, and this account has none.",
		);
		assert.equal(
			copy.pickerPrompt,
			"Which folder does this account use for deleted mail?",
		);
		assert.equal(copy.confirmLabel, "Set as Trash and delete 12 messages");
	});

	it("counts one message as one message", () => {
		const copy = roleAppointmentPromptCopy("none", {
			kind: "delete",
			count: 1,
		});
		assert.equal(copy.confirmLabel, "Set as Trash and delete 1 message");
	});

	it("changes the verb, never the folder clause, for Empty Trash", () => {
		const copy = roleAppointmentPromptCopy("none", { kind: "emptyTrash" });
		assert.match(copy.description, /^Nothing has been emptied\./);
		assert.match(copy.description, /and this account has none\.$/);
		assert.equal(copy.confirmLabel, "Set as Trash and empty it");
	});

	it("names the folder that vanished", () => {
		const copy = roleAppointmentPromptCopy(
			"stale",
			{ kind: "delete", count: 3 },
			{ staleFolderLabel: "Prullenbak" },
		);
		assert.equal(copy.title, "The Trash folder you chose is gone");
		assert.equal(
			copy.description,
			"Nothing has been deleted. You set Prullenbak as this account's Trash and it is no longer on the mail server — another mail app may have renamed or removed it.",
		);
		assert.equal(copy.pickerPrompt, "Which folder should reader use instead?");
	});

	it("degrades the stale wording when no path was ever recorded", () => {
		const copy = roleAppointmentPromptCopy("stale", {
			kind: "delete",
			count: 3,
		});
		assert.equal(
			copy.description,
			"Nothing has been deleted. The folder you set as this account's Trash is no longer on the mail server — another mail app may have renamed or removed it.",
		);
	});

	it("names the guess and the irreversibility when confirming a guess", () => {
		const copy = roleAppointmentPromptCopy(
			"unconfirmed",
			{ kind: "emptyTrash" },
			{ trashFolderLabel: "Deleted Messages", selectedCount: 512 },
		);
		assert.equal(copy.title, "Confirm this account's Trash folder");
		assert.equal(
			copy.description,
			"Nothing has been emptied. reader files this account's deleted mail in Deleted Messages because of its name — you never chose it, and the mail server doesn't mark it as Trash. Emptying a folder erases everything in it from the mail server, and that cannot be restored.",
		);
		assert.equal(
			copy.pickerPrompt,
			"Confirm Deleted Messages, or pick the folder this account really uses.",
		);
		assert.equal(copy.confirmLabel, "Set as Trash and empty 512 messages");
	});

	it("falls back to an uncounted confirm when the count is unknown", () => {
		const copy = roleAppointmentPromptCopy(
			"unconfirmed",
			{ kind: "emptyTrash" },
			{ trashFolderLabel: "Deleted Messages" },
		);
		assert.equal(copy.confirmLabel, "Set as Trash and empty it");
	});
});

describe("RoleAppointmentPrompt", () => {
	it("renders nothing while closed", () => {
		assert.equal(render({ open: false }), "");
	});

	it("offers a way out that changes nothing, and no confirm until one is picked", () => {
		const html = render({});
		assert.match(html, />Cancel</);
		assert.doesNotMatch(html, /Set as Trash and delete/);
		assert.doesNotMatch(html, /disabled=/);
	});

	it("mounts the confirm once a folder is chosen", () => {
		const html = render({ selectedId: "mb-prullenbak" });
		assert.match(html, /Set as Trash and delete 12 messages/);
	});

	it("announces each folder's count as part of the row's own name", () => {
		const html = render({});
		assert.match(
			html,
			/aria-label="Set Deleted Messages, 512 messages, as Trash"/,
		);
		assert.match(html, /aria-label="Folders on this account"/);
	});

	it("names the account only where there is more than one", () => {
		assert.match(
			render({ accountEmail: "you@example.com" }),
			/you@example.com/,
		);
		assert.doesNotMatch(render({}), /you@example\.com/);
	});

	it("offers a new folder only where the account has no Trash at all", () => {
		const create = async (): Promise<FolderTreeNode> => ({
			id: "mb-new",
			label: "Trash",
			path: "INBOX/Trash",
		});
		assert.match(render({ onCreateFolder: create }), />New folder</);
		assert.doesNotMatch(
			render({ reason: "stale", onCreateFolder: create }),
			/New folder/,
		);
		assert.doesNotMatch(
			render({ reason: "unconfirmed", onCreateFolder: create }),
			/New folder/,
		);
	});

	it("warns in the tone of the pending action, not of the reason", () => {
		assert.match(render({ reason: "none" }), /text-warning/);
		assert.match(
			render({ reason: "unconfirmed", action: { kind: "emptyTrash" } }),
			/text-danger/,
		);
	});

	it("replaces the body with the in-flight write, and takes the way out away", () => {
		const html = render({
			selectedId: "mb-prullenbak",
			phase: { kind: "appointing" },
		});
		assert.match(html, /Setting the Trash folder…/);
		assert.match(html, /data-escape-owner/);
		assert.match(html, /aria-live="polite"/);
		assert.doesNotMatch(html, />Cancel</);
	});

	it("says what the re-issued action is doing, per verb", () => {
		assert.match(
			render({ selectedId: "mb-prullenbak", phase: { kind: "acting" } }),
			/Deleting 12 messages…/,
		);
		assert.match(
			render({
				selectedId: "mb-prullenbak",
				action: { kind: "emptyTrash" },
				phase: { kind: "acting" },
			}),
			/Emptying Prullenbak…/,
		);
	});

	it("keeps the picker and the selection through a failed appointment", () => {
		const html = render({
			selectedId: "mb-prullenbak",
			phase: { kind: "appoint-failed", cause: "generic" },
		});
		assert.match(
			html,
			/Couldn&#x27;t set that folder as Trash\. Nothing has been deleted\. Please try again\./,
		);
		assert.match(html, /Set as Trash and delete 12 messages/);
		assert.match(html, /role="alert"/);
	});

	it("words an unsettled mailbox as a wait, not a failure to retry blindly", () => {
		const html = render({
			selectedId: "mb-prullenbak",
			phase: { kind: "appoint-failed", cause: "mailbox-pending" },
		});
		assert.match(
			html,
			/Prullenbak is still being created on the mail server\. Wait for it to finish, then try again\./,
		);
	});
});
