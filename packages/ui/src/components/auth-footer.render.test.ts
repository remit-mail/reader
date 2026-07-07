import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { AuthFooter } from "./auth-footer.js";

describe("AuthFooter", () => {
	it("renders a provider-neutral note by default", () => {
		const html = renderToString(AuthFooter());
		assert.match(html, /Secure sign-in/);
		assert.doesNotMatch(html, /Cognito/);
	});

	it("renders a custom note", () => {
		const html = renderToString(AuthFooter({ note: "Custom" }));
		assert.match(html, /Custom/);
	});
});
