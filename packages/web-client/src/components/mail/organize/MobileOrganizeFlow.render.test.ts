import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ErrorBannerProvider } from "@/components/ui/ErrorBannerProvider";
import type { OrganizeEntry } from "@/lib/organize/mobile-organize-flow";
import { MobileOrganizeFlow } from "./MobileOrganizeFlow";

// The node test loader transpiles remit-ui's `.tsx` with the classic JSX
// runtime, which references a global `React`. Vite uses the automatic runtime,
// so this shim only exists for the SSR test harness.
(globalThis as { React?: typeof React }).React = React;

const render = (entry: OrganizeEntry) =>
	renderToString(
		createElement(
			QueryClientProvider,
			{ client: new QueryClient() },
			createElement(
				ErrorBannerProvider,
				null,
				createElement(MobileOrganizeFlow, {
					entry,
					accountId: "acc-1",
					mailboxId: "mbx-inbox",
					selectedMessageIds: ["msg-1", "msg-2"],
					onClose: () => undefined,
				}),
			),
		) as never,
	);

describe("MobileOrganizeFlow", () => {
	it("select-similar opens on the widening state before the preview resolves", () => {
		const html = render("select-similar");
		assert.match(html, /Finding similar messages/);
	});

	it("something-else opens on the shortcuts + plain-language input", () => {
		const html = render("something-else");
		assert.match(html, /What should Remit do\?/);
		assert.match(html, /Tell Remit what to do/);
	});
});
