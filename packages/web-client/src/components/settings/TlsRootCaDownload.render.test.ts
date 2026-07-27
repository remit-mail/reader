/**
 * React-render smoke test for `TlsRootCaDownload`: it must render only when
 * this deployment's runtime config reports TLS_MODE=internal, since every
 * other mode either has no local root CA (acme, tailscale) or serves plain
 * HTTP (off).
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { TlsRootCaDownload } from "./TlsRootCaDownload";

// See MessageToolbar.render.test.ts: the SSR test loader transpiles remit-ui
// `.tsx` (ButtonLink, here) with the classic JSX runtime, which needs a
// global `React`.
(globalThis as { React?: typeof React }).React = React;

afterEach(() => {
	globalThis.__REMIT_CONFIG__ = undefined;
});

describe("TlsRootCaDownload", () => {
	it("renders the download row when tlsMode is internal", () => {
		globalThis.__REMIT_CONFIG__ = { tlsMode: "internal" };
		const html = renderToString(createElement(TlsRootCaDownload) as never);
		assert.match(html, /TLS root certificate/);
		assert.match(html, /href="\/tls-root-ca\.crt"/);
	});

	for (const mode of ["acme", "tailscale", "off", undefined]) {
		it(`renders nothing when tlsMode is ${mode ?? "unset (default off)"}`, () => {
			globalThis.__REMIT_CONFIG__ = mode ? { tlsMode: mode } : {};
			const html = renderToString(createElement(TlsRootCaDownload) as never);
			assert.equal(html, "");
		});
	}
});
