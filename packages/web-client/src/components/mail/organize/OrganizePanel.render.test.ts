import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { organizeOperationsCreateOrganizeJobMutation } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { MutationObserver } from "@tanstack/query-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ErrorBannerProvider } from "@/components/ui/ErrorBannerProvider";
import { buildOrganizeInput } from "@/lib/organize/organize-model";
import { OrganizePanel } from "./OrganizePanel";

// The node test loader transpiles remit-ui's `.tsx` with the classic JSX
// runtime, which references a global `React`. Vite uses the automatic runtime,
// so this shim only exists for the SSR test harness.
(globalThis as { React?: typeof React }).React = React;

const render = () =>
	renderToString(
		createElement(
			QueryClientProvider,
			{ client: new QueryClient() },
			createElement(
				ErrorBannerProvider,
				null,
				createElement(OrganizePanel, {
					accountId: "acc-1",
					mailboxId: "mbx-inbox",
					selectedMessageIds: ["msg-1", "msg-2"],
					anchorMessageId: "msg-1",
					matchedCount: 47,
					onClose: () => undefined,
				}),
			),
		) as never,
	);

describe("OrganizePanel", () => {
	it("renders the organize sentence with the widened count", () => {
		const html = render();
		assert.match(html, /similar message/);
		assert.match(html, /from 2 selected/);
	});

	it("surfaces the disabled reason until a folder is chosen (ux.md — say why)", () => {
		const html = render();
		assert.match(html, /Pick a folder to move these into/);
		assert.match(html, /available yet/i);
	});

	it("offers all four commit scopes", () => {
		const html = render();
		assert.match(html, /Just these/);
		assert.match(html, /All like these/);
		assert.match(html, /These and new mail like this/);
		assert.match(html, /Until a date/);
	});
});

// The commit button's `disabled` prop is
// `!!disabledReason || createFilter.isPending || organizeJob.isStarting`
// (#1279) — a slow POST to /organize must block a second click just like an
// in-flight createFilter does, or the back-apply runs twice. `renderToString`
// never dispatches the click that would exercise that wiring end-to-end (SSR
// doesn't run event handlers), so this drives the exact mutation config
// `useOrganizeJob().start()` calls — `organizeOperationsCreateOrganizeJobMutation()`
// — through a real `MutationObserver` and confirms it reports `isPending`
// (what `organizeJob.isStarting` is) for the whole time the POST is in
// flight, which is the invariant the disabled expression relies on.
describe("organizeJob.isStarting — the create-organize-job POST stays pending until it resolves (#1279)", () => {
	it("reports isPending immediately after start() and keeps it pending while the POST hasn't come back", () => {
		const queryClient = new QueryClient();
		const observer = new MutationObserver(
			queryClient,
			organizeOperationsCreateOrganizeJobMutation(),
		);

		assert.equal(
			observer.getCurrentResult().isPending,
			false,
			"idle before the first submit — same as a fresh commit button",
		);

		observer.mutate({
			path: { accountId: "acc-1" },
			body: buildOrganizeInput({
				anchorMessageId: "msg-1",
				matchOperator: "And",
				literalClauses: [],
				moveMailboxId: "mbx-work",
			}),
			// Stands in for a slow POST that hasn't come back yet — the exact
			// window a double click must be blocked in.
			fetch: () => new Promise<Response>(() => {}),
		});

		assert.equal(
			observer.getCurrentResult().isPending,
			true,
			"a second click during this window must be blocked — this is what organizeJob.isStarting disables the button on",
		);
	});
});
