import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { AuthFooter } from "./auth-footer.js";

describe("AuthFooter", () => {
	it("renders the default Cognito note", () => {
		const html = renderToString(AuthFooter());
		assert.match(html, /Secure sign-in powered by AWS Cognito/);
	});

	it("renders a custom note", () => {
		const html = renderToString(AuthFooter({ note: "Custom" }));
		assert.match(html, /Custom/);
	});
});
