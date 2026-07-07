import { useAuthenticator } from "@aws-amplify/ui-react";
import type { ReactNode } from "react";
import { accountMenuMode } from "./account-menu-mode";
import { isCognitoConfigured } from "./amplify-config";
import {
	authClient,
	isBetterAuthEnabled,
	resetBetterAuthTokenCache,
} from "./better-auth-config";
import { isSignOutVisible } from "./sign-out-visibility";

export interface AccountSessionValue {
	email: string | null;
	signOut: () => void;
}

interface AccountSessionProps {
	children: (session: AccountSessionValue) => ReactNode;
}

const cognitoUserEmail = (
	user: { signInDetails?: { loginId?: string }; username?: string } | undefined,
): string | null => {
	if (!user) return null;
	return user.signInDetails?.loginId ?? user.username ?? null;
};

const CognitoAccountSession = ({ children }: AccountSessionProps) => {
	const { authStatus, signOut, user } = useAuthenticator((ctx) => [
		ctx.authStatus,
		ctx.signOut,
		ctx.user,
	]);

	if (!isSignOutVisible({ configured: true, authStatus })) {
		return null;
	}

	return (
		<>{children({ email: cognitoUserEmail(user), signOut: () => signOut() })}</>
	);
};

const BetterAuthAccountSession = ({ children }: AccountSessionProps) => {
	const { data: session } = authClient.useSession();

	if (!session) {
		return null;
	}

	const signOut = async () => {
		await authClient.signOut();
		resetBetterAuthTokenCache();
	};

	return <>{children({ email: session.user.email ?? null, signOut })}</>;
};

/**
 * Resolves the active identity provider (better-auth or Cognito) and hands the
 * signed-in account's email and a `signOut` action to its children. Renders
 * nothing when no provider is configured or no session is active, so the same
 * account affordances mount in every auth mode without leaking provider-specific
 * hooks into the surfaces that use them.
 */
export const AccountSession = ({ children }: AccountSessionProps) => {
	const mode = accountMenuMode({
		betterAuthEnabled: isBetterAuthEnabled(),
		cognitoConfigured: isCognitoConfigured(),
	});

	if (mode === "betterAuth") {
		return <BetterAuthAccountSession>{children}</BetterAuthAccountSession>;
	}
	if (mode === "cognito") {
		return <CognitoAccountSession>{children}</CognitoAccountSession>;
	}
	return null;
};
