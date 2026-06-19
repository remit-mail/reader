import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ConnectorTile } from "./wizard.js";

// Never-disable tenet (#798): a "coming soon" connector must stay pressable.
describe("ConnectorTile coming-soon", () => {
	const markup = (props: Parameters<typeof ConnectorTile>[0]) =>
		renderToString(createElement(ConnectorTile, props));

	it("renders a comingSoon tile that is not disabled", () => {
		const html = markup({
			name: "Gmail",
			description: "Sign in with Google.",
			icon: null,
			comingSoon: true,
		});
		assert.doesNotMatch(html, /\sdisabled[\s=>]/, "tile must not be disabled");
		assert.match(
			html,
			/aria-disabled="true"/,
			"tile signals coming-soon via aria-disabled, not a dead control",
		);
		assert.match(html, /<button/, "tile is a pressable button");
	});

	it("renders a comingSoon tile without a handler as a safe no-op", () => {
		assert.doesNotThrow(() =>
			markup({
				name: "Gmail",
				description: "Sign in with Google.",
				icon: null,
				comingSoon: true,
			}),
		);
	});

	it("renders a normal tile without coming-soon affordances", () => {
		const html = markup({
			name: "IMAP / SMTP",
			description: "Any provider.",
			icon: null,
			onSelect: () => undefined,
		});
		assert.doesNotMatch(html, /aria-disabled/);
		assert.doesNotMatch(html, />soon</);
	});
});
