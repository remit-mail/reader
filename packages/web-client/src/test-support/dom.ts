/**
 * Mount-and-poke harness over the jsdom globals `@remit/test-dom` installs.
 *
 * Excluded from coverage by `test:run`; it lives under `src/` only because the
 * build's `rootDir` is `src/`. Node's test runner gives every test file its own
 * process, so nothing here leaks between files.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_VIEWPORT, setViewport } from "../../test-support/dom-env.mjs";
import { RoleAppointmentPromptProvider } from "../components/mail/RoleAppointmentPromptProvider";
import { ErrorBannerProvider } from "../components/ui/ErrorBannerProvider";

export interface DomHarness {
	window: Window & typeof globalThis;
	document: Document;
	container: HTMLElement;
	/** The client behind `renderApp`; seed it with `setQueryData`. */
	queryClient: QueryClient;
	render: (element: React.ReactNode) => void;
	/** Render under the providers every mail surface expects. */
	renderApp: (element: React.ReactNode) => void;
	renderAsync: (element: React.ReactNode) => Promise<void>;
	unmount: () => void;
	close: () => void;
	html: () => string;
	text: () => string;
	query: <T extends Element = HTMLElement>(selector: string) => T | null;
	queryAll: <T extends Element = HTMLElement>(selector: string) => T[];
	byLabel: (label: string) => HTMLElement;
	byText: (selector: string, text: string) => HTMLElement;
	click: (element: Element) => void;
	/** Pick an option by value and let React see the change. */
	select: (element: Element, value: string) => void;
	dispatch: (target: EventTarget, event: Event) => void;
	type: (element: Element, value: string) => void;
	flush: () => Promise<void>;
	/** Let real timers fire — some flows stage their steps on a delay. */
	wait: (ms: number) => Promise<void>;
	/**
	 * Pump the render until `predicate` holds, then return with the DOM current.
	 * A drain counted in ticks is a guess about how many awaits a read chain
	 * takes, and a loaded runner always finds one more; a condition is not.
	 */
	waitFor: (
		predicate: () => boolean,
		description?: string,
		timeoutMs?: number,
	) => Promise<void>;
}

export interface DomOptions {
	/** Width `matchMedia` answers against — jsdom has no layout of its own. */
	viewportWidth?: number;
	/** Screen posture `matchMedia` answers against — jsdom has no device. */
	orientation?: "portrait" | "landscape";
	pointer?: "coarse" | "fine";
	/**
	 * Use this `QueryClient` instead of the harness's default retry-disabled
	 * one — e.g. one wired with the real `QueryCache`/`MutationCache` error
	 * handlers from `lib/query-error-handler.ts`, the way `shell/index.tsx`
	 * builds it, so a test can exercise the real global escalation path
	 * instead of just the per-mutation `onError`.
	 */
	queryClient?: QueryClient;
}

export const createDomHarness = (options: DomOptions = {}): DomHarness => {
	setViewport({
		width: options.viewportWidth ?? DEFAULT_VIEWPORT.width,
		orientation: options.orientation ?? DEFAULT_VIEWPORT.orientation,
		pointer: options.pointer ?? DEFAULT_VIEWPORT.pointer,
	});
	// The test loader transpiles remit-ui's `.tsx` with the classic JSX runtime,
	// which reads a global `React`. Vite uses the automatic runtime, so this
	// shim exists only for the test harness.
	(globalThis as { React?: typeof React }).React = React;

	const container = document.createElement("div");
	document.body.appendChild(container);
	let root: Root | undefined = createRoot(container);
	// No retries: a test asserting a failure should not have to wait out a
	// backoff before it can see one.
	const queryClient =
		options.queryClient ??
		new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});

	const requireRoot = (): Root => {
		if (!root) throw new Error("harness already unmounted");
		return root;
	};

	const harness: DomHarness = {
		window: globalThis.window,
		document: globalThis.document,
		container,
		queryClient,
		render: (element) => {
			act(() => requireRoot().render(element as never));
		},
		renderApp: (element) => {
			harness.render(
				createElement(
					QueryClientProvider,
					{ client: queryClient },
					createElement(
						ErrorBannerProvider,
						null,
						createElement(RoleAppointmentPromptProvider, null, element),
					),
				),
			);
		},
		renderAsync: async (element) => {
			await act(async () => {
				requireRoot().render(element as never);
			});
		},
		unmount: () => {
			if (!root) return;
			const current = root;
			root = undefined;
			act(() => current.unmount());
		},
		close: () => {
			harness.unmount();
			// Drops every cached query along with its garbage-collection timer,
			// which otherwise holds the test process open for its full gcTime.
			queryClient.clear();
			container.remove();
			setViewport(DEFAULT_VIEWPORT);
		},
		html: () => container.innerHTML,
		text: () => container.textContent ?? "",
		query: <T extends Element = HTMLElement>(selector: string) =>
			container.querySelector(selector) as T | null,
		queryAll: <T extends Element = HTMLElement>(selector: string) =>
			[...container.querySelectorAll(selector)] as T[],
		byLabel: (label) => {
			const found = container.querySelector(`[aria-label="${label}"]`);
			if (!found) throw new Error(`no element labelled "${label}"`);
			return found as HTMLElement;
		},
		byText: (selector, text) => {
			const found = [...container.querySelectorAll(selector)].find((node) =>
				(node.textContent ?? "").includes(text),
			);
			if (!found) throw new Error(`no ${selector} containing "${text}"`);
			return found as HTMLElement;
		},
		click: (element) => {
			act(() => {
				element.dispatchEvent(
					new MouseEvent("click", { bubbles: true, cancelable: true }),
				);
			});
		},
		select: (element, value) => {
			act(() => {
				const node = element as HTMLSelectElement;
				Object.getOwnPropertyDescriptor(
					HTMLSelectElement.prototype,
					"value",
				)?.set?.call(node, value);
				node.dispatchEvent(new Event("change", { bubbles: true }));
			});
		},
		dispatch: (target, event) => {
			act(() => {
				target.dispatchEvent(event);
			});
		},
		type: (element, value) => {
			act(() => {
				const input = element as HTMLInputElement | HTMLTextAreaElement;
				const prototype =
					input instanceof HTMLTextAreaElement
						? HTMLTextAreaElement.prototype
						: HTMLInputElement.prototype;
				Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
					input,
					value,
				);
				input.dispatchEvent(new Event("input", { bubbles: true }));
			});
		},
		wait: async (ms) => {
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, ms));
			});
		},
		waitFor: async (
			predicate,
			description = "the render to settle",
			timeoutMs = 2_000,
		) => {
			const deadline = Date.now() + timeoutMs;
			for (;;) {
				await harness.flush();
				if (predicate()) return;
				if (Date.now() > deadline) {
					const shown = harness.text().trim() || "(nothing rendered)";
					throw new Error(
						`waited ${timeoutMs}ms for ${description}; the render shows: ${shown.slice(0, 400)}`,
					);
				}
				await harness.wait(1);
			}
		},
		flush: async () => {
			// Enough turns for a chain of awaits — form validation, then the
			// mutation, then its `onSuccess` — to settle.
			await act(async () => {
				for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
			});
		},
	};

	return harness;
};
