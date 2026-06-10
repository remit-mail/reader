import { useAuthenticator } from "@aws-amplify/ui-react";
import { LogOut } from "lucide-react";
import { cn } from "../lib/utils";
import { isCognitoConfigured } from "./amplify-config";
import { isSignOutVisible } from "./sign-out-visibility";

export { isSignOutVisible } from "./sign-out-visibility";

interface SignOutMenuItemProps {
	variant?: "dropdown" | "drawer";
	showEmail?: boolean;
	className?: string;
}

const userEmail = (
	user: { signInDetails?: { loginId?: string }; username?: string } | undefined,
): string | null => {
	if (!user) return null;
	return user.signInDetails?.loginId ?? user.username ?? null;
};

/**
 * The hook-using inner component. Mounted only when Cognito is configured
 * (see the wrapper below), so `useAuthenticator` always runs inside the
 * `Authenticator.Provider` that `AuthShell` mounts in the configured path.
 */
const SignOutMenuItemInner = ({
	variant = "dropdown",
	showEmail = false,
	className,
}: SignOutMenuItemProps) => {
	const { authStatus, signOut, user } = useAuthenticator((ctx) => [
		ctx.authStatus,
		ctx.signOut,
		ctx.user,
	]);

	if (!isSignOutVisible({ configured: true, authStatus })) {
		return null;
	}

	const email = showEmail ? userEmail(user) : null;

	const baseClass =
		variant === "drawer"
			? "flex items-center gap-2 px-3 py-2 rounded-md text-sm w-full text-left text-fg-muted hover:bg-surface-raised hover:text-fg min-h-11"
			: "flex items-center gap-2 px-3 py-2 text-sm w-full text-left hover:bg-surface-raised";

	return (
		<>
			{email ? (
				<div
					className="px-3 py-2 text-xs text-fg-muted truncate"
					title={email}
					data-testid="sign-out-email"
				>
					{email}
				</div>
			) : null}
			<div className="border-t border-line my-1" />
			<button
				type="button"
				onClick={() => signOut()}
				className={cn(baseClass, className)}
				data-testid="sign-out-button"
			>
				<LogOut className="size-4" />
				Sign out
			</button>
		</>
	);
};

/**
 * Sign-out affordance. Safe to mount anywhere — including the desktop
 * sidebar footer (#422), which renders outside any conditional gate.
 *
 * When Cognito is not configured (local dev / e2e / visual harness),
 * `AuthShell` does NOT mount `Authenticator.Provider`, so calling
 * `useAuthenticator` would throw. We therefore gate the hook-using inner
 * component on `isCognitoConfigured()` — an env-derived value that is
 * constant for the lifetime of the app, so this branch never changes
 * between renders and the Rules of Hooks are upheld.
 */
export const SignOutMenuItem = (props: SignOutMenuItemProps) => {
	if (!isCognitoConfigured()) {
		return null;
	}
	return <SignOutMenuItemInner {...props} />;
};
