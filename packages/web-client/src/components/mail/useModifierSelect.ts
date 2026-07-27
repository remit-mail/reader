/**
 * Modifier-click selection for a message row, shared by every row shape.
 *
 * Selection on modifiers is not gated on the layout tier. `isDesktop` is a media
 * query at 1024px: it says how the app is laid out, not what is driving it.
 * While the modifiers were read only on the desktop tier, every narrower window
 * — a half-screen browser, a tablet — fell through to the touch branch, which
 * never looks at them, and shift, cmd and ctrl click all just opened the
 * message. A modifier can only come from a real keyboard, so a row honours it at
 * every width; a tap carries none and is unaffected.
 *
 * The press, not the click, is where a modified click is taken. A mailbox row is
 * an `<a href>`, and a modified click on an anchor is a browser gesture: shift
 * opens a new window, cmd a new tab, ctrl raises the context menu. WebKit
 * commits to that gesture from the press, so a `click` handler calling
 * `preventDefault` is already too late there. `claimClick` still handles the
 * click for engines that deliver it that way.
 */
import { type MouseEvent, useCallback, useRef } from "react";
import type { SelectionModifiers } from "@/hooks/useSelection";

export const modifiersOf = (e: MouseEvent): SelectionModifiers => ({
	shiftKey: e.shiftKey,
	metaKey: e.metaKey,
	ctrlKey: e.ctrlKey,
});

export const isModified = (m: SelectionModifiers): boolean =>
	m.shiftKey || m.metaKey || m.ctrlKey;

export interface ModifierSelect {
	/** Takes a modified press for selection before the browser acts on it. */
	onMouseDown: (e: MouseEvent<HTMLElement>) => void;
	/**
	 * Suppresses the context menu macOS raises from a ctrl-click the press
	 * already spent on selection. A plain right-click keeps its menu.
	 */
	onContextMenu: (e: MouseEvent) => void;
	/**
	 * True when the click belongs to a modified gesture selection has taken, in
	 * which case it is already consumed and the row must not open.
	 */
	claimClick: (e: MouseEvent) => boolean;
}

const consume = (e: MouseEvent): void => {
	e.preventDefault();
	e.stopPropagation();
};

export const useModifierSelect = (
	messageId: string,
	onRowSelect?: (messageId: string, modifiers: SelectionModifiers) => boolean,
): ModifierSelect => {
	// Set while a modified press has already been handed to selection, so the
	// click the same gesture still delivers cannot open the row on top of it.
	const claimedRef = useRef(false);

	const onMouseDown = useCallback(
		(e: MouseEvent<HTMLElement>) => {
			claimedRef.current = false;
			// Only the primary button; a right-click keeps its context menu.
			if (e.button !== 0) return;
			const modifiers = modifiersOf(e);
			if (!isModified(modifiers)) return;
			// The browser's own default is only worth taking once selection has
			// actually taken the press. On a row without selection, cmd-click still
			// opens a new tab.
			if (!onRowSelect?.(messageId, modifiers)) return;
			consume(e);
			claimedRef.current = true;
			// Preventing the press also drops the focus it would have moved, so put
			// it back: the roving cursor follows the row the user clicked, and it is
			// the origin a later shift-click ranges from.
			e.currentTarget.focus();
			// Shift-click otherwise drags a native text selection across the rows it
			// spans — the row highlight is the selection the user asked for.
			if (modifiers.shiftKey) window.getSelection()?.removeAllRanges();
		},
		[onRowSelect, messageId],
	);

	const onContextMenu = useCallback(
		(e: MouseEvent) => {
			if (!e.ctrlKey || !onRowSelect) return;
			e.preventDefault();
		},
		[onRowSelect],
	);

	const claimClick = useCallback(
		(e: MouseEvent): boolean => {
			if (claimedRef.current) {
				claimedRef.current = false;
				consume(e);
				return true;
			}
			const modifiers = modifiersOf(e);
			if (!isModified(modifiers)) return false;
			if (!onRowSelect?.(messageId, modifiers)) return false;
			consume(e);
			if (modifiers.shiftKey) window.getSelection()?.removeAllRanges();
			return true;
		},
		[onRowSelect, messageId],
	);

	return { onMouseDown, onContextMenu, claimClick };
};
