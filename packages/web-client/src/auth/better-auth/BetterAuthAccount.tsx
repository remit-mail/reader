import { authClient, resetBetterAuthTokenCache } from "../better-auth-config";
import type { AuthAccountProps } from "../provider";

/**
 * better-auth identity for the account affordances. Reads the active session
 * from its session hook; signing out also clears the cached bearer token so a
 * stale token never rides a post-sign-out request.
 */
export const BetterAuthAccount = ({
	children,
	fallback = null,
}: AuthAccountProps) => {
	const { data: session } = authClient.useSession();

	if (!session) {
		return <>{fallback}</>;
	}

	const signOut = async () => {
		await authClient.signOut();
		resetBetterAuthTokenCache();
	};

	return <>{children({ email: session.user.email ?? null, signOut })}</>;
};
