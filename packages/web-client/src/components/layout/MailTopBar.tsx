/**
 * MailTopBar — the app's one search surface and its global actions.
 *
 * Mounted by the `/mail` shell over the list, the reading pane and the
 * intelligence rail, starting on the list's left edge. It is the app's search,
 * not the list's: the list header drops its own field wherever this bar is
 * mounted, so exactly one search input exists on the page and the "/" shortcut
 * has one target.
 *
 * The actions here are the ones that belong to the app rather than to whatever
 * is currently listed or open — compose, bug report, account. Reply, delete,
 * move and the rest stay on the reading pane's own toolbar, under this bar.
 *
 * The field carries one chip: the scope of the view the user navigated into
 * (`in:spam` in Spam, nothing on the brief). Removing it goes to the brief and
 * searches everything. Typed `in:`/`from:` terms are not chipped here — they
 * are already visible as the text the user typed, and chipping them would show
 * the same term twice in one field; they render as chips over the result
 * sections instead, where the text is not repeated.
 */
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { AppTopBar, Button, SearchBar } from "@remit/ui";
import { SquarePen } from "lucide-react";
import { AccountMenu } from "@/auth/AccountMenu";
import { BugReportButton } from "@/components/ui/BugReportButton";
import { useGlobalCompose } from "@/hooks/useComposeTarget";
import { useSearchScope } from "@/hooks/useSearchScope";
import { tooltipForAction } from "@/lib/keymap";
import { useMailContext } from "@/lib/mail-context";
import type { SearchScopeState } from "@/lib/search-scope";

const SEARCH_PLACEHOLDER: Record<SearchScopeState["kind"], string> = {
	global: "Search all mail",
	pending: "Search mail",
	scoped: "Search this folder",
};

interface MailTopBarProps {
	accounts: RemitImapAccountResponse[];
}

export function MailTopBar({ accounts }: MailTopBarProps) {
	const { searchInput, onSearchChange, onSearchClear, onSearchClearQuery } =
		useMailContext();
	const compose = useGlobalCompose(accounts);
	const { scope, clearScope } = useSearchScope(accounts);
	const chips =
		scope.kind === "scoped"
			? [{ id: scope.chip.id, label: scope.chip.label, tone: "scope" as const }]
			: undefined;
	// Only the brief may claim to search all mail. A mailbox route whose name has
	// not loaded yet has no chip to show but is already narrowed, so it gets the
	// neutral wording rather than a placeholder that asserts the wrong scope.
	const placeholder = SEARCH_PLACEHOLDER[scope.kind];

	return (
		<AppTopBar
			search={
				<SearchBar
					value={searchInput}
					onChange={onSearchChange}
					onClear={onSearchClear}
					onClearQuery={onSearchClearQuery}
					chips={chips}
					onRemoveChip={clearScope}
					placeholder={placeholder}
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
