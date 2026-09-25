import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	FolderMutationDialog,
	type FolderMutationDialogProps,
	type FolderMutationPhase,
} from "./folder-mutation-dialog.js";

let container: HTMLElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

const render = (
	props: Partial<FolderMutationDialogProps> & {
		intent: "rename" | "delete";
		phase: FolderMutationPhase;
	},
	handlers: {
		onRetry?: () => void;
		onRefresh?: () => void;
		onClose?: () => void;
	} = {},
) => {
	act(() => {
		root.render(
			createElement(FolderMutationDialog, {
				open: true,
				folderName: "Receipts",
				targetName: "Q3 Receipts",
				onRetry: handlers.onRetry ?? (() => undefined),
				onRefresh: handlers.onRefresh ?? (() => undefined),
				onClose: handlers.onClose ?? (() => undefined),
				...props,
			}) as never,
		);
	});
};

const buttonByText = (re: RegExp): HTMLButtonElement | undefined =>
	Array.from(container.querySelectorAll("button")).find((button) =>
		re.test(button.textContent ?? ""),
	);

const allButtonLabels = (): string[] =>
	Array.from(container.querySelectorAll("button")).map(
		(button) => button.getAttribute("aria-label") ?? button.textContent ?? "",
	);

describe("FolderMutationDialog", () => {
	it("renders nothing when closed", () => {
		render({ open: false, intent: "rename", phase: { kind: "waiting" } });
		assert.equal(container.textContent, "");
	});

	it("renders the rename waiting phase", () => {
		render({ intent: "rename", phase: { kind: "waiting" } });
		assert.match(container.textContent ?? "", /Renaming folder/);
		assert.match(
			container.textContent ?? "",
			/Renaming “Receipts” to “Q3 Receipts” on the mail server…/,
		);
	});

	it("renders the rename timed-out phase", () => {
		render({ intent: "rename", phase: { kind: "timed-out" } });
		assert.match(container.textContent ?? "", /Still renaming/);
		assert.match(
			container.textContent ?? "",
			/“Receipts” is still being renamed\. It will finish on its own — you can close this and keep working\. The folder shows “Renaming…” until it does\./,
		);
	});

	it("renders the rename failed phase", () => {
		render({
			intent: "rename",
			phase: { kind: "failed", serverMessage: "Mailbox already exists" },
		});
		assert.match(container.textContent ?? "", /Rename failed/);
		assert.match(
			container.textContent ?? "",
			/Couldn’t rename “Receipts”\. The mail server refused: Mailbox already exists\. The folder is unchanged\./,
		);
	});

	it("renders the rename conflict phase", () => {
		render({ intent: "rename", phase: { kind: "conflict" } });
		assert.match(container.textContent ?? "", /Already in progress/);
		assert.match(
			container.textContent ?? "",
			/Something else is already renaming or deleting “Receipts”\. Refresh to see where it got to\./,
		);
	});

	it("renders the delete waiting phase", () => {
		render({ intent: "delete", phase: { kind: "waiting" } });
		assert.match(container.textContent ?? "", /Deleting folder/);
		assert.match(
			container.textContent ?? "",
			/Deleting “Receipts” and everything in it from the mail server…/,
		);
	});

	it("renders the delete timed-out phase", () => {
		render({ intent: "delete", phase: { kind: "timed-out" } });
		assert.match(container.textContent ?? "", /Still deleting/);
		assert.match(
			container.textContent ?? "",
			/“Receipts” is still being deleted\. It will finish on its own — you can close this\. The folder shows “Deleting…” until it does\./,
		);
	});

	it("renders the delete failed phase", () => {
		render({
			intent: "delete",
			phase: { kind: "failed", serverMessage: "Mailbox has children" },
		});
		assert.match(container.textContent ?? "", /Delete failed/);
		assert.match(
			container.textContent ?? "",
			/Couldn’t delete “Receipts”\. The mail server refused: Mailbox has children\. Nothing was deleted\./,
		);
	});

	it("renders the delete conflict phase, with the order of intents swapped", () => {
		render({ intent: "delete", phase: { kind: "conflict" } });
		assert.match(container.textContent ?? "", /Already in progress/);
		assert.match(
			container.textContent ?? "",
			/Something else is already deleting or renaming “Receipts”\. Refresh to see where it got to\./,
		);
	});

	it("renders a server message verbatim, including characters that would need escaping", () => {
		const serverMessage = "Refused: <INBOX/Sub> & \"quoted\" 'name'";
		render({
			intent: "rename",
			phase: { kind: "failed", serverMessage },
		});
		const paragraph = container.querySelector("p");
		assert.ok(paragraph, "the body paragraph is present");
		assert.match(paragraph?.textContent ?? "", /Refused: <INBOX\/Sub>/);
		assert.match(paragraph?.textContent ?? "", /& "quoted" 'name'/);
	});

	it("never renders a control labelled Cancel, across every phase and intent", () => {
		const phases: FolderMutationPhase[] = [
			{ kind: "waiting" },
			{ kind: "timed-out" },
			{ kind: "failed", serverMessage: "The mail server refused." },
			{ kind: "conflict" },
		];
		for (const intent of ["rename", "delete"] as const) {
			for (const phase of phases) {
				render({ intent, phase });
				for (const label of allButtonLabels()) {
					assert.doesNotMatch(label, /cancel/i);
				}
			}
		}
	});

	it("fires onRetry from Try again, and Close does not fire onRetry", () => {
		let retried = false;
		let closed = false;
		render(
			{
				intent: "rename",
				phase: { kind: "failed", serverMessage: "The mail server refused." },
			},
			{
				onRetry: () => {
					retried = true;
				},
				onClose: () => {
					closed = true;
				},
			},
		);
		act(() => buttonByText(/^Close$/)?.click());
		assert.equal(closed, true, "Close fires onClose");
		assert.equal(retried, false, "Close does not fire onRetry");

		closed = false;
		act(() => buttonByText(/^Try again$/)?.click());
		assert.equal(retried, true, "Try again fires onRetry");
	});

	it("fires onRefresh from Refresh", () => {
		let refreshed = false;
		render(
			{ intent: "delete", phase: { kind: "conflict" } },
			{
				onRefresh: () => {
					refreshed = true;
				},
			},
		);
		act(() => buttonByText(/^Refresh$/)?.click());
		assert.equal(refreshed, true);
	});

	const footerLabels = (): string[] =>
		allButtonLabels().filter((label) => label !== "Dismiss dialog");

	it("offers Close alone while waiting, and fires onClose", () => {
		let closed = false;
		render(
			{ intent: "rename", phase: { kind: "waiting" } },
			{
				onClose: () => {
					closed = true;
				},
			},
		);
		assert.deepEqual(footerLabels(), ["Close"]);
		act(() => buttonByText(/^Close$/)?.click());
		assert.equal(closed, true);
	});

	it("offers Refresh alone on conflict", () => {
		render({ intent: "rename", phase: { kind: "conflict" } });
		assert.deepEqual(footerLabels(), ["Refresh"]);
	});
});
