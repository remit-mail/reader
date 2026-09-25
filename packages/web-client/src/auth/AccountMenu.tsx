import { AccountMenu as AccountMenuView } from "@remit/ui";
import { AccountSession } from "./AccountSession";

export const AccountMenu = () => (
	<AccountSession>
		{({ email, signOut }) => (
			<AccountMenuView email={email} onSignOut={signOut} />
		)}
	</AccountSession>
);
