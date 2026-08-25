/**
 * The pane-level interaction layer: the bridge between a mounted list and the
 * global keyboard dispatcher, plus next/previous adjacency.
 *
 * The list publishes `MessageListCommands` into `listCommandsRef` and reports
 * its cursor and selection through `onTriageContextChange`; the keyboard hook
 * registers the navigation and selection keys only while a list is serving
 * them, so with no list mounted Enter, Space and ⌘A stay with the browser.
 *
 * This lived inside `MailboxPane`, which is why the brief and Flagged had a
 * keyboard hint bar and no keyboard (#149). Every pane mounts it now.
 *
 * It is two hooks because a pane's verbs are aimed at the focused row: the
 * context comes first, the pane builds its handlers from it, and the keyboard
 * registration comes last.
 *
 * While a thread is open, `ConversationView` binds its own window listener for
 * the messages inside it, and both used to act on one press (#723). The split
 * is the one `shortcut-tree` already declares: the cursor keys belong to
 * whichever surface has a list on screen, and answering a thread belongs to
 * the open thread — so `hasOpenThread` hands r, a and f over, and the list
 * keeps j/k, Home/End and Enter for as long as it is mounted.
 */
import { type TriageHandlers, useTriageKeyboard } from "@remit/ui";
import { type RefObject, useCallback, useRef, useState } from "react";
import type { MessageListCommands } from "@/components/mail/MessageList";
import { adjacentMessageId } from "@/lib/adjacent-message";

export interface TriageContextUpdate {
	focusedMessageId: string | undefined;
	selectedIds: string[];
	hasList: boolean;
	blocksKeyboard: boolean;
	/** Row ids in display order, when the list knows them. Feeds adjacency. */
	orderedIds?: string[];
}

export interface TriageContext {
	listCommandsRef: RefObject<MessageListCommands | null>;
	onTriageContextChange: (context: TriageContextUpdate) => void;
	/** The list's roving cursor — where a verb with no selection is aimed. */
	focusedMessageId: string | undefined;
	/** The list's checkbox set — what a verb targets when it is non-empty. */
	selectedIds: string[];
	/** Row ids in display order, as last reported by the list. */
	orderedIds: string[];
	hasList: boolean;
	blocksKeyboard: boolean;
}

export const useTriageContext = (): TriageContext => {
	const [focusedMessageId, setFocusedMessageId] = useState<string | undefined>(
		undefined,
	);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [orderedIds, setOrderedIds] = useState<string[]>([]);
	// Null whenever no list is mounted (reading-only phone view, drafts) — the
	// keyboard layer then simply has nothing to drive.
	const listCommandsRef = useRef<MessageListCommands | null>(null);
	const [hasList, setHasList] = useState(false);
	const [blocksKeyboard, setBlocksKeyboard] = useState(false);

	const onTriageContextChange = useCallback((context: TriageContextUpdate) => {
		setFocusedMessageId(context.focusedMessageId);
		setSelectedIds(context.selectedIds);
		if (context.orderedIds) setOrderedIds(context.orderedIds);
		setHasList(context.hasList);
		setBlocksKeyboard(context.blocksKeyboard);
	}, []);

	return {
		listCommandsRef,
		onTriageContextChange,
		focusedMessageId,
		selectedIds,
		orderedIds,
		hasList,
		blocksKeyboard,
	};
};

interface UseTriageLayerOptions {
	context: TriageContext;
	/** Message ids in display order — the adjacency source for next/previous. */
	orderedIds: string[];
	selectedMessageId: string | undefined;
	/** Suspend the whole layer (e.g. a compose surface owns the keyboard). */
	enabled?: boolean;
	/** Close the open thread. Runs only when there is no selection to unwind. */
	onClose: () => void;
	/** The pane's own verbs — reply, star, delete and the rest. */
	handlers: TriageHandlers;
	/**
	 * A thread is open, so `ConversationView` is mounted and answers for it.
	 * This layer drops the three verbs aimed at a whole message — `reply`,
	 * `replyAll` and `forward` — while that is true, so one press opens one
	 * reply (#723) and `a` can never answer a different message than `r` just
	 * did. The cursor keys are not in here: a mounted list keeps those at every
	 * width, and it is the conversation that stands down from them wherever the
	 * list is on screen beside it (`ConversationView.listOnScreen`).
	 */
	hasOpenThread?: boolean;
}

export interface TriageLayer {
	/** Esc: unwinds the selection first, then the open thread. */
	goBack: () => void;
	nextMessageId: string | undefined;
	previousMessageId: string | undefined;
}

export const useTriageLayer = ({
	context,
	orderedIds,
	selectedMessageId,
	enabled = true,
	onClose,
	handlers,
	hasOpenThread = false,
}: UseTriageLayerOptions): TriageLayer => {
	const { listCommandsRef, hasList, blocksKeyboard } = context;

	const goBack = useCallback(() => {
		if (listCommandsRef.current?.clearSelection()) return;
		if (selectedMessageId) onClose();
	}, [listCommandsRef, selectedMessageId, onClose]);

	// Dropped rather than kept and guarded: an unregistered action is never
	// preventDefault-ed (see useTriageKeyboard), so the keystroke falls through
	// to ConversationView's own listener instead of two handlers racing on one
	// keypress.
	const { reply, replyAll, forward, ...restHandlers } = handlers;

	useTriageKeyboard({
		// A modal owns the keyboard outright. Suspending the layer is what keeps a
		// second Delete press from reaching a delete while the confirmation for the
		// first one is still on screen.
		enabled: enabled && !blocksKeyboard,
		handlers: {
			// Registered only while a list is mounted to serve them. An unregistered
			// action is never preventDefault-ed, so with no list the browser keeps
			// Enter, Space and ⌘A — select-all-text in the reading pane still works.
			...(hasList
				? {
						focusNext: () => listCommandsRef.current?.focusNext(),
						focusPrevious: () => listCommandsRef.current?.focusPrevious(),
						focusFirst: () => listCommandsRef.current?.focusFirst(),
						focusLast: () => listCommandsRef.current?.focusLast(),
						openFocused: () => listCommandsRef.current?.openFocused(),
						toggleSelect: () => listCommandsRef.current?.toggleSelect(),
						extendSelectDown: () => listCommandsRef.current?.extendSelectDown(),
						extendSelectUp: () => listCommandsRef.current?.extendSelectUp(),
						selectAll: () => listCommandsRef.current?.selectAll(),
						toggleDensity: () => listCommandsRef.current?.toggleDensity(),
					}
				: {}),
			back: goBack,
			...restHandlers,
			...(hasOpenThread ? {} : { reply, replyAll, forward }),
		},
	});

	return {
		goBack,
		nextMessageId:
			adjacentMessageId(orderedIds, selectedMessageId, "next") ?? undefined,
		previousMessageId:
			adjacentMessageId(orderedIds, selectedMessageId, "previous") ?? undefined,
	};
};
