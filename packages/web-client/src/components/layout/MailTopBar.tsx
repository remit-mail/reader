/**
 * MailTopBar — the app's one search surface and its global actions.
 *
 * Mounted above every pane by the `/mail` shell, so the field spans the nav,
 * the list and the reading pane. It is the app's search, not the list's: the
 * list header drops its own field wherever this bar is mounted, so exactly one
 * search input exists on the page and the "/" shortcut has one target.
 *
 * The actions here are the ones that belong to the app rather than to whatever
 * is currently listed or open — compose, bug report, account. Reply, delete,
 * move and the rest stay on the reading pane's own toolbar, under this bar.
 */
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { AppTopBar, Button, SearchBar } from "@remit/ui";
import { SquarePen } from "lucide-react";
import { AccountMenu } from "@/auth/AccountMenu";
import { BugReportButton } from "@/components/ui/BugReportButton";
import { useGlobalCompose } from "@/hooks/useComposeTarget";
import { tooltipForAction } from "@/lib/keymap";
import { useMailContext } from "@/lib/mail-context";

interface MailTopBarProps {
	accounts: RemitImapAccountResponse[];
}

export function MailTopBar({ accounts }: MailTopBarProps) {
	const { searchInput, onSearchChange, onSearchClear, onSearchClearQuery } =
		useMailContext();
	const compose = useGlobalCompose(accounts);

	return (
		<AppTopBar
			leading={
				<span className="px-1 text-sm font-semibold tracking-tight text-fg">
					remit
				</span>
			}
			search={
				<SearchBar
					value={searchInput}
					onChange={onSearchChange}
					onClear={onSearchClear}
					onClearQuery={onSearchClearQuery}
					placeholder="Search all mail"
					size="lg"
				/>
			}
			actions={
				<>
					<Button
						variant="ghost"
						size="sm"
						icon={<SquarePen className="size-4" />}
						title={`Compose ${tooltipForAction("compose")}`}
						aria-label="Compose"
						onClick={compose}
					/>
					<BugReportButton />
					<AccountMenu />
				</>
			}
		/>
	);
}
