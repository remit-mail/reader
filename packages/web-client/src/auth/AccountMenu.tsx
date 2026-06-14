import { useAuthenticator } from "@aws-amplify/ui-react";
import { Avatar } from "@remit/ui";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, Settings } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@/components/ui/DropdownMenu";
import { isCognitoConfigured } from "./amplify-config";
import { isSignOutVisible } from "./sign-out-visibility";

const userEmail = (
	user: { signInDetails?: { loginId?: string }; username?: string } | undefined,
): string | null => {
	if (!user) return null;
	return user.signInDetails?.loginId ?? user.username ?? null;
};

const AccountMenuInner = () => {
	const { authStatus, signOut, user } = useAuthenticator((ctx) => [
		ctx.authStatus,
		ctx.signOut,
		ctx.user,
	]);
	const navigate = useNavigate();

	if (!isSignOutVisible({ configured: true, authStatus })) {
		return null;
	}

	const email = userEmail(user);
	const displayName = email ?? "Account";

	return (
		<DropdownMenu
			trigger={
				<Avatar name={displayName} email={email ?? undefined} size="sm" />
			}
			align="right"
		>
			{email && (
				<>
					<div
						className="px-3 py-2 text-xs text-fg-muted truncate"
						title={email}
						data-testid="account-menu-email"
					>
						{email}
					</div>
					<DropdownMenuSeparator />
				</>
			)}
			<DropdownMenuItem onClick={() => navigate({ to: "/settings/accounts" })}>
				<Settings className="size-4" />
				Settings
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem onClick={() => signOut()}>
				<LogOut className="size-4" />
				Sign out
			</DropdownMenuItem>
		</DropdownMenu>
	);
};

export const AccountMenu = () => {
	if (!isCognitoConfigured()) {
		return null;
	}
	return <AccountMenuInner />;
};
