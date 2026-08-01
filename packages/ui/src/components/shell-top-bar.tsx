/**
 * ShellTopBar — the app's one search surface and its global actions, composed.
 *
 * `AppTopBar` is geometry; this is what fills it. It spans the whole layout —
 * the nav column, the list, the reading pane and the intelligence rail — and
 * carries the actions that belong to the app rather than to whatever is
 * currently listed or open: the nav toggle, compose, bug report, settings,
 * account. Reply, delete, move and the rest stay on the reading pane's own
 * toolbar, under this bar.
 *
 * It is the app's search, not the list's: the list header drops its own field
 * wherever this bar is mounted, so exactly one search input exists on the page
 * and the "/" shortcut has one target.
 *
 * The field carries one chip: the scope of the view the user navigated into
 * (`in:spam` in Spam, nothing on the brief). Removing it goes to the brief and
 * searches everything. Typed `in:`/`from:` terms are not chipped here — they
 * are already visible as the text the user typed, and chipping them would show
 * the same term twice in one field; they render as chips over the result
 * sections instead, where the text is not repeated.
 *
 * Which actions, in what order, with what wording lives here and only here, so
 * the bar the prototype shows is the bar the app shows.
 */
import { Bug, Settings, SquarePen } from "lucide-react";
import type { ReactNode } from "react";
import { AppTopBar } from "./app-top-bar.js";
import { Button } from "./button.js";
import { NavToggleButton } from "./nav-toggle-button.js";
import { SearchBar } from "./search-bar.js";
import type { SearchChip } from "./search-chip-input.js";

/**
 * How narrowed the search already is. Only the unscoped brief may claim to
 * search all mail; a mailbox route whose name has not loaded yet is already
 * narrowed but has no chip to show, so it gets neutral wording rather than a
 * placeholder that asserts the wrong scope.
 */
export type ShellSearchScope = "global" | "pending" | "scoped";

const SEARCH_PLACEHOLDER: Record<ShellSearchScope, string> = {
	global: "Search all mail",
	pending: "Search mail",
	scoped: "Search this folder",
};

export interface ShellTopBarSearch {
	value: string;
	scope: ShellSearchScope;
	chips?: readonly SearchChip[];
	onChange: (value: string) => void;
	onClear: () => void;
	onClearQuery: () => void;
	onRemoveChip?: (id: string) => void;
}

export interface ShellTopBarProps {
	search: ShellTopBarSearch;
	onCompose: () => void;
	onReportBug: () => void;
	onOpenSettings: () => void;
	/** Key hint appended to the compose tooltip, e.g. `(c)`, from the host keymap. */
	composeShortcut?: string;
	/**
	 * The account control at the bar's trailing edge. An element rather than
	 * data: the app hangs a signed-in session and its sign-out off it.
	 */
	account: ReactNode;
	className?: string;
}

export function ShellTopBar({
	search,
	onCompose,
	onReportBug,
	onOpenSettings,
	composeShortcut,
	account,
	className,
}: ShellTopBarProps) {
	return (
		<AppTopBar
			className={className}
			leading={<NavToggleButton />}
			search={
				<SearchBar
					value={search.value}
					onChange={search.onChange}
					onClear={search.onClear}
					onClearQuery={search.onClearQuery}
					chips={search.chips}
					onRemoveChip={search.onRemoveChip}
					placeholder={SEARCH_PLACEHOLDER[search.scope]}
				/>
			}
			actions={
				<>
					<Button
						variant="ghost"
						size="sm"
						icon={<SquarePen className="size-4" />}
						title={composeShortcut ? `Compose ${composeShortcut}` : "Compose"}
						aria-label="Compose"
						onClick={onCompose}
					/>
					<Button
						variant="ghost"
						size="sm"
						icon={<Bug className="size-4" />}
						title="Report a bug"
						aria-label="Report a bug"
						onClick={onReportBug}
					/>
					<Button
						variant="ghost"
						size="sm"
						icon={<Settings className="size-4" />}
						title="Settings"
						aria-label="Settings"
						onClick={onOpenSettings}
					/>
					{account}
				</>
			}
		/>
	);
}
