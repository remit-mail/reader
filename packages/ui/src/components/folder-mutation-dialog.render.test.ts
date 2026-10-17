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
