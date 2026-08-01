import {
	Button,
	type MessageListSelection,
	rowSelectIntent,
	SelectionTopBar,
	type ThreadSection,
	useAppShellLayout,
	useSelection,
	type Verb,
} from "@remit/ui";
import { Menu } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

export interface ListTriage {
	selection: ReturnType<typeof useSelection>;
	/** The rows as the verbs have left them. */
	sections: ThreadSection[];
	paneSelection: MessageListSelection;
	allSelected: boolean;
	toggleAll: () => void;
	trashSelected: () => void;
	markSelectedRead: () => void;
}

export function useListTriage(
	sections: ThreadSection[],
	initialSelectedIds?: string[],
): ListTriage {
	const selection = useSelection({ initialSelectedIds });
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

	const { selectedIds, toggle, selectRange, clearSelection, setAnchor } =
		selection;

	const paneSelection = useMemo<MessageListSelection>(
		() => ({
			selectedIds,
			onToggle: toggle,
			onRowSelect: (id, modifiers) => {
				const intent = rowSelectIntent(modifiers);
				if (intent === "range") {
					selectRange(orderedIds, id);
					return true;
				}
				if (intent === "toggle") {
					toggle(id);
					return true;
				}
				clearSelection();
				setAnchor(id);
				return false;
			},
		}),
		[selectedIds, toggle, selectRange, clearSelection, setAnchor, orderedIds],
	);

	const runVerb = (record: (ids: ReadonlySet<string>) => void) => {
		record(selectedIds);
		clearSelection();
	};

	return {
		selection,
		sections: visible,
		paneSelection,
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
