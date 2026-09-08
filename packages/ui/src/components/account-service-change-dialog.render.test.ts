/**
 * The confirmation between a switch and the change it asks for (#1179). The
 * promise disabling makes — nothing is deleted, the stored rows stay — is a
 * sentence a person reads before they commit, so it is asserted here rather
 * than left to the copy of the day.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	type AccountServiceChange,
	AccountServiceChangeDialog,
	accountServiceChangeCopy,
} from "./account-service-change-dialog.js";

const render = (change: AccountServiceChange | null): string =>
	renderToString(
		createElement(AccountServiceChangeDialog, {
			change,
			providerName: "Microsoft",
			onConfirm: () => {},
			onCancel: () => {},
		}),
	);

describe("AccountServiceChangeDialog", () => {
	it("renders nothing while no change is pending", () => {
		assert.equal(render(null), "");
	});

	it("promises stored mail stays and says sync stops", () => {
		const html = render({ kind: "disable", service: "Mail" });
		assert.match(html, /Mail already in Remit stays/);
		assert.match(html, /New mail stops arriving until you turn it back on\./);
		assert.match(html, /Nothing is deleted\./);
	});

	it("promises stored events stay when calendar goes off", () => {
		const html = render({ kind: "disable", service: "Calendar" });
		assert.match(html, /Events already in Remit stay on your calendar\./);
		assert.match(html, /Nothing is deleted\./);
	});

	it("names the sign-in round trip before a service is added", () => {
		const html = render({ kind: "enable", service: "Calendar" });
		assert.match(html, /Remit sends you to Microsoft to ask for it/);
		assert.match(html, /Nothing changes until you get back\./);
		assert.match(html, /Continue to Microsoft/);
	});

	it("sends the last service off to removing the account", () => {
		const copy = accountServiceChangeCopy(
			{ kind: "last", service: "Mail" },
			"Microsoft",
		);
		assert.match(copy.title, /only thing this account syncs/);
		assert.match(copy.description, /An account has to sync something\./);
		assert.equal(copy.confirmLabel, "Remove account");
		assert.equal(copy.cancelLabel, "Keep syncing mail");
		assert.equal(copy.destructive, true);
	});

	it("keeps switching a service off away from the destructive style", () => {
		const copy = accountServiceChangeCopy(
			{ kind: "disable", service: "Mail" },
			"Microsoft",
		);
		assert.equal(copy.destructive, false);
		assert.equal(copy.confirmLabel, "Stop syncing mail");
	});
});
