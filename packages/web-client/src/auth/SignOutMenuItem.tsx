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

export const SignOutMenuItem = ({
	variant = "dropdown",
	showEmail = false,
	className,
}: SignOutMenuItemProps) => {
	const { authStatus, signOut, user } = useAuthenticator((ctx) => [
		ctx.authStatus,
		ctx.signOut,
		ctx.user,
	]);

	if (!isSignOutVisible({ configured: isCognitoConfigured(), authStatus })) {
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
