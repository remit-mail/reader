/**
 * DeleteConfirmDialog — the dialog says what the delete will do, and when it
 * cannot say, it refuses (#845, #855).
 *
 * The outcome arrives as a prop, so every branch is reachable here without a
 * query in the way — including the one that matters most, a `/config` read that
 * failed. `deleteOutcomeFor` (see `lib/format.test.ts`) pins which outcome each
 * read state produces; this pins what each outcome puts on screen.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18next from "i18next";
import type { JSDOM } from "jsdom";
import React, { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider, initReactI18next } from "react-i18next";
import {
	type AuthProvider,
	AuthProviderProvider,
	noneAuthProvider,
} from "@/auth/provider";
import type { DeleteOutcome } from "@/lib/format";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { RoleAppointmentPromptProvider } from "./RoleAppointmentPromptProvider";

// remit-ui's `.tsx` is transpiled with the classic JSX runtime, which
// references a global `React`; the app uses the automatic runtime, so this
// shim only exists for the test harness.
(globalThis as { React?: typeof React }).React = React;

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
	lng: "en",
	ns: ["mail"],
	defaultNS: "mail",
	resources: { en: { mail: {} } },
});

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
const originalFetch = globalThis.fetch;

before(async () => {
	const { JSDOM: JSDOMCtor } = await import("jsdom");
	dom = new JSDOMCtor(
		"<!doctype html><html><body><div id=root></div></body></html>",
		{ url: "http://localhost/", pretendToBeVisual: true },
	);
	globalThis.window = dom.window as unknown as typeof globalThis.window;
	globalThis.document = dom.window.document;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.Element = dom.window.Element;
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
	});
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

after(() => dom.window.close());

beforeEach(() => {
	container = dom.window.document.getElementById(
		"root",
	) as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const path = new URL(
			input instanceof Request ? input.url : String(input),
			"http://localhost",
		).pathname;
		return new Response(JSON.stringify(answerFor(path)), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof fetch;
});

const ACCOUNT = "acc-1";

/** Enough of the account for the appointment prompt to have folders to offer. */
const answerFor = (path: string): unknown => {
	if (path.endsWith("/config")) {
		return {
			accounts: [
				{
					accountId: ACCOUNT,
					email: `${ACCOUNT}@example.com`,
					folderAppointments: [{ role: "Trash", source: "None" }],
				},
			],
		};
	}
	if (path.endsWith("/mailboxes")) {
		return {
			items: [
				{
					mailboxId: "mbx-trash",
					accountId: ACCOUNT,
					fullPath: "Prullenbak",
					hierarchyDelimiter: "/",
					messageCount: 3,
				},
			],
		};
	}
	return {};
};

/** Let the queries and the two writes behind the confirm run to completion. */
const settle = async (): Promise<void> => {
	for (let round = 0; round < 8; round += 1) {
		await act(async () => {
			await Promise.resolve();
		});
	}
};

afterEach(() => {
	act(() => root.unmount());
	globalThis.fetch = originalFetch;
});

/** A deployment with an identity system and a live session to sign back into. */
const sessionAuthProvider = (signOut: () => void): AuthProvider => ({
	...noneAuthProvider,
	Account: ({ children }) =>
		createElement(
			Fragment,
			null,
			children({ email: "reader@example.com", signOut }),
		),
});

const mount = (options: {
	outcome: DeleteOutcome;
	count?: number;
	isDeleting?: boolean;
	accountId?: string;
	trashFolderLabel?: string;
	staleFolderLabel?: string;
	authProvider?: AuthProvider;
	onConfirm?: (messageIds: string[]) => void;
}) => {
	const onConfirm = options.onConfirm ?? (() => undefined);
	const messageIds = Array.from(
		{ length: options.count ?? 1 },
		(_, index) => `msg-${index}`,
	);
	act(() =>
		root.render(
			createElement(
				I18nextProvider,
				{ i18n },
				createElement(
					QueryClientProvider,
					{ client: new QueryClient() },
					createElement(
						RoleAppointmentPromptProvider,
						null,
						createElement(
							AuthProviderProvider,
							{ value: options.authProvider ?? noneAuthProvider },
							createElement(DeleteConfirmDialog, {
								isOpen: true,
								messageIds,
								outcome: options.outcome,
								accountId: options.accountId,
								trashFolderLabel: options.trashFolderLabel,
								staleFolderLabel: options.staleFolderLabel,
								isDeleting: options.isDeleting,
								onConfirm,
								onCancel: () => undefined,
							}),
						),
					),
				),
			),
		),
	);
	return {
		text: () => dom.window.document.body.textContent ?? "",
		button: (label: string) =>
			Array.from(
				dom.window.document.querySelectorAll<HTMLButtonElement>("button"),
			).find((b) => b.textContent === label),
		byLabel: (label: string) =>
			dom.window.document.querySelector<HTMLElement>(`[aria-label="${label}"]`),
	};
};

describe("DeleteConfirmDialog — the wording follows the consequence", () => {
	it("offers the reversible move outside Trash", () => {
		const view = mount({ outcome: "trash" });
		assert.match(view.text(), /Move 1 message to Trash\?/);
		assert.equal(view.button("Move to Trash")?.disabled, false);
	});

	it("asks about destruction inside Trash", () => {
		const view = mount({ outcome: "permanent", count: 3 });
		assert.match(view.text(), /Permanently delete 3 messages\?/);
		assert.match(view.text(), /cannot be restored/);
		assert.equal(view.button("Delete permanently")?.disabled, false);
	});

	it("holds the confirm while the appointment is still arriving", () => {
		const view = mount({ outcome: "unknown" });
		assert.match(view.text(), /Checking where this account files deleted mail/);
		assert.equal(
			view.button("Delete")?.disabled,
			true,
			"the answer decides which of two dialogs this is",
		);
	});

	it("holds the confirm while a delete is already in flight", () => {
		const view = mount({ outcome: "trash", isDeleting: true });
		assert.equal(view.button("Move to Trash")?.disabled, true);
	});
});

/**
 * The blocking case. TanStack leaves a failed read as `status: "error"` with no
 * data, and an empty Trash set read as "this folder is not Trash" — so an
 * expired session was shown "Move to Trash?" over an expunge. A read that could
 * not answer never renders as an answer.
 */
describe("DeleteConfirmDialog — a read that failed refuses the delete", () => {
	it("states what failed instead of promising a move", () => {
		const view = mount({ outcome: "unavailable" });
		const text = view.text();
		assert.match(text, /Can't delete 1 message/);
		assert.match(text, /Nothing has been deleted/);
		assert.doesNotMatch(text, /Move 1 message to Trash\?/);
		assert.doesNotMatch(text, /restore them from Trash later/);
		assert.doesNotMatch(
			text,
			/Checking where this account files deleted mail/,
			"no read is in flight, so nothing may claim one is",
		);
	});

	it("re-authenticates from the affirmative control, and never deletes", () => {
		let signedOut = 0;
		let confirmed = 0;
		const view = mount({
			outcome: "unavailable",
			authProvider: sessionAuthProvider(() => {
				signedOut += 1;
			}),
			onConfirm: () => {
				confirmed += 1;
			},
		});

		const signIn = view.button("Sign in again");
		assert.ok(signIn, "the way back in is on screen");
		assert.equal(signIn?.disabled, false, "and it can be pressed");

		act(() => signIn?.click());
		assert.equal(signedOut, 1);
		assert.equal(confirmed, 0, "the refusal never reaches the delete");
	});

	it("offers a reload where there is no session to sign back into", () => {
		const view = mount({ outcome: "unavailable" });
		assert.equal(view.button("Sign in again"), undefined);
		assert.equal(view.button("Reload reader")?.disabled, false);
	});
});

/**
 * An account that appoints no Trash, or one whose appointed folder is gone, is
 * a resolved answer: the server refuses that delete outright (#846) rather than
 * moving anything. The remedy is the appointment, made where the refusal
 * happened — never a link to Settings the user has to come back from (#887).
 */
describe("DeleteConfirmDialog — a refusal answers itself", () => {
	it("refuses rather than promising a restore", () => {
		const view = mount({ outcome: "noTrash", count: 2, accountId: "acc-1" });
		const text = view.text();
		assert.match(text, /Can.t delete 2 messages yet/);
		assert.match(text, /No folder on this account is set as Trash/);
		assert.doesNotMatch(text, /Move 2 messages to Trash?/);
		assert.doesNotMatch(text, /restore them from Trash later/);
	});

	it("opens the appointment prompt instead of leaving for Settings", () => {
		let confirmed = 0;
		const view = mount({
			outcome: "noTrash",
			accountId: "acc-1",
			onConfirm: () => {
				confirmed += 1;
			},
		});
		assert.equal(view.button("Open folder settings"), undefined);
		const pick = view.button("Pick a Trash folder");
		assert.ok(pick, "the remedy the copy names is on screen");
		assert.equal(pick?.disabled, false);

		act(() => pick?.click());
		assert.match(view.text(), /No folder is set as Trash/);
		assert.equal(confirmed, 0, "the refusal never reaches the delete");
	});

	it("names the folder that vanished, and repairs it in place", () => {
		const view = mount({
			outcome: "staleTrash",
			count: 2,
			accountId: "acc-1",
			staleFolderLabel: "INBOX/Prullenbak",
		});
		assert.match(view.text(), /INBOX\/Prullenbak/);
		const pick = view.button("Pick another folder");
		assert.ok(pick);
		act(() => pick?.click());
		assert.match(view.text(), /The Trash folder you chose is gone/);
	});

	// #876: a row already inside the folder reader only matched by name refuses
	// like Empty Trash's own "unconfirmed" — not a plain "Delete permanently"
	// the server would 409 on.
	it("asks to confirm the guessed folder before an expunge nobody confirmed", async () => {
		const view = mount({
			outcome: "unconfirmed",
			count: 3,
			accountId: ACCOUNT,
			trashFolderLabel: "Deleted Messages",
		});
		const text = view.text();
		assert.match(text, /Confirm this account's Trash folder/);
		assert.match(text, /Deleted Messages/);
		assert.doesNotMatch(text, /Permanently delete 3 messages\?/);
		const confirm = view.button("Confirm the folder");
		assert.ok(confirm, "the remedy the copy names is on screen");
		act(() => confirm?.click());
		// DeleteConfirmDialog's own "unconfirmed" copy shares its title with the
		// appointment prompt's, so the title alone cannot tell the two dialogs
		// apart — matching only that string would pass whether or not the
		// prompt actually replaced the dialog. The picker prompt is the
		// prompt's own wording and never appears in DeleteConfirmDialog's copy.
		assert.match(
			view.text(),
			/Confirm Deleted Messages, or pick the folder this account really uses\./,
		);
		await settle();
		act(() => view.byLabel("Set Prullenbak, 3 messages, as Trash")?.click());
		assert.ok(
			view.button("Set as Trash and delete 3 messages"),
			"the folder picker and the delete-specific confirm label are the prompt's own, not the dialog's",
		);
	});

	it("still acts when no single account owns the rows", () => {
		const confirmed: string[][] = [];
		const view = mount({
			outcome: "noTrash",
			onConfirm: (ids) => confirmed.push(ids),
		});
		const pick = view.button("Pick a Trash folder");
		assert.equal(pick?.disabled, false, "never a control that does nothing");
		act(() => pick?.click());
		assert.deepEqual(
			confirmed,
			[["msg-0"]],
			"the server's own 409 names the account",
		);
	});

	// The dialog is gone by the time the appointment lands, so the replay cannot
	// read the caller's pending state — it carries the rows it was about.
	it("hands the replay the rows the delete was about", async () => {
		const confirmed: string[][] = [];
		const view = mount({
			outcome: "noTrash",
			count: 3,
			accountId: ACCOUNT,
			onConfirm: (ids) => confirmed.push(ids),
		});

		act(() => view.button("Pick a Trash folder")?.click());
		await settle();
		assert.deepEqual(
			confirmed,
			[],
			"nothing is deleted before a folder is set",
		);

		act(() => view.byLabel("Set Prullenbak, 3 messages, as Trash")?.click());
		await settle();
		act(() => view.button("Set as Trash and delete 3 messages")?.click());
		await settle();

		assert.deepEqual(confirmed, [["msg-0", "msg-1", "msg-2"]]);
	});
});

describe("DeleteConfirmDialog — an expunge inside a confirmed Trash", () => {
	it("asks for the expunge itself, with no folder to confirm first", () => {
		const view = mount({ outcome: "permanent", count: 3 });
		const text = view.text();
		assert.match(text, /Permanently delete 3 messages\?/);
		assert.doesNotMatch(text, /nobody confirmed it/);
		assert.equal(view.button("Delete permanently")?.disabled, false);
	});
});
