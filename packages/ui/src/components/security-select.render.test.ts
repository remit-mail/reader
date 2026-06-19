import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SecuritySelect, securityToApi } from "./security-select.js";

describe("securityToApi", () => {
	it("maps tls to { tls: true, startTls: false }", () => {
		assert.deepEqual(securityToApi("tls"), { tls: true, startTls: false });
	});

	it("maps starttls to { tls: false, startTls: true }", () => {
		assert.deepEqual(securityToApi("starttls"), {
			tls: false,
			startTls: true,
		});
	});

	it("maps none to { tls: false, startTls: false }", () => {
		assert.deepEqual(securityToApi("none"), { tls: false, startTls: false });
	});
});

describe("SecuritySelect", () => {
	it("renders all three security options", () => {
		const html = renderToString(
			createElement(SecuritySelect, { defaultValue: "tls" }),
		);
		assert.match(html, /TLS\/SSL/);
		assert.match(html, /STARTTLS/);
		assert.match(html, /None \(insecure\)/);
	});
});
