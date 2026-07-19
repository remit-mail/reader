import { useAuthenticator } from "@aws-amplify/ui-react";
import { isCognitoConfigured } from "../amplify-config";
import type { AuthAccountProps } from "../provider";
import { isSignOutVisible } from "../sign-out-visibility";

const cognitoUserEmail = (
	user: { signInDetails?: { loginId?: string }; username?: string } | undefined,
): string | null => {
	if (!user) return null;
	return user.signInDetails?.loginId ?? user.username ?? null;
};

const CognitoAccountInner = ({
	children,
	fallback = null,
}: AuthAccountProps) => {
	const { authStatus, signOut, user } = useAuthenticator((ctx) => [
		ctx.authStatus,
		ctx.signOut,
		ctx.user,
	]);

	if (!isSignOutVisible({ configured: true, authStatus })) {
		return <>{fallback}</>;
	}

	return (
		<>{children({ email: cognitoUserEmail(user), signOut: () => signOut() })}</>
	);
};

/**
 * Cognito identity for the account affordances. `useAuthenticator` throws when
 * called outside `Authenticator.Provider`, which `CognitoShell` only mounts
 * once Cognito is configured — so the hook-using inner is gated on that,
 * constant for the app's lifetime, keeping the Rules of Hooks intact.
 */
export const CognitoAccount = ({
	children,
	fallback = null,
}: AuthAccountProps) => {
	if (!isCognitoConfigured()) {
		return <>{fallback}</>;
	}
	return (
		<CognitoAccountInner fallback={fallback}>{children}</CognitoAccountInner>
	);
};
