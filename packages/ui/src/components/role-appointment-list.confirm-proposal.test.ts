import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FolderRole } from "./folder-role.js";
import {
	type CandidateFolder,
	type RoleAppointment,
	RoleAppointmentList,
} from "./role-appointment-list.js";

const folders: CandidateFolder[] = [
	{
		mailboxId: "mb-inbox",
		providerPath: "INBOX",
		hierarchyDelimiter: "/",
		messageCount: 4821,
	},
	{
		mailboxId: "mb-deleted",
		providerPath: "INBOX/Deleted Messages",
		hierarchyDelimiter: "/",
		messageCount: 512,
	},
	{
		mailboxId: "mb-concepten",
		providerPath: "INBOX/Concepten",
		hierarchyDelimiter: "/",
		messageCount: 340,
	},
];

let container: HTMLElement;
let root: Root;
let appointed: Array<[FolderRole, string | null]>;

beforeEach(() => {
	appointed = [];
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	container.remove();
});

const mount = async (appointments: Record<string, RoleAppointment>) => {
	await act(async () => {
		root.render(
			createElement(RoleAppointmentList, {
				accountEmail: "you@example.com",
				folders,
				appointments,
				displayNames: {},
				onAppoint: (role: FolderRole, mailboxId: string | null) => {
					appointed.push([role, mailboxId]);
				},
				onRename: () => {},
			}),
		);
	});
};

const buttonNamed = (text: string): HTMLButtonElement | undefined =>
	[...container.querySelectorAll("button")].find(
		(button) => button.textContent?.trim() === text,
	);

const click = async (element: Element | undefined) => {
	assert.ok(element, "the control is rendered");
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
};

describe("confirming a proposed folder role", () => {
	it("commits the folder the picker already shows", async () => {
		await mount({
			trash: { mailboxId: "mb-deleted", source: "Proposed" },
		});
		await click(buttonNamed("Set as Trash"));
		assert.deepEqual(appointed, [["trash", "mb-deleted"]]);
	});

	it("offers the commit on every proposed role, naming that role", async () => {
		await mount({
			trash: { mailboxId: "mb-deleted", source: "Proposed" },
			drafts: { mailboxId: "mb-concepten", source: "Proposed" },
		});
		await click(buttonNamed("Set as Drafts"));
		assert.deepEqual(appointed, [["drafts", "mb-concepten"]]);
	});

	it("leaves a vouched row alone — there is nothing to confirm", async () => {
		await mount({
			trash: { mailboxId: "mb-deleted", source: "Appointed" },
			drafts: { mailboxId: "mb-concepten", source: "Flagged" },
			inbox: { mailboxId: "mb-inbox", source: "Reserved" },
		});
		assert.equal(buttonNamed("Set as Trash"), undefined);
		assert.equal(buttonNamed("Set as Drafts"), undefined);
		assert.equal(buttonNamed("Set as Inbox"), undefined);
	});

	it("offers nothing to commit when the proposal resolves to no folder", async () => {
		await mount({ trash: { mailboxId: null, source: "Proposed" } });
		assert.equal(buttonNamed("Set as Trash"), undefined);
	});
});
