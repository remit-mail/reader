import { Check, ChevronRight, Folder, FolderPlus, Search } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { isAbortError } from "../lib/abort.js";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";
import { FieldLabel } from "./field-label.js";
import { Input } from "./input.js";

export interface FolderTreeNode {
	/** Stable identity passed back to `onSelect`. */
	id: string;
	/**
	 * What the row reads as. An appointed folder is labelled by its role, so
	 * `Deleted Messages` shows as "Trash" while still nesting under its real
	 * path — which is why the label is not derived from the path.
	 */
	label: string;
	/** The provider path. Nesting, indentation and filtering all read this. */
	path: string;
	/**
	 * Where the messages live now. A "you are here" marker: never a target, and
	 * rendered as a marker rather than a disabled control.
	 */
	isCurrent?: boolean;
}

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
	/** Accessible label for a selectable row, e.g. `Move to X`. */
	optionLabel?: (label: string) => string;
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
	/** Marks the row. Choosing a destination advances nothing on its own. */
	onSelect: (folderId: string) => void;
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
	filterPlaceholder: "Filter folders…",
	filterAriaLabel: "Filter folders",
	treeAriaLabel: "Destination folders",
	currentSuffix: "(current folder)",
	currentTag: "current",
	contextSuffix: "(containing folder)",
	emptyMessage: (query) => `No folders match "${query}"`,
	optionLabel: (label) => `Move to ${label}`,
	newFolder: "New folder",
	newSubfolder: (label) => `New folder inside ${label}`,
	nameLabel: "Folder name",
	namePlaceholder: "Hotels",
	insideLabel: "Inside",
	topLevel: "Top level",
	create: "Create folder",
	cancel: "Cancel",
	nameRequired: "Give the folder a name.",
	createPending: "Creating folder…",
	createError: "Couldn't create that folder. Please try again.",
};

const ROW_BASE =
	"flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

const INDENT_STEP = 14;

/**
 * Where a row's text starts: `px-3` plus the chevron and folder icon columns
 * with their gaps. The hairline separator is inset to it, so the line begins
 * under the label the way a native mobile list draws it.
 */
const ROW_TEXT_INSET = 60;

const folderParent = (path: string, delimiter: string): string => {
	const cut = path.lastIndexOf(delimiter);
	return cut === -1 ? "" : path.slice(0, cut);
};

const folderDepth = (path: string, delimiter: string): number =>
	path.split(delimiter).length - 1;

const folderAncestors = (path: string, delimiter: string): string[] => {
	const out: string[] = [];
	let parent = folderParent(path, delimiter);
	while (parent) {
		out.push(parent);
		parent = folderParent(parent, delimiter);
	}
	return out;
};

/**
 * Puts every child straight after its parent so the list reads as a tree, while
 * leaving the order of unrelated folders alone. A folder whose parent is absent
 * from the list renders as a root rather than disappearing.
 */
const orderFolderNodes = (
	folders: readonly FolderTreeNode[],
	delimiter: string,
): FolderTreeNode[] => {
	const present = new Set(folders.map((folder) => folder.path));
	const emitted = new Set<string>();
	const out: FolderTreeNode[] = [];

	const emit = (folder: FolderTreeNode) => {
		if (emitted.has(folder.path)) return;
		emitted.add(folder.path);
		out.push(folder);
		for (const candidate of folders) {
			if (folderParent(candidate.path, delimiter) === folder.path) {
				emit(candidate);
			}
		}
	};

	for (const folder of folders) {
		const parent = folderParent(folder.path, delimiter);
		if (parent && present.has(parent)) continue;
		emit(folder);
	}
	return out;
};

const matchesQuery = (folder: FolderTreeNode, query: string): boolean =>
	folder.label.toLowerCase().includes(query) ||
	folder.path.toLowerCase().includes(query);

export interface FolderTreeRow {
	folder: FolderTreeNode;
	depth: number;
	/**
	 * On screen only to keep a match below it in place. It reads as the branch
	 * it is, not as an answer to what was typed.
	 */
	context: boolean;
	/** Its children and its create action are on screen. */
	expanded: boolean;
}

/**
 * The ancestors a query has to open for its matches to be on screen. Held apart
 * from what the user opened by hand, so clearing the filter puts the list back
 * the way they left it.
 */
const queryExpandedPaths = (
	folders: readonly FolderTreeNode[],
	query: string,
	delimiter: string,
): Set<string> => {
	const out = new Set<string>();
	if (!query) return out;
	for (const folder of folders) {
		if (!matchesQuery(folder, query)) continue;
		for (const ancestor of folderAncestors(folder.path, delimiter)) {
			out.add(ancestor);
		}
	}
	return out;
};

/**
 * The rows a filtered tree shows: every match, plus the ancestors holding it on
 * screen. Depth still comes from the path, so a match stays indented under the
 * branch it belongs to.
 */
const filterFolderTree = (
	ordered: readonly FolderTreeNode[],
	query: string,
	delimiter: string,
	expanded: ReadonlySet<string> = new Set(),
): FolderTreeRow[] => {
	const row = (folder: FolderTreeNode, context: boolean): FolderTreeRow => ({
		folder,
		depth: folderDepth(folder.path, delimiter),
		context,
		expanded: expanded.has(folder.path),
	});
	if (!query) return ordered.map((folder) => row(folder, false));

	const matched = new Set<string>();
	for (const folder of ordered) {
		if (matchesQuery(folder, query)) matched.add(folder.path);
	}
	const visible = new Set(matched);
	for (const path of matched) {
		for (const ancestor of folderAncestors(path, delimiter)) {
			visible.add(ancestor);
		}
	}
	return ordered
		.filter((folder) => visible.has(folder.path))
		.map((folder) => row(folder, !matched.has(folder.path)));
};

/**
 * The unfiltered list: roots always, and a child only while every ancestor it
 * has on screen is open. A folder whose parent is absent from the list is a
 * root, so it never hides behind something that was never there.
 */
const collapseFolderTree = (
	ordered: readonly FolderTreeNode[],
	expanded: ReadonlySet<string>,
	delimiter: string,
): FolderTreeRow[] => {
	const present = new Set(ordered.map((folder) => folder.path));
	return ordered
		.filter((folder) =>
			folderAncestors(folder.path, delimiter).every(
				(ancestor) => !present.has(ancestor) || expanded.has(ancestor),
			),
		)
		.map((folder) => ({
			folder,
			depth: folderDepth(folder.path, delimiter),
			context: false,
			expanded: expanded.has(folder.path),
		}));
};

export type FolderTreeDisplayRow =
	| { kind: "folder"; row: FolderTreeRow; index: number }
	| { kind: "create"; parent: FolderTreeNode; depth: number };

/**
 * Drops a create action at the end of every open folder's children, so "New
 * folder" reads as the last folder inside the one you opened.
 */
const withCreateRows = (
	rows: readonly FolderTreeRow[],
	delimiter: string,
): FolderTreeDisplayRow[] => {
	const out: FolderTreeDisplayRow[] = [];
	const open: FolderTreeRow[] = [];

	const closeDownTo = (path: string | null) => {
		while (open.length > 0) {
			const last = open[open.length - 1];
			if (!last) break;
			if (path?.startsWith(`${last.folder.path}${delimiter}`)) break;
			open.pop();
			out.push({
				kind: "create",
				parent: last.folder,
				depth: last.depth + 1,
			});
		}
	};

	rows.forEach((row, index) => {
		closeDownTo(row.folder.path);
		out.push({ kind: "folder", row, index });
		if (row.expanded) open.push(row);
	});
	closeDownTo(null);
	return out;
};

/** Every folder can hold a new one, so every row but a context row can open. */
const isFocusable = (row: FolderTreeRow | undefined): boolean =>
	row !== undefined && !row.context;

const isSelectable = (row: FolderTreeRow | undefined): boolean =>
	row !== undefined && !row.folder.isCurrent && !row.context;

const findFirstFocusable = (rows: readonly FolderTreeRow[]): number => {
	for (let i = 0; i < rows.length; i += 1) {
		if (isFocusable(rows[i])) return i;
	}
	return -1;
};

const findLastFocusable = (rows: readonly FolderTreeRow[]): number => {
	for (let i = rows.length - 1; i >= 0; i -= 1) {
		if (isFocusable(rows[i])) return i;
	}
	return -1;
};

const findNextFocusable = (
	rows: readonly FolderTreeRow[],
	from: number,
	step: 1 | -1,
): number => {
	const count = rows.length;
	if (count <= 0) return -1;
	const start = from < 0 ? (step === 1 ? -1 : count) : from;
	for (let offset = 1; offset <= count; offset += 1) {
		const candidate = (((start + step * offset) % count) + count) % count;
		if (isFocusable(rows[candidate])) return candidate;
	}
	return -1;
};

const findParentRow = (
	rows: readonly FolderTreeRow[],
	from: number,
	delimiter: string,
): number => {
	const child = rows[from];
	if (!child) return -1;
	const parent = folderParent(child.folder.path, delimiter);
	if (!parent) return -1;
	for (let i = from - 1; i >= 0; i -= 1) {
		if (rows[i]?.folder.path === parent) return isFocusable(rows[i]) ? i : -1;
	}
	return -1;
};

interface Draft {
	/** The row the form was opened from; `null` is the top-level row. */
	anchorId: string | null;
	parentPath: string;
	parentLabel: string;
}

/**
 * How loudly a create action asks to be noticed. The pinned top-level one takes
 * the kit's dashed "add" affordance; the one inside an opened folder stays
 * neutral so it reads as the last thing in that folder rather than as a rival
 * to the pinned one.
 */
type CreateProminence = "prominent" | "quiet";

const NewFolderAction = ({
	label,
	ariaLabel,
	depth,
	prominence,
	separated,
	onOpen,
}: {
	label: string;
	ariaLabel: string;
	depth: number;
	prominence: CreateProminence;
	separated: boolean;
	onOpen: () => void;
}) => (
	<div className={cn("relative", prominence === "prominent" && "p-2")}>
		<button
			type="button"
			onClick={onOpen}
			aria-label={ariaLabel}
			data-prominence={prominence}
			className={cn(
				ROW_BASE,
				"w-full active:bg-surface-sunken",
				prominence === "prominent"
					? "rounded-lg border border-line-strong border-dashed font-medium text-fg-muted hover:border-accent-2 hover:text-accent-2"
					: "text-fg-subtle hover:bg-surface-raised hover:text-fg-muted",
			)}
		>
			{depth > 0 && (
				<span
					aria-hidden="true"
					className="shrink-0"
					style={{ width: depth * INDENT_STEP }}
				/>
			)}
			<span aria-hidden="true" className="size-4 shrink-0" />
			<FolderPlus className="size-4 shrink-0" aria-hidden="true" />
			<span className="min-w-0 flex-1 truncate">{label}</span>
		</button>
		{separated && (
			<span
				aria-hidden="true"
				className="pointer-events-none absolute right-0 bottom-0 h-px bg-line"
				style={{ left: ROW_TEXT_INSET + depth * INDENT_STEP }}
			/>
		)}
	</div>
);

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
	onCreateFolder,
	onCancel,
	delimiter = "/",
	labels,
}: FolderTreePickerProps) => {
	const text = { ...defaultLabels, ...labels };
	const [query, setQuery] = useState("");
	const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
	const [draft, setDraft] = useState<Draft | null>(null);
	const [draftName, setDraftName] = useState("");
	const [draftError, setDraftError] = useState<string>();
	const [creating, setCreating] = useState(false);
	const [focusedIndex, setFocusedIndex] = useState(-1);

	const nameFieldId = useId();
	const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const nameRef = useRef<HTMLInputElement>(null);
	const formRef = useRef<HTMLDivElement>(null);
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
			if (isSelectable(row)) onSelect(row.folder.id);
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

	/**
	 * The whole form is brought into view, buttons included — focusing the field
	 * would otherwise scroll to the field alone and leave Create below the fold,
	 * under a footer or a soft keyboard.
	 */
	useEffect(() => {
		if (!draft) return;
		nameRef.current?.focus({ preventScroll: true });
		formRef.current?.scrollIntoView({ block: "nearest" });
	}, [draft]);

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
				onSelect(created.id);
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

	const draftForm = draft && (
		<div
			ref={formRef}
			className="space-y-3 border-y border-line bg-surface-sunken px-3 py-3"
		>
			<div>
				<FieldLabel htmlFor={nameFieldId}>{text.nameLabel}</FieldLabel>
				<Input
					id={nameFieldId}
					ref={nameRef}
					value={draftName}
					placeholder={text.namePlaceholder}
					onChange={(event) => {
						setDraftName(event.target.value);
						setDraftError(undefined);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							submitDraft();
						}
						if (event.key === "Escape") {
							event.preventDefault();
							closeDraft();
						}
					}}
				/>
			</div>
			<p className="text-xs text-fg-muted">
				{text.insideLabel}{" "}
				<span className="font-medium text-fg">{draft.parentLabel}</span>
			</p>
			{draftError && (
				<p className="text-xs text-danger" role="alert">
					{draftError}
				</p>
			)}
			<div className="flex items-center gap-2">
				<Button
					variant="ghost"
					size="touch"
					onClick={closeDraft}
					className="w-auto shrink-0 px-3"
				>
					{text.cancel}
				</Button>
				<Button
					variant="primary"
					size="touch"
					onClick={submitDraft}
					disabled={creating}
					className="w-auto flex-1 px-3"
				>
					{creating ? text.createPending : text.create}
				</Button>
			</div>
		</div>
	);

	const renderFolderRow = (
		row: FolderTreeRow,
		index: number,
		separated: boolean,
	) => {
		const { folder, depth } = row;
		const selectable = isSelectable(row);
		const focusable = isFocusable(row);
		const indent = depth > 0 && (
			<span
				aria-hidden="true"
				className="shrink-0"
				style={{ width: depth * INDENT_STEP }}
			/>
		);
		const chevron = (
			<ChevronRight
				className={cn(
					"size-4 shrink-0 text-fg-subtle transition-transform",
					row.expanded && "rotate-90",
				)}
				aria-hidden="true"
			/>
		);
		const icon = (
			<Folder className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
		);
		const separator = separated && (
			<span
				aria-hidden="true"
				className="pointer-events-none absolute right-0 bottom-0 h-px bg-line"
				style={{ left: ROW_TEXT_INSET + depth * INDENT_STEP }}
			/>
		);
		if (!focusable) {
			return (
				<div className="relative flex items-center">
					{/* biome-ignore lint/a11y/useFocusableInteractive: an ancestor held on screen by a match below it — a branch, not a destination */}
					<div
						role="treeitem"
						aria-level={depth + 1}
						aria-selected={false}
						aria-expanded={row.expanded}
						aria-label={`${folder.label} ${text.contextSuffix}`}
						className={cn(ROW_BASE, "opacity-60")}
					>
						{indent}
						{chevron}
						{icon}
						<span className="min-w-0 flex-1 truncate">{folder.label}</span>
					</div>
					{separator}
				</div>
			);
		}
		return (
			<div className="relative flex items-center">
				<button
					ref={(node) => {
						rowRefs.current[index] = node;
					}}
					type="button"
					role="treeitem"
					aria-level={depth + 1}
					aria-selected={selectable ? folder.id === selectedId : false}
					aria-expanded={row.expanded}
					aria-current={folder.isCurrent ? "true" : undefined}
					aria-label={
						selectable
							? text.optionLabel(folder.label)
							: `${folder.label} ${text.currentSuffix}`
					}
					tabIndex={index === focusedIndex ? 0 : -1}
					onClick={() => activateRow(row)}
					onFocus={() => setFocusedIndex(index)}
					className={cn(
						ROW_BASE,
						"hover:bg-surface-raised active:bg-surface-sunken",
						folder.isCurrent && "text-fg-muted",
					)}
				>
					{indent}
					{chevron}
					{icon}
					<span className="min-w-0 flex-1 truncate">{folder.label}</span>
					{folder.isCurrent && (
						<span className="shrink-0 text-xs text-fg-muted">
							{text.currentTag}
						</span>
					)}
					{selectable && folder.id === selectedId && (
						<Check className="size-4 shrink-0 text-accent" aria-hidden="true" />
					)}
				</button>
				{separator}
			</div>
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
				<div className="shrink-0 border-b border-line" data-create-anchor="top">
					{draft?.anchorId === null ? (
						draftForm
					) : (
						<NewFolderAction
							label={text.newFolder}
							ariaLabel={text.newFolder}
							depth={0}
							prominence="prominent"
							separated={false}
							onOpen={() => openDraft(null)}
						/>
					)}
				</div>
			)}

			{rows.length === 0 ? (
				<p className="px-3 py-3 text-sm text-fg-muted" aria-live="polite">
					{text.emptyMessage(query)}
				</p>
			) : (
				// A flattened tree: `aria-level` carries the nesting the indentation
				// shows. The row wrapper is presentational and the button itself is
				// the treeitem — a role on a wrapper around a separately-interactive
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
								{renderFolderRow(entry.row, entry.index, separated)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};

/**
 * Pure ordering, filtering, expansion and roving-focus helpers, exposed for unit
 * testing without a DOM. Consumers should use {@link FolderTreePicker}.
 */
export const folderTreePickerInternals = {
	folderParent,
	folderDepth,
	folderAncestors,
	orderFolderNodes,
	filterFolderTree,
	collapseFolderTree,
	queryExpandedPaths,
	withCreateRows,
	matchesQuery,
	isFocusable,
	isSelectable,
	findFirstFocusable,
	findLastFocusable,
	findNextFocusable,
	findParentRow,
};
