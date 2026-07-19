import type { ReactNode } from "react";
import { type AuthAccount, useAuthProvider } from "./provider";

export type AccountSessionValue = AuthAccount;

interface AccountSessionProps {
	children: (session: AccountSessionValue) => ReactNode;
}

/**
 * Hands the signed-in account's email and a `signOut` action to its children,
 * sourced from whichever identity provider the app was composed with. Renders
 * nothing when no session is active, so the same account affordances mount in
 * every auth mode without a surface knowing which provider is in play.
 */
export const AccountSession = ({ children }: AccountSessionProps) => {
	const { Account } = useAuthProvider();
	return <Account>{children}</Account>;
};
