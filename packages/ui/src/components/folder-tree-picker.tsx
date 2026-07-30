import { Check, Folder, FolderPlus, Search } from "lucide-react";
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

const folderParent = (path: string, delimiter: string): string => {
	const cut = path.lastIndexOf(delimiter);
	return cut === -1 ? "" : path.slice(0, cut);
};

const folderDepth = (path: string, delimiter: string): number =>
	path.split(delimiter).length - 1;

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
}

const filterFolderTree = (
	ordered: readonly FolderTreeNode[],
	query: string,
	delimiter: string,
): FolderTreeRow[] => {
	const row = (folder: FolderTreeNode, context: boolean): FolderTreeRow => ({
		folder,
		depth: folderDepth(folder.path, delimiter),
		context,
	});
	if (!query) return ordered.map((folder) => row(folder, false));

	const matched = new Set<string>();
	for (const folder of ordered) {
		if (matchesQuery(folder, query)) matched.add(folder.path);
	}
	const visible = new Set(matched);
	for (const path of matched) {
		let parent = folderParent(path, delimiter);
		while (parent) {
			visible.add(parent);
			parent = folderParent(parent, delimiter);
		}
	}
	return ordered
		.filter((folder) => visible.has(folder.path))
		.map((folder) => row(folder, !matched.has(folder.path)));
};

const isSelectable = (row: FolderTreeRow | undefined): boolean =>
	row !== undefined && !row.folder.isCurrent && !row.context;

const findFirstSelectable = (rows: readonly FolderTreeRow[]): number => {
	for (let i = 0; i < rows.length; i += 1) {
		if (isSelectable(rows[i])) return i;
	}
	return -1;
};

const findLastSelectable = (rows: readonly FolderTreeRow[]): number => {
	for (let i = rows.length - 1; i >= 0; i -= 1) {
		if (isSelectable(rows[i])) return i;
	}
	return -1;
};

const findNextSelectable = (
	rows: readonly FolderTreeRow[],
	from: number,
	step: 1 | -1,
): number => {
	const count = rows.length;
	if (count <= 0) return -1;
	const start = from < 0 ? (step === 1 ? -1 : count) : from;
	for (let offset = 1; offset <= count; offset += 1) {
		const candidate = (((start + step * offset) % count) + count) % count;
		if (isSelectable(rows[candidate])) return candidate;
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
 * Browsable destination picker: the folders as a tree you look through and tap,
 * with a filter for narrowing a long list and folder creation in place. Data
 * stays app-shaped — the kit owns ordering, filtering, focus and the create
 * wait; the app owns labels, paths and the move itself.
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
	const [draft, setDraft] = useState<Draft | null>(null);
	const [draftName, setDraftName] = useState("");
	const [draftError, setDraftError] = useState<string>();
	const [creating, setCreating] = useState(false);
	const [focusedIndex, setFocusedIndex] = useState(-1);

	const nameFieldId = useId();
	const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const nameRef = useRef<HTMLInputElement>(null);
	const roving = useRef(false);
	const createAbort = useRef<AbortController | null>(null);
	useEffect(() => () => createAbort.current?.abort(), []);

	const trimmedQuery = query.trim().toLowerCase();
	const rows = useMemo(
		() =>
			filterFolderTree(
				orderFolderNodes(folders, delimiter),
				trimmedQuery,
				delimiter,
			),
		[folders, trimmedQuery, delimiter],
	);

	useEffect(() => {
		setFocusedIndex((current) =>
			isSelectable(rows[current]) ? current : findFirstSelectable(rows),
		);
	}, [rows]);

	useEffect(() => {
		if (!roving.current) return;
		roving.current = false;
		if (focusedIndex < 0) return;
		rowRefs.current[focusedIndex]?.focus();
	}, [focusedIndex]);

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

	useEffect(() => {
		if (draft) nameRef.current?.focus();
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
		onCreateFolder(name, draft.parentPath, controller.signal)
			.then((created) => {
				setCreating(false);
				setDraft(null);
				setDraftName("");
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
			switch (event.key) {
				case "ArrowDown":
					return move(findNextSelectable(rows, focusedIndex, 1));
				case "ArrowUp":
					return move(findNextSelectable(rows, focusedIndex, -1));
				case "Home":
					return move(findFirstSelectable(rows));
				case "End":
					return move(findLastSelectable(rows));
				case "Enter":
				case " ": {
					const target = rows[focusedIndex];
					if (!isSelectable(target) || !target) return;
					event.preventDefault();
					onSelect(target.folder.id);
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
		[rows, focusedIndex, onSelect, onCancel],
	);

	const draftForm = draft && (
		<div className="space-y-3 border-y border-line bg-surface-sunken px-3 py-3">
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

	return (
		<div className="flex min-h-0 flex-col">
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
					const first = isSelectable(rows[focusedIndex])
						? focusedIndex
						: findFirstSelectable(rows);
					if (first < 0) return;
					roving.current = true;
					setFocusedIndex(first);
					rowRefs.current[first]?.focus();
				}}
				placeholder={text.filterPlaceholder}
				aria-label={text.filterAriaLabel}
			/>

			{onCreateFolder && (
				<div className="shrink-0">
					<button
						type="button"
						onClick={() => openDraft(null)}
						className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-accent-2 hover:bg-surface-raised"
					>
						<FolderPlus className="size-4 shrink-0" aria-hidden="true" />
						{text.newFolder}
					</button>
					{draft?.anchorId === null && draftForm}
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
					className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
					onKeyDown={handleTreeKeyDown}
				>
					{rows.map((row, index) => {
						const { folder, depth } = row;
						const selectable = isSelectable(row);
						const indent = depth > 0 && (
							<span
								aria-hidden="true"
								className="shrink-0"
								style={{ width: depth * INDENT_STEP }}
							/>
						);
						const icon = (
							<Folder
								className="size-4 shrink-0 text-fg-subtle"
								aria-hidden="true"
							/>
						);
						return (
							<div key={folder.id} role="none">
								<div className="flex items-center">
									{selectable ? (
										<button
											ref={(node) => {
												rowRefs.current[index] = node;
											}}
											type="button"
											role="treeitem"
											aria-level={depth + 1}
											aria-selected={folder.id === selectedId}
											aria-label={text.optionLabel(folder.label)}
											tabIndex={index === focusedIndex ? 0 : -1}
											onClick={() => onSelect(folder.id)}
											onFocus={() => setFocusedIndex(index)}
											className={cn(ROW_BASE, "hover:bg-surface-raised")}
										>
											{indent}
											{icon}
											<span className="min-w-0 flex-1 truncate">
												{folder.label}
											</span>
											{folder.id === selectedId && (
												<Check
													className="size-4 shrink-0 text-accent"
													aria-hidden="true"
												/>
											)}
										</button>
									) : (
										// biome-ignore lint/a11y/useFocusableInteractive: a marker row, not a destination — focus belongs to the selectable rows
										<div
											role="treeitem"
											aria-level={depth + 1}
											aria-selected={false}
											aria-current={folder.isCurrent ? "true" : undefined}
											aria-label={`${folder.label} ${
												folder.isCurrent
													? text.currentSuffix
													: text.contextSuffix
											}`}
											className={cn(ROW_BASE, "opacity-60")}
										>
											{indent}
											{icon}
											<span className="min-w-0 flex-1 truncate">
												{folder.label}
											</span>
											{folder.isCurrent && (
												<span className="shrink-0 text-xs text-fg-muted">
													{text.currentTag}
												</span>
											)}
										</div>
									)}
									{onCreateFolder && (
										<button
											type="button"
											onClick={() => openDraft(folder)}
											aria-label={text.newSubfolder(folder.label)}
											title={text.newSubfolder(folder.label)}
											className="flex size-11 shrink-0 items-center justify-center text-fg-subtle hover:bg-surface-raised hover:text-fg"
										>
											<FolderPlus className="size-4" aria-hidden="true" />
										</button>
									)}
								</div>
								{draft?.anchorId === folder.id && draftForm}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};

/**
 * Pure ordering, filtering and roving-focus helpers, exposed for unit testing
 * without a DOM. Consumers should use {@link FolderTreePicker}.
 */
export const folderTreePickerInternals = {
	folderParent,
	folderDepth,
	orderFolderNodes,
	filterFolderTree,
	matchesQuery,
	findFirstSelectable,
	findLastSelectable,
	findNextSelectable,
};
