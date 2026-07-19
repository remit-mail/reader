import { BetterAuthShell } from "./BetterAuthShell";
import { BetterAuthAccount } from "./better-auth/BetterAuthAccount";
import {
	fetchBetterAuthToken,
	resetBetterAuthTokenCache,
} from "./better-auth-config";
import type { AuthProvider } from "./provider";

/**
 * better-auth identity (the self-host default). Amplify is never referenced
 * from this module or anything it imports, so a build that composes only this
 * provider ships no Cognito code.
 */
export const betterAuthProvider: AuthProvider = {
	configure: () => {},
	getToken: fetchBetterAuthToken,
	resetToken: resetBetterAuthTokenCache,
	Shell: BetterAuthShell,
	Account: BetterAuthAccount,
};
