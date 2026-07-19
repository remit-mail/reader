/**
 * React-render smoke test for `MessageBodyErrorBanner`. Pure helpers are
 * covered by `MessageBodyErrorBanner.test.ts`; this file proves the component
 * itself renders without crashing in the two surfaces that matter:
 *
 *  1. local-dev (no Cognito, no `Authenticator.Provider` in scope) — the
 *     previous version of this component called `useAuthenticator` at the
 *     top of render, which throws `USE_AUTHENTICATOR_ERROR` outside the
 *     provider and would crash the whole MessageBody subtree on the first
 *     body-fetch failure. The fix gates the hook-using subcomponent behind
 *     `isCognitoConfigured()`. This test pins that behaviour.
 *  2. body-missing variant — no sign-in CTA regardless of config, so it
 *     should also render fine without the provider.
 *
 * Uses `react-dom/server`'s `renderToString` so the assertion runs without
 * pulling in jsdom/happy-dom (no new deps).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { BodyFetchError } from "@/hooks/useMessageBodyContent";
import { MessageBodyErrorBanner } from "./MessageBodyErrorBanner";

const renderBanner = (error: unknown, onRetry?: () => void): string =>
	renderToString(
		createElement(MessageBodyErrorBanner, { error, onRetry }) as never,
	);

/**
 * The sign-in CTA is rendered as a `<button>` whose text is "Sign in again".
 * The string "Sign in again" also appears as the prefix of the auth-variant
 * detail copy, so the assertion must look for the BUTTON tag specifically,
 * not the bare substring.
 */
const hasSignInButton = (html: string): boolean =>
	/<button\b[^>]*>Sign in again<\/button>/.test(html);

describe("MessageBodyErrorBanner renders without an Authenticator.Provider in scope (#401 review)", () => {
	it("renders the body-missing variant without throwing — local-dev / production both reach this branch", () => {
		const html = renderBanner(
			new BodyFetchError("body-missing", "missing", 403),
		);
		assert.match(html, /Message body is missing in storage/);
		assert.match(html, /data-reason="body-missing"/);
		assert.equal(
			hasSignInButton(html),
			false,
			"sign-in CTA must not appear for body-missing — only the auth variant",
		);
	});

	it("renders the auth variant in local-dev WITHOUT mounting the sign-in CTA — `useAuthenticator` would throw outside `Authenticator.Provider` and crash the subtree", () => {
		// Default test env: `globalThis.__REMIT_CONFIG__` is unset, so
		// `isCognitoConfigured()` returns false — same shape as `AuthShell`
		// running without the provider. If `MessageBodyErrorBanner` calls
		// `useAuthenticator` unconditionally again, this `renderToString`
		// call throws.
		const html = renderBanner(
			new BodyFetchError("auth", "Invalid id_token", 401),
		);
		assert.match(html, /Your session expired/);
		assert.match(html, /data-reason="auth"/);
		assert.equal(
			hasSignInButton(html),
			false,
			"sign-in CTA must be suppressed when Cognito is not configured (no Authenticator.Provider in the tree) — pre-fix regression: the button rendered and `useAuthenticator` crashed at render",
		);
	});

	it("renders the generic variant for unknown errors without crashing", () => {
		const html = renderBanner(new Error("network down"));
		assert.match(html, /Couldn.+t load message body/);
		assert.match(html, /network down/);
	});

	it("renders a Retry button when onRetry is supplied (every variant)", () => {
		const html = renderBanner(
			new BodyFetchError("body-missing", "missing", 403),
			() => undefined,
		);
		assert.match(html, /<button\b[^>]*>Retry<\/button>/);
	});
});
