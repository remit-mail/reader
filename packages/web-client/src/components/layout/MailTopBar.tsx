/**
 * MailTopBar — the `/mail` shell's top bar, wired to the app.
 *
 * The bar itself is `ShellTopBar` in the kit. This supplies what the kit cannot
 * know: the search scope the route carries, the app's routes, its keymap and
 * its signed-in session. Which actions the bar carries, in what order and with
 * what wording is not decided here.
 */
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { ShellTopBar } from "@remit/ui";
import { useNavigate } from "@tanstack/react-router";
import { AccountMenu } from "@/auth/AccountMenu";
import { useGlobalCompose } from "@/hooks/useComposeTarget";
import { useSearchScope } from "@/hooks/useSearchScope";
import { openBugReport } from "@/lib/bug-report";
import { tooltipForAction } from "@/lib/keymap";
import { useMailContext } from "@/lib/mail-context";

interface MailTopBarProps {
	accounts: RemitImapAccountResponse[];
}

export function MailTopBar({ accounts }: MailTopBarProps) {
	const { searchInput, onSearchChange, onSearchClear, onSearchClearQuery } =
		useMailContext();
	const navigate = useNavigate();
	const compose = useGlobalCompose(accounts);
	const { scope, clearScope } = useSearchScope(accounts);
	const chips =
		scope.kind === "scoped"
			? [{ id: scope.chip.id, label: scope.chip.label, tone: "scope" as const }]
			: undefined;

	return (
		<ShellTopBar
			search={{
				value: searchInput,
				scope: scope.kind,
				chips,
				onChange: onSearchChange,
				onClear: onSearchClear,
				onClearQuery: onSearchClearQuery,
				onRemoveChip: clearScope,
			}}
			onCompose={compose}
			onReportBug={openBugReport}
			onOpenSettings={() => navigate({ to: "/settings/accounts" })}
			composeShortcut={tooltipForAction("compose")}
			account={<AccountMenu />}
		/>
	);
}
