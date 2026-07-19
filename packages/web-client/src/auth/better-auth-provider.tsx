import { BetterAuthShell } from "./BetterAuthShell";
import { BetterAuthAccount } from "./better-auth/BetterAuthAccount";
import type { AuthProvider } from "./provider";

/**
 * better-auth identity (the self-host default). Amplify is never referenced
 * from this module or anything it imports, so a build that composes only this
 * provider ships no Cognito code.
 */
export const betterAuthProvider: AuthProvider = {
	configure: () => {},
	Shell: BetterAuthShell,
	Account: BetterAuthAccount,
};
