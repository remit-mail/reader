/**
 * React-render smoke test for `DeleteAccountDialog`.
 *
 * `DangerZone` mounts this dialog unconditionally on the settings/accounts
 * route. The previous version called `useAuthenticator` at the top of render,
 * which throws `USE_AUTHENTICATOR_ERROR` when no `Authenticator.Provider` is
 * in scope. In local-dev / e2e / the visual harness (`isCognitoConfigured()`
 * === false) `AuthShell` mounts NO provider, so the whole settings/accounts
 * route crashed into the fatal-error escalate page (#745 surfaced this, #741).
 *
 * The fix gates the hook-using inner component behind `isCognitoConfigured()`.
 * This test pins that: rendering the dialog without a provider must not throw.
 *
 * Uses `react-dom/server`'s `renderToString` so the assertion runs without
 * pulling in jsdom/happy-dom (no new deps).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DeleteAccountDialog } from "./DeleteAccountDialog";

const renderDialog = (open: boolean): string =>
	renderToString(
		createElement(
			QueryClientProvider,
			{ client: new QueryClient() },
			createElement(DeleteAccountDialog, {
				open,
				onClose: () => undefined,
			}),
		) as never,
	);

describe("DeleteAccountDialog renders without an Authenticator.Provider in scope (#741)", () => {
	it("mounts WITHOUT calling `useAuthenticator` outside `Authenticator.Provider` — the hook would throw and crash the settings/accounts route into the fatal-error escalate page", () => {
		// Default test env: `isCognitoConfigured()` returns false — same shape as
		// `AuthShell` running without the provider. The dialog's hooks
		// (`useAuthenticator`, `useState`, `useMutation`) all run on mount,
		// before the `open` gate, so rendering it closed still exercises the
		// gated path. Pre-fix, `useAuthenticator` ran unconditionally here and
		// `renderToString` threw `USE_AUTHENTICATOR_ERROR`.
		assert.doesNotThrow(() => renderDialog(false));
	});
});
