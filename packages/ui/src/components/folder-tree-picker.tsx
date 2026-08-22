import { Search } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { isAbortError } from "../lib/abort.js";
import {
	collapseFolderTree,
	type FolderTreeDisplayRow,
	type FolderTreeNode,
	type FolderTreeRow,
	filterFolderTree,
	folderAncestors,
	orderFolderNodes,
	queryExpandedPaths,
	withCreateRows,
} from "../lib/folder-tree.js";
import {
	findFirstFocusable,
	findLastFocusable,
	findNextFocusable,
	findParentRow,
	isFocusable,
	isSelectable,
} from "../lib/folder-tree-focus.js";
import { FolderRow } from "./folder-row.js";
import { Input } from "./input.js";
import { NewFolderAction } from "./new-folder-action.js";
import {
	defaultNewFolderFormLabels,
	NewFolderForm,
} from "./new-folder-form.js";

export type {
	FolderTreeDisplayRow,
	FolderTreeNode,
	FolderTreeRow,
} from "../lib/folder-tree.js";

export interface FolderTreePickerLabels {
	filterPlaceholder?: string;
	filterAriaLabel?: string;
	treeAriaLabel?: string;
	/** Suffix announced for the current folder, e.g. `(current folder)`. */
	currentSuffix?: string;
	/** Inline tag shown on the current folder row. */
	currentTag?: string;
	/** Suffix announced for an ancestor held on screen by a match below it. */
	contextSuffix?: string;
	emptyMessage?: (query: string) => string;
	/** Shown when there is no folder to list at all, filter or no filter. */
	noFolders?: string;
	/**
	 * Accessible label for a selectable row. Takes the folder rather than its
	 * label, so a surface can announce the message count as part of the name
	 * instead of leaving it as decoration beside it.
	 */
	optionLabel?: (folder: FolderTreeNode) => string;
	newFolder?: string;
	newSubfolder?: (label: string) => string;
	nameLabel?: string;
	namePlaceholder?: string;
	insideLabel?: string;
	topLevel?: string;
	create?: string;
	cancel?: string;
	nameRequired?: string;
	createPending?: string;
	createError?: string;
}

export interface FolderTreePickerProps {
	/** Destinations as the app has them — labelled, and pathed by the provider. */
	folders: readonly FolderTreeNode[];
	/** The destination chosen so far. */
	selectedId?: string;
	/**
	 * Marks the row. Choosing a destination advances nothing on its own. Absent
	 * means the tree is browsed rather than chosen from, and a row does nothing
	 * beyond opening and closing.
	 */
	onSelect?: (folderId: string) => void;
	/** Controls beside each row, for a surface that acts on folders themselves. */
	rowActions?: (folder: FolderTreeNode) => ReactNode;
	/**
	 * Creating a folder is an IMAP mutation, so this resolves only once the mail
	 * server confirms the folder (docs/architecture/imap-mutations.md). The form
	 * holds the wait, refuses a second submit while it runs, states a failure
	 * where it happened, and aborts the signal on unmount so a late confirmation
	 * never selects a folder into a surface that is gone. Absent means no create
	 * affordance renders.
	 */
	onCreateFolder?: (
		name: string,
		parentPath: string,
		signal?: AbortSignal,
	) => Promise<FolderTreeNode>;
	/** Escape. The picker never owns its presentation, so it cannot close itself. */
	onCancel?: () => void;
	/** The provider's hierarchy separator. */
	delimiter?: string;
	labels?: FolderTreePickerLabels;
}

const defaultLabels: Required<FolderTreePickerLabels> = {
	...defaultNewFolderFormLabels,
	filterPlaceholder: "Filter folders…",
	filterAriaLabel: "Filter folders",
	treeAriaLabel: "Destination folders",
	currentSuffix: "(current folder)",
	currentTag: "current",
	contextSuffix: "(containing folder)",
	emptyMessage: (query) => `No folders match "${query}"`,
	noFolders: "No folders to show",
	optionLabel: (folder) => `Move to ${folder.label}`,
	newFolder: "New folder",
	newSubfolder: (label) => `New folder inside ${label}`,
	topLevel: "Top level",
	nameRequired: "Give the folder a name.",
	createError: "Couldn't create that folder. Please try again.",
};

interface Draft {
	/** The row the form was opened from; `null` is the top-level row. */
	anchorId: string | null;
	parentPath: string;
	parentLabel: string;
}

/**
 * Browsable destination picker: the folders as a tree that starts at its top
 * level, opens a folder where you tap it, and makes a new folder wherever you
 * are looking. Data stays app-shaped — the kit owns ordering, filtering, focus
 * and the create wait; the app owns labels, paths and the move itself.
 */
export const FolderTreePicker = ({
	folders,
	selectedId,
	onSelect,
	rowActions,
	onCreateFolder,
	onCancel,
	delimiter = "/",
	labels,
}: FolderTreePickerProps) => {
	const text = { ...defaultLabels, ...labels };
	const [query, setQuery] = useState("");
	// A destination chosen before the picker opened is out of reach behind its
	// ancestors, so the branch holding it starts open and the choice is on screen.
	const [opened, setOpened] = useState<ReadonlySet<string>>(() => {
		const selected = folders.find((folder) => folder.id === selectedId);
		return new Set(selected ? folderAncestors(selected.path, delimiter) : []);
	});
	const [draft, setDraft] = useState<Draft | null>(null);
	const [draftName, setDraftName] = useState("");
	const [draftError, setDraftError] = useState<string>();
	const [creating, setCreating] = useState(false);
	const [focusedIndex, setFocusedIndex] = useState(-1);

	const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const roving = useRef(false);
	const createAbort = useRef<AbortController | null>(null);
	useEffect(() => () => createAbort.current?.abort(), []);

	const trimmedQuery = query.trim().toLowerCase();
	const ordered = useMemo(
		() => orderFolderNodes(folders, delimiter),
		[folders, delimiter],
	);

	const expanded = useMemo(() => {
		const auto = queryExpandedPaths(ordered, trimmedQuery, delimiter);
		if (auto.size === 0) return opened;
		return new Set([...opened, ...auto]);
	}, [ordered, opened, trimmedQuery, delimiter]);

	const rows = useMemo(
		() =>
			trimmedQuery
				? filterFolderTree(ordered, trimmedQuery, delimiter, expanded)
				: collapseFolderTree(ordered, expanded, delimiter),
		[ordered, trimmedQuery, delimiter, expanded],
	);

	const displayRows = useMemo(
		() => (onCreateFolder ? withCreateRows(rows, delimiter) : undefined),
		[rows, delimiter, onCreateFolder],
	);

	useEffect(() => {
		setFocusedIndex((current) =>
			isFocusable(rows[current]) ? current : findFirstFocusable(rows),
		);
	}, [rows]);

	useEffect(() => {
		if (!roving.current) return;
		roving.current = false;
		if (focusedIndex < 0) return;
		rowRefs.current[focusedIndex]?.focus();
	}, [focusedIndex]);

	/**
	 * One open branch: opening a folder closes every folder that is not an
	 * ancestor of it, so the list never grows past what a phone screen holds.
	 * Its ancestors stay open because otherwise it could not be on screen.
	 */
	const setExpanded = useCallback(
		(path: string, open: boolean) => {
			setOpened((current) => {
				if (open) return new Set([...folderAncestors(path, delimiter), path]);
				const next = new Set(current);
				next.delete(path);
				return next;
			});
		},
		[delimiter],
	);

	const activateRow = useCallback(
		(row: FolderTreeRow) => {
			if (isSelectable(row)) onSelect?.(row.folder.id);
			setExpanded(row.folder.path, !row.expanded);
		},
		[onSelect, setExpanded],
	);

	const closeDraft = useCallback(() => {
		createAbort.current?.abort();
		setDraft(null);
		setDraftName("");
		setDraftError(undefined);
		setCreating(false);
	}, []);

	const openDraft = useCallback(
		(anchor: FolderTreeNode | null) => {
			createAbort.current?.abort();
			setDraft({
				anchorId: anchor?.id ?? null,
				parentPath: anchor?.path ?? "",
				parentLabel: anchor?.label ?? text.topLevel,
			});
			setDraftName("");
			setDraftError(undefined);
			setCreating(false);
		},
		[text.topLevel],
	);

	const submitDraft = useCallback(() => {
		if (!onCreateFolder || !draft || creating) return;
		const name = draftName.trim();
		if (name === "") {
			setDraftError(text.nameRequired);
			return;
		}
		setCreating(true);
		setDraftError(undefined);
		createAbort.current?.abort();
		const controller = new AbortController();
		createAbort.current = controller;
		const parentPath = draft.parentPath;
		onCreateFolder(name, parentPath, controller.signal)
			.then((created) => {
				setCreating(false);
				setDraft(null);
				setDraftName("");
				if (parentPath) setExpanded(parentPath, true);
				onSelect?.(created.id);
			})
			.catch((error: unknown) => {
				if (isAbortError(error)) return;
				setDraftError(
					error instanceof Error ? error.message : text.createError,
				);
				setCreating(false);
			});
	}, [
		onCreateFolder,
		draft,
		creating,
		draftName,
		onSelect,
		setExpanded,
		text.nameRequired,
		text.createError,
	]);

	const handleTreeKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLElement>) => {
			// The create form sits inside the tree, so what is typed into its name
			// field reaches here too. Only a row's own keys move the tree.
			const source = event.target;
			if (!(source instanceof Element)) return;
			if (!source.closest('[role="treeitem"]')) return;
			const move = (next: number) => {
				event.preventDefault();
				roving.current = true;
				setFocusedIndex(next);
			};
			const focused = rows[focusedIndex];
			switch (event.key) {
				case "ArrowDown":
					return move(findNextFocusable(rows, focusedIndex, 1));
				case "ArrowUp":
					return move(findNextFocusable(rows, focusedIndex, -1));
				case "Home":
					return move(findFirstFocusable(rows));
				case "End":
					return move(findLastFocusable(rows));
				case "ArrowRight": {
					if (!isFocusable(focused) || !focused) return;
					event.preventDefault();
					if (!focused.expanded) {
						setExpanded(focused.folder.path, true);
						return;
					}
					const next = focusedIndex + 1;
					if (isFocusable(rows[next])) move(next);
					return;
				}
				case "ArrowLeft": {
					if (!isFocusable(focused) || !focused) return;
					event.preventDefault();
					if (focused.expanded) {
						setExpanded(focused.folder.path, false);
						return;
					}
					const parent = findParentRow(rows, focusedIndex, delimiter);
					if (parent >= 0) move(parent);
					return;
				}
				case "Enter":
				case " ": {
					if (!isFocusable(focused) || !focused) return;
					event.preventDefault();
					activateRow(focused);
					return;
				}
				case "Escape":
					event.preventDefault();
					onCancel?.();
					return;
				default:
					return;
			}
		},
		[rows, focusedIndex, delimiter, activateRow, setExpanded, onCancel],
	);

	const draftAnchorOnScreen =
		draft !== null &&
		draft.anchorId !== null &&
		(displayRows?.some(
			(entry) => entry.kind === "create" && entry.parent.id === draft.anchorId,
		) ??
			false);

	const draftForm = draft && (
		<NewFolderForm
			parentLabel={draft.parentLabel}
			name={draftName}
			onNameChange={(value) => {
				setDraftName(value);
				setDraftError(undefined);
			}}
			onSubmit={submitDraft}
			onCancel={closeDraft}
			pending={creating}
			error={draftError}
			labels={text}
		/>
	);

	const rowAriaLabel = (row: FolderTreeRow): string => {
		if (row.context) return `${row.folder.label} ${text.contextSuffix}`;
		if (isSelectable(row)) return text.optionLabel(row.folder);
		return `${row.folder.label} ${text.currentSuffix}`;
	};

	const folderRow = (row: FolderTreeRow, index: number, separated: boolean) => {
		const { folder, depth } = row;
		const selectable = isSelectable(row);
		return (
			<FolderRow
				ref={(node) => {
					rowRefs.current[index] = node;
				}}
				label={folder.label}
				depth={depth}
				expanded={row.expanded}
				context={row.context}
				current={folder.isCurrent}
				currentTag={text.currentTag}
				messageCount={folder.messageCount}
				selected={selectable && folder.id === selectedId}
				separated={separated}
				actions={rowActions?.(folder)}
				ariaLabel={rowAriaLabel(row)}
				tabIndex={index === focusedIndex ? 0 : -1}
				onActivate={() => activateRow(row)}
				onFocus={() => setFocusedIndex(index)}
			/>
		);
	};

	return (
		<div className="flex min-h-0 w-full min-w-0 flex-col">
			<Input
				variant="inline"
				className="border-b border-line px-3 py-2"
				icon={<Search className="size-4" aria-hidden="true" />}
				type="search"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						onCancel?.();
						return;
					}
					if (event.key !== "ArrowDown") return;
					event.preventDefault();
					const first = isFocusable(rows[focusedIndex])
						? focusedIndex
						: findFirstFocusable(rows);
					if (first < 0) return;
					roving.current = true;
					setFocusedIndex(first);
					rowRefs.current[first]?.focus();
				}}
				placeholder={text.filterPlaceholder}
				aria-label={text.filterAriaLabel}
			/>

			{onCreateFolder && (
				// Closing or filtering away the folder a draft was opened in leaves
				// the form here instead of unmounting it mid-type or mid-create.
				<div className="shrink-0 border-b border-line" data-create-anchor="top">
					{draft && !draftAnchorOnScreen ? (
						draftForm
					) : (
						<NewFolderAction
							label={text.newFolder}
							ariaLabel={text.newFolder}
							prominence="prominent"
							onOpen={() => openDraft(null)}
						/>
					)}
				</div>
			)}

			{rows.length === 0 ? (
				<p className="px-3 py-3 text-sm text-fg-muted" aria-live="polite">
					{folders.length === 0 ? text.noFolders : text.emptyMessage(query)}
				</p>
			) : (
				// A flattened tree: `aria-level` carries the nesting the indentation
				// shows. The row wrapper is presentational and the row itself is the
				// treeitem — a role on a wrapper around a separately-interactive
				// button is invalid ARIA.
				<div
					role="tree"
					aria-label={text.treeAriaLabel}
					className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-24"
					onKeyDown={handleTreeKeyDown}
				>
					{(
						displayRows ??
						rows.map(
							(row, index): FolderTreeDisplayRow => ({
								kind: "folder",
								row,
								index,
							}),
						)
					).map((entry, position, all) => {
						const separated = position < all.length - 1;
						if (entry.kind === "create") {
							return (
								<div
									key={`new:${entry.parent.id}`}
									role="none"
									data-create-anchor={entry.parent.id}
								>
									{draft?.anchorId === entry.parent.id ? (
										draftForm
									) : (
										<NewFolderAction
											label={text.newFolder}
											ariaLabel={text.newSubfolder(entry.parent.label)}
											depth={entry.depth}
											prominence="quiet"
											separated={separated}
											onOpen={() => openDraft(entry.parent)}
										/>
									)}
								</div>
							);
						}
						return (
							<div key={entry.row.folder.id} role="none">
								{folderRow(entry.row, entry.index, separated)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};
