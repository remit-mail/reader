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
import type { JSDOM } from "jsdom";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	type AuthProvider,
	AuthProviderProvider,
	noneAuthProvider,
} from "@/auth/provider";
import type { DeleteOutcome } from "@/lib/format";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";

let dom: JSDOM;
let container: HTMLElement;
let root: Root;

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
});

afterEach(() => {
	act(() => root.unmount());
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
	authProvider?: AuthProvider;
	onConfirm?: () => void;
}) => {
	const onConfirm = options.onConfirm ?? (() => undefined);
	act(() =>
		root.render(
			createElement(
				AuthProviderProvider,
				{ value: options.authProvider ?? noneAuthProvider },
				createElement(DeleteConfirmDialog, {
					isOpen: true,
					count: options.count ?? 1,
					outcome: options.outcome,
					isDeleting: options.isDeleting,
					onConfirm,
					onCancel: () => undefined,
				}),
			),
		),
	);
	return {
		text: () => dom.window.document.body.textContent ?? "",
		button: (label: string) =>
			Array.from(
				dom.window.document.querySelectorAll<HTMLButtonElement>("button"),
			).find((b) => b.textContent === label),
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
