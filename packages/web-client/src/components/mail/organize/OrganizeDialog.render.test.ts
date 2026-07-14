import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { OrganizeDialog } from "./OrganizeDialog";

// The node test loader transpiles remit-ui's `.tsx` with the classic JSX
// runtime, which references a global `React`. Vite uses the automatic runtime,
// so this shim only exists for the SSR test harness.
(globalThis as { React?: typeof React }).React = React;

const render = (open: boolean) =>
	renderToString(
		createElement(
			QueryClientProvider,
			{ client: new QueryClient() },
			createElement(OrganizeDialog, {
				open,
				accountId: "acc-1",
				mailboxId: "mbx-inbox",
				selectedMessageIds: ["msg-1", "msg-2"],
				onClose: () => undefined,
			}),
		) as never,
	);

describe("OrganizeDialog", () => {
	it("renders nothing when closed", () => {
		assert.equal(render(false), "");
	});

	it("shows the widen step while the preview is in flight", () => {
		const html = render(true);
		assert.match(html, /Finding similar messages/);
	});
});
