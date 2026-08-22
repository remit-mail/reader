/**
 * The Empty Trash strip and its three refusals (#847). Rendered as the app
 * renders it — no providers, because every fact it shows arrives as a prop and
 * the 409 is what decides which one.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	EmptyTrashBar,
	type EmptyTrashBarProps,
	emptyTrashConfirmCopy,
} from "@/components/mail/EmptyTrashBar";
import { deleteConfirmationCopy } from "@/lib/format";

(globalThis as { React?: typeof React }).React = React;

const noop = () => {};

const propsFor = (
	overrides: Partial<EmptyTrashBarProps>,
): EmptyTrashBarProps => ({
	messageCount: 128,
	isEmptying: false,
	onEmpty: noop,
	onRepair: noop,
	children: createElement("div", { id: "list" }, "list"),
	...overrides,
});

const render = (overrides: Partial<EmptyTrashBarProps>): string =>
	renderToString(createElement(EmptyTrashBar, propsFor(overrides)));

const text = (html: string): string =>
	html
		.replace(/<[^>]*>/g, " ")
		.replace(/&#x27;/g, "'")
		.replace(/&#x2F;/g, "/")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim();

describe("EmptyTrashBar", () => {
	it("offers the verb when the open Trash folder holds mail", () => {
		const html = render({});
		assert.match(text(html), /Empty Trash/);
		assert.match(html, /id="list"/);
	});

	it("offers nothing over an empty folder, and still renders the list", () => {
		const html = render({ messageCount: 0 });
		assert.doesNotMatch(text(html), /Empty Trash/);
		assert.match(html, /id="list"/);
	});

	it("disables the button while the empty is in flight", () => {
		const html = render({ isEmptying: true });
		assert.match(text(html), /Emptying/);
		assert.match(html, /disabled/);
	});

	it("reports the service's own count once the run finishes", () => {
		const html = render({ messageCount: 0, deletedCount: 128 });
		assert.match(text(html), /128 messages erased from the mail server\./);
	});

	it("keeps the refusal standing after the folder count drops to zero", () => {
		const html = render({ messageCount: 0, refusalReason: "none" });
		assert.match(text(html), /No folder on this account is set as Trash\./);
	});

	it("words `unconfirmed` with deleteConfirmationCopy's own sentence", () => {
		const copy = deleteConfirmationCopy(0, "unconfirmed", {
			trashFolderLabel: "Deleted Items",
		});
		const html = text(
			render({
				refusalReason: "unconfirmed",
				trashFolderLabel: "Deleted Items",
			}),
		);
		assert.match(html, new RegExp(literal(copy.title)));
		assert.match(html, new RegExp(literal(copy.description)));
		assert.match(html, new RegExp(literal(copy.confirmLabel)));
	});

	it("names the folder a stale appointment lost", () => {
		const html = text(
			render({ refusalReason: "stale", staleFolderLabel: "Archive/Bin" }),
		);
		assert.match(html, /Nothing was emptied\./);
		assert.match(html, /Archive\/Bin — is gone from the mail server\./);
		assert.match(html, /Pick another folder/);
	});

	it("drops the folder clause when the lost folder has no name", () => {
		const html = text(render({ refusalReason: "stale" }));
		assert.match(
			html,
			/The folder you chose for Trash is gone from the mail server\./,
		);
	});

	it("offers a folder to pick when the account appoints no Trash", () => {
		const html = text(render({ refusalReason: "none" }));
		assert.match(html, /No folder on this account is set as Trash\./);
		assert.match(html, /Pick a folder/);
	});

	it("asks the confirmation as the expunge it is", () => {
		const copy = emptyTrashConfirmCopy(128);
		assert.equal(copy.title, "Empty Trash?");
		assert.equal(
			copy.description,
			"128 messages are erased from the mail server and cannot be restored.",
		);
		assert.equal(copy.confirmLabel, "Empty Trash");
	});

	it("counts a single message in the singular", () => {
		assert.equal(
			emptyTrashConfirmCopy(1).description,
			"1 message is erased from the mail server and cannot be restored.",
		);
	});
});

function literal(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
