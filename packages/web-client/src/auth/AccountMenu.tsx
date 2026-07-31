import { Avatar } from "@remit/ui";
import { LogOut } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@/components/ui/DropdownMenu";
import { AccountSession } from "./AccountSession";

interface AccountMenuViewProps {
	email: string | null;
	onSignOut: () => void;
}

const AccountMenuView = ({ email, onSignOut }: AccountMenuViewProps) => {
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
			<DropdownMenuItem onClick={onSignOut}>
				<LogOut className="size-4" />
				Sign out
			</DropdownMenuItem>
		</DropdownMenu>
	);
};

export const AccountMenu = () => (
	<AccountSession>
		{({ email, signOut }) => (
			<AccountMenuView email={email} onSignOut={signOut} />
		)}
	</AccountSession>
);
