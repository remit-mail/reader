/**
 * Test-time stub for `@aws-amplify/ui-react`. The real package transitively
 * imports `aws-amplify/auth` symbols (deleteUser, updatePassword, …) that
 * aren't exported by our `aws-amplify/auth` test stub — so loading it in a
 * Node test crashes at module-init time, even before any hook is called.
 *
 * This stub exposes just the surface our SPA touches:
 *
 * - `useAuthenticator(selector)` — returns a fake context with `signOut` /
 *   `authStatus` / `user`. Components that mount the hook outside the
 *   `Authenticator.Provider` would crash in production with
 *   `USE_AUTHENTICATOR_ERROR`; tests that exercise the local-dev path should
 *   never reach this fake — they gate the hook-using subcomponent on
 *   `isCognitoConfigured()`. The fake exists so tests that DO want to
 *   exercise the authenticated path can do so without spinning up the real
 *   provider.
 * - `Authenticator` / `ThemeProvider` — opaque components that just render
 *   children. The auth-flow itself is exercised via the live AuthShell
 *   tests, not here.
 */

const mocks = () => {
	globalThis.__AMPLIFY_UI_REACT_MOCKS__ =
		globalThis.__AMPLIFY_UI_REACT_MOCKS__ ?? {
			signOutCalls: 0,
			authStatus: "authenticated",
			user: { signInDetails: { loginId: "test@example.com" } },
		};
	return globalThis.__AMPLIFY_UI_REACT_MOCKS__;
};

export const useAuthenticator = (_selector) => {
	const m = mocks();
	return {
		signOut: () => {
			m.signOutCalls += 1;
		},
		authStatus: m.authStatus,
		user: m.user,
	};
};

const passthrough = ({ children }) => children ?? null;

export const Authenticator = Object.assign(passthrough, {
	Provider: passthrough,
});

export const ThemeProvider = passthrough;

export const useTheme = () => ({
	tokens: {},
});

export default { useAuthenticator, Authenticator, ThemeProvider, useTheme };
