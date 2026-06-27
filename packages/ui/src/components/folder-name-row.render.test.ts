import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	canonicalRoleLabel,
	FOLDER_ROLES,
	FolderNameRow,
	type FolderNameRowProps,
	folderNameDefault,
	folderRowAffordance,
	folderRowOverridden,
	providerLeaf,
} from "./folder-name-row.js";

const noop = () => {};

function render(props: Partial<FolderNameRowProps> = {}): string {
	return renderToString(
		createElement(FolderNameRow, {
			providerPath: "INBOX",
			detectedRole: "inbox",
			role: "inbox",
			name: "",
			onCommit: noop,
			onReset: noop,
			...props,
		}),
	);
}

describe("folder-name-row helpers", () => {
	it("providerLeaf returns the last path segment", () => {
		assert.equal(providerLeaf("INBOX/Sent Messages"), "Sent Messages");
		assert.equal(providerLeaf("INBOX"), "INBOX");
	});

	it("canonicalRoleLabel maps roles and returns null for custom", () => {
		assert.equal(canonicalRoleLabel("inbox"), "Inbox");
		assert.equal(canonicalRoleLabel("junk"), "Spam");
		assert.equal(canonicalRoleLabel("flagged"), "Starred");
		assert.equal(canonicalRoleLabel("custom"), null);
	});

	it("folderNameDefault uses canonical label, else the provider leaf", () => {
		assert.equal(folderNameDefault("sent", "INBOX/Verzonden"), "Sent");
		assert.equal(
			folderNameDefault("custom", "INBOX/Nieuwsbrieven"),
			"Nieuwsbrieven",
		);
	});

	it("folderRowOverridden is true on a committed name or role override", () => {
		assert.equal(
			folderRowOverridden({ detectedRole: "inbox", role: "inbox", name: "" }),
			false,
		);
		assert.equal(
			folderRowOverridden({
				detectedRole: "inbox",
				role: "inbox",
				name: "Primary",
			}),
			true,
		);
		assert.equal(
			folderRowOverridden({ detectedRole: "custom", role: "sent", name: "" }),
			true,
		);
	});
});

describe("folderRowAffordance", () => {
	const committed = { detectedRole: "inbox", role: "inbox", name: "" } as const;

	it("is none when draft equals an un-overridden committed value", () => {
		assert.equal(
			folderRowAffordance({ ...committed, draftRole: "inbox", draftName: "" }),
			"none",
		);
	});

	it("is commit while the draft name differs from committed", () => {
		assert.equal(
			folderRowAffordance({
				...committed,
				draftRole: "inbox",
				draftName: "Primary",
			}),
			"commit",
		);
	});

	it("is commit while the draft role differs from committed", () => {
		assert.equal(
			folderRowAffordance({
				...committed,
				draftRole: "archive",
				draftName: "",
			}),
			"commit",
		);
	});

	it("is reset when a committed override has no pending edit", () => {
		assert.equal(
			folderRowAffordance({
				detectedRole: "inbox",
				role: "inbox",
				name: "Primary",
				draftRole: "inbox",
				draftName: "Primary",
			}),
			"reset",
		);
	});

	it("prefers commit over reset when both an override and a pending edit exist", () => {
		assert.equal(
			folderRowAffordance({
				detectedRole: "inbox",
				role: "inbox",
				name: "Primary",
				draftRole: "inbox",
				draftName: "Personal",
			}),
			"commit",
		);
	});
});

describe("FolderNameRow", () => {
	it("uses the canonical default for the live role as the placeholder", () => {
		assert.match(render({ role: "inbox" }), /placeholder="Inbox"/);
		assert.match(render({ role: "sent" }), /placeholder="Sent"/);
		assert.match(render({ role: "junk" }), /placeholder="Spam"/);
	});

	it("falls back to the provider leaf for a custom folder placeholder", () => {
		assert.match(
			render({ providerPath: "INBOX/Nieuwsbrieven", role: "custom" }),
			/placeholder="Nieuwsbrieven"/,
		);
	});

	it("shows the role icon (in the select) for the live role", () => {
		assert.match(render({ role: "inbox" }), /lucide-inbox/);
		assert.match(render({ role: "sent" }), /lucide-send/);
		assert.match(render({ role: "junk" }), /lucide-octagon-alert/);
		assert.match(render({ role: "custom" }), /lucide-folder/);
	});

	it("seeds the draft from defaultDraft and swaps the icon to match it", () => {
		const html = render({
			role: "custom",
			defaultDraft: { role: "sent" },
		});
		assert.match(html, /lucide-send/);
		assert.match(html, /value="sent" selected/);
	});

	it("renders the committed name as the input value by default", () => {
		assert.match(render({ name: "Primary" }), /value="Primary"/);
	});

	it("offers every role in the picker with the live one selected", () => {
		const html = render({ role: "sent" });
		for (const role of FOLDER_ROLES) {
			assert.ok(
				html.includes(`value="${role}"`),
				`expected option for ${role}`,
			);
		}
		assert.match(html, /value="sent" selected/);
	});

	it("shows no commit or reset affordance when clean", () => {
		const html = render({ detectedRole: "inbox", role: "inbox", name: "" });
		assert.doesNotMatch(html, /lucide-check/);
		assert.doesNotMatch(html, /lucide-rotate-ccw/);
	});

	it("shows the commit affordance (not reset) when the draft is pending", () => {
		const html = render({ defaultDraft: { name: "Primary" } });
		assert.match(html, /lucide-check/);
		assert.doesNotMatch(html, /lucide-rotate-ccw/);
	});

	it("shows the reset affordance (not commit) when committed-overridden, no pending edit", () => {
		const html = render({ name: "Primary" });
		assert.match(html, /lucide-rotate-ccw/);
		assert.doesNotMatch(html, /lucide-check/);
	});

	it("shows reset for a committed role override", () => {
		const html = render({ detectedRole: "custom", role: "sent" });
		assert.match(html, /lucide-rotate-ccw/);
	});

	it("renders the provider path read-only", () => {
		assert.match(
			render({ providerPath: "INBOX/Sent Messages" }),
			/INBOX\/Sent Messages/,
		);
	});
});
