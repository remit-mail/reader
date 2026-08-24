/**
 * MailTopBar — the `/mail` shell's top bar, wired to the app.
 *
 * The bar itself is `ShellTopBar` in the kit. This supplies what the kit cannot
 * know: the search scope the route carries, the app's routes, its keymap and
 * its signed-in session. Which actions the bar carries, in what order and with
 * what wording is not decided here.
 */
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { RefreshButton, ShellTopBar, shortcutHintForAction } from "@remit/ui";
import { useMemo } from "react";
import { AccountMenu } from "@/auth/AccountMenu";
import { useRefreshControl } from "@/hooks/useRefreshControl";
import { useSearchScope } from "@/hooks/useSearchScope";
import { openBugReport } from "@/lib/bug-report";
import { useMailContext } from "@/lib/mail-context";
import { useMailFreshness } from "@/lib/mail-freshness";
import { useGoToSection, useOpenCompose } from "@/routing";

interface MailTopBarProps {
	accounts: RemitImapAccountResponse[];
}

export function MailTopBar({ accounts }: MailTopBarProps) {
	const { searchInput, onSearchChange, onSearchClear, onSearchClearQuery } =
		useMailContext();
	const goToSection = useGoToSection();
	const compose = useOpenCompose();
	const { scope, clearScope } = useSearchScope(accounts);
	const chips =
		scope.kind === "scoped"
			? [{ id: scope.chip.id, label: scope.chip.label, tone: "scope" as const }]
			: undefined;

	// Every connected account — the global refresh's whole point, distinct from
	// the account-scoped controls on the inbox and brief headers.
	const allAccountIds = useMemo(
		() => accounts.map((account) => account.accountId),
		[accounts],
	);
	const { hasNewMail } = useMailFreshness();
	const {
		state: refreshState,
		errorMessage: refreshError,
		refresh,
	} = useRefreshControl(allAccountIds);

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
			onOpenSettings={() => goToSection("accounts")}
			composeShortcut={shortcutHintForAction("compose")}
			refreshControl={
				<RefreshButton
					state={refreshState}
					onRefresh={refresh}
					label="Refresh all accounts"
					errorMessage={refreshError}
					hasUpdate={hasNewMail(allAccountIds)}
				/>
			}
			account={<AccountMenu />}
		/>
	);
}
