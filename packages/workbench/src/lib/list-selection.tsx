import {
	Button,
	keyboardHintsFor,
	type MessageListKeyboard,
	type MessageListSelection,
	SelectionTopBar,
	type ThreadSection,
	type TriageHandlers,
	useAppShellLayout,
	useListCursor,
	type useSelection,
	useTriageKeyboard,
	type Verb,
} from "@remit/ui";
import { Menu } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

export interface ListTriage {
	selection: ReturnType<typeof useSelection>;
	/** The rows as the verbs have left them. */
	sections: ThreadSection[];
	paneSelection: MessageListSelection;
	/** The cursor the keys move, and the keys the footer may offer. */
	paneKeyboard: MessageListKeyboard;
	allSelected: boolean;
	toggleAll: () => void;
	trashSelected: () => void;
	markSelectedRead: () => void;
}

export interface ListTriageOptions {
	/** Rows ticked on mount, for a story whose subject is a selection. */
	initialSelectedIds?: string[];
	/** Seeds the cursor — the open thread, as in the app. */
	initialFocusedId?: string;
	/** False below 1024px, where a ticked row means touch multi-select. */
	isDesktop?: boolean;
}

/**
 * The list as the app drives it: the kit's cursor and selection model under the
 * kit's keyboard dispatcher, with the verbs acting on fixtures. j/k, x, Space,
 * Shift+j/k, Shift+arrow and ⌘A reach the same handlers here as they reach in
 * the app, so a reviewer pressing them in Storybook is reviewing the shipped
 * interaction.
 */
export function useListTriage(
	sections: ThreadSection[],
	{
		initialSelectedIds,
		initialFocusedId,
		isDesktop = true,
	}: ListTriageOptions = {},
): ListTriage {
	const [trashedIds, setTrashedIds] = useState<ReadonlySet<string>>(new Set());
	const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set());

	const visible = useMemo(
		() =>
			trashedIds.size === 0 && readIds.size === 0
				? sections
				: sections.map((section) => ({
						...section,
						threads: section.threads
							.filter((thread) => !trashedIds.has(thread.id))
							.map((thread) =>
								readIds.has(thread.id) ? { ...thread, isRead: true } : thread,
							),
					})),
		[sections, trashedIds, readIds],
	);

	const orderedIds = useMemo(
		() => visible.flatMap((section) => section.threads).map((t) => t.id),
		[visible],
	);

	const cursor = useListCursor({
		orderedIds,
		isDesktop,
		initialFocusedId,
		initialSelectedIds,
	});
	const { selection, handleRowSelect } = cursor;
	const { selectedIds, toggle, clearSelection } = selection;

	const handlers: TriageHandlers = {
		focusNext: cursor.focusNext,
		focusPrevious: cursor.focusPrevious,
		focusFirst: cursor.focusFirst,
		focusLast: cursor.focusLast,
		toggleSelect: cursor.toggleFocusedSelection,
		extendSelectDown: cursor.extendRangeDown,
		extendSelectUp: cursor.extendRangeUp,
		selectAll: cursor.selectAllLoaded,
		back: cursor.exitSelection,
	};
	useTriageKeyboard({ handlers });

	// A row that leaves the list — an account pill, a chip, a completed verb —
	// cannot stay selected. The same rule the app runs in
	// `ThreadListInteraction`.
	const { intersectWith } = selection;
	useEffect(() => {
		intersectWith(orderedIds);
	}, [intersectWith, orderedIds]);

	const paneSelection = useMemo<MessageListSelection>(
		() => ({
			selectedIds,
			onToggle: toggle,
			onRowSelect: handleRowSelect,
		}),
		[selectedIds, toggle, handleRowSelect],
	);

	const runVerb = (record: (ids: ReadonlySet<string>) => void) => {
		record(selectedIds);
		clearSelection();
	};

	return {
		selection,
		sections: visible,
		paneSelection,
		paneKeyboard: {
			focusedId: cursor.focusedMessageId,
			hints: keyboardHintsFor(handlers),
		},
		allSelected:
			orderedIds.length > 0 && orderedIds.every((id) => selectedIds.has(id)),
		toggleAll: () => selection.toggleAll(orderedIds),
		trashSelected: () =>
			runVerb((ids) => setTrashedIds((prev) => new Set([...prev, ...ids]))),
		markSelectedRead: () =>
			runVerb((ids) => setReadIds((prev) => new Set([...prev, ...ids]))),
	};
}

/**
 * The list header for every state of the list: the view's name while nothing
 * is ticked, the count and the verbs from the first ticked row.
 */
export function ListSelectionBar({
	triage,
	title,
	titleMeta,
	searchSlot,
	searchField,
	idleSlot,
	onVerb,
}: {
	triage: ListTriage;
	title: string;
	titleMeta?: ReactNode;
	searchSlot?: ReactNode;
	searchField?: ReactNode;
	idleSlot?: ReactNode;
	/**
	 * Hands every verb to the caller instead of running it on the list — the
	 * door the selection wizard opens from. Absent, the bar deletes and marks
	 * read itself and offers no destination it cannot resolve.
	 */
	onVerb?: (verb: Verb, selected: ReadonlySet<string>) => void;
}) {
	const { selection } = triage;
	const raise = (verb: Verb) =>
		onVerb ? () => onVerb(verb, selection.selectedIds) : undefined;
	return (
		<SelectionTopBar
			title={title}
			count={selection.selectedCount}
			onCancel={selection.clearSelection}
			onDelete={raise("delete") ?? triage.trashSelected}
			onMarkRead={raise("markRead") ?? triage.markSelectedRead}
			onMove={raise("move")}
			onOrganize={raise("organize")}
			onJunk={raise("junk")}
			navSlot={<PaneNavButton />}
			titleMeta={titleMeta}
			searchSlot={searchSlot}
			searchField={searchField}
			idleSlot={idleSlot}
			selectAll={{
				checked: triage.allSelected,
				indeterminate: selection.hasSelection && !triage.allSelected,
				onChange: triage.toggleAll,
			}}
		/>
	);
}

/** The hamburger the list header carries where the nav is a slide-over. */
export function PaneNavButton() {
	const layout = useAppShellLayout();
	if (!layout || layout.showNavPane) return null;
	return (
		<Button
			variant="ghost"
			size="touch"
			icon={<Menu className="size-5" />}
			onClick={() => layout.openNav()}
			aria-label="Menu"
			className="-ml-2 shrink-0"
		/>
	);
}
