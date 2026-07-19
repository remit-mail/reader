import { createContext, type FC, type ReactNode, useContext } from "react";

/**
 * The auth-integration seam. A deployment composes the web client against
 * exactly one provider — the identity system it runs — and never ships the
 * others. `mountApp` receives the chosen provider and publishes it here; the
 * app shell and every screen read it through `useAuthProvider`, so no surface
 * imports a specific identity system directly.
 */
export interface AuthAccount {
	email: string | null;
	signOut: () => void | Promise<void>;
}

export interface AuthAccountProps {
	children: (account: AuthAccount) => ReactNode;
	/** Rendered when no session is active. Defaults to nothing. */
	fallback?: ReactNode;
}

export interface AuthProvider {
	/** Called once at boot, before render, to initialize the identity SDK. */
	configure(): void;
	/** The sign-in gate: renders children only once a session is established. */
	Shell: FC<{ children: ReactNode }>;
	/**
	 * Render-prop over the active session's identity and sign-out action.
	 * Renders `fallback` when no session is active.
	 */
	Account: FC<AuthAccountProps>;
}

const Passthrough: FC<{ children?: ReactNode }> = ({ children }) => (
	<>{children}</>
);

/**
 * The zero-identity provider. It has no session and no identity SDK, so a
 * surface that renders without a mounted provider (an isolated component
 * render, a harness) degrades to "signed out" instead of crashing.
 */
export const noneAuthProvider: AuthProvider = {
	configure: () => {},
	Shell: Passthrough,
	Account: ({ fallback = null }) => <>{fallback}</>,
};

const AuthProviderContext = createContext<AuthProvider>(noneAuthProvider);

export const AuthProviderProvider = AuthProviderContext.Provider;

export const useAuthProvider = (): AuthProvider =>
	useContext(AuthProviderContext);
