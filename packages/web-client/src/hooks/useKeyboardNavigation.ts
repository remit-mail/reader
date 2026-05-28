import { useCallback, useEffect } from "react";

type KeyHandler = (event: KeyboardEvent) => void;

interface KeyBinding {
	key: string;
	handler: KeyHandler;
	/** If true, only trigger when no modifier keys are pressed */
	noModifiers?: boolean;
	/**
	 * Shift requirement. `undefined` (default) ignores shift. `true` requires
	 * shift to be held; `false` requires it to be absent. Use this to bind a
	 * plain key and its shift-variant to different handlers (e.g. ArrowDown vs
	 * Shift+ArrowDown) without them firing each other.
	 */
	requireShift?: boolean;
	/**
	 * Meta/Ctrl requirement. `undefined` (default) follows `noModifiers`.
	 * `true` requires Cmd (mac) or Ctrl to be held — used for Cmd/Ctrl+A.
	 */
	requireMeta?: boolean;
	/** If true, prevent default browser behavior */
	preventDefault?: boolean;
	/**
	 * If true, stop the event from reaching any other keydown listener once
	 * this binding handles it (calls stopPropagation + stopImmediatePropagation).
	 * Combine with `capture` to win precedence over other window-level
	 * listeners on the same keypress (e.g. Esc clearing a selection must
	 * pre-empt a route-level Esc that would also navigate).
	 */
	stopPropagation?: boolean;
}

interface UseKeyboardNavigationOptions {
	/** Whether the keyboard navigation is enabled */
	enabled?: boolean;
	/** Key bindings to register */
	bindings: KeyBinding[];
	/**
	 * Register the listener on the capture phase instead of the bubble phase.
	 * A capture-phase listener runs before bubble-phase listeners on the same
	 * target, so paired with a binding's `stopPropagation` it can consume a key
	 * before other handlers see it.
	 */
	capture?: boolean;
}

/**
 * Hook for handling keyboard navigation.
 * Registers global keyboard event listeners and calls handlers for matching keys.
 */
export const useKeyboardNavigation = ({
	enabled = true,
	bindings,
	capture = false,
}: UseKeyboardNavigationOptions) => {
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			// Skip if focus is in an input/textarea
			const target = event.target as HTMLElement;
			if (
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.isContentEditable
			) {
				return;
			}

			for (const binding of bindings) {
				const keyMatches =
					event.key.toLowerCase() === binding.key.toLowerCase();
				if (!keyMatches) continue;

				// Shift gate: when a binding pins shift on/off, it only matches that
				// exact state so plain and shift variants stay distinct.
				if (
					binding.requireShift !== undefined &&
					binding.requireShift !== event.shiftKey
				) {
					continue;
				}

				const metaHeld = event.ctrlKey || event.metaKey;

				// Meta gate: requireMeta bindings (Cmd/Ctrl+A) need meta/ctrl held.
				if (binding.requireMeta !== undefined) {
					if (binding.requireMeta !== metaHeld) continue;
				} else {
					const noModifiersRequired = binding.noModifiers ?? true;
					// Treat shift as a modifier for the no-modifier guard only when
					// the binding hasn't opted into an explicit shift requirement.
					const hasModifiers =
						metaHeld ||
						event.altKey ||
						(binding.requireShift === undefined && event.shiftKey);
					if (noModifiersRequired && hasModifiers) continue;
				}

				if (binding.preventDefault) {
					event.preventDefault();
				}
				if (binding.stopPropagation) {
					event.stopPropagation();
					event.stopImmediatePropagation();
				}
				binding.handler(event);
				return;
			}
		},
		[bindings],
	);

	useEffect(() => {
		if (!enabled) return;

		window.addEventListener("keydown", handleKeyDown, capture);
		return () => window.removeEventListener("keydown", handleKeyDown, capture);
	}, [enabled, handleKeyDown, capture]);
};

/**
 * Simple hook for list navigation with j/k keys.
 */
export const useListNavigation = <T extends { id: string }>({
	items,
	selectedId,
	onSelect,
	enabled = true,
}: {
	items: T[];
	selectedId: string | undefined;
	onSelect: (id: string) => void;
	enabled?: boolean;
}) => {
	const currentIndex = selectedId
		? items.findIndex((item) => item.id === selectedId)
		: -1;

	const selectNext = useCallback(() => {
		if (items.length === 0) return;
		const nextIndex =
			currentIndex < items.length - 1 ? currentIndex + 1 : currentIndex;
		if (nextIndex >= 0 && nextIndex < items.length) {
			onSelect(items[nextIndex].id);
		}
	}, [items, currentIndex, onSelect]);

	const selectPrevious = useCallback(() => {
		if (items.length === 0) return;
		const prevIndex = currentIndex > 0 ? currentIndex - 1 : 0;
		if (prevIndex >= 0 && prevIndex < items.length) {
			onSelect(items[prevIndex].id);
		}
	}, [items, currentIndex, onSelect]);

	const selectFirst = useCallback(() => {
		if (items.length > 0) {
			onSelect(items[0].id);
		}
	}, [items, onSelect]);

	const selectLast = useCallback(() => {
		if (items.length > 0) {
			onSelect(items[items.length - 1].id);
		}
	}, [items, onSelect]);

	useKeyboardNavigation({
		enabled,
		bindings: [
			{ key: "j", handler: selectNext, preventDefault: true },
			{ key: "ArrowDown", handler: selectNext, preventDefault: true },
			{ key: "k", handler: selectPrevious, preventDefault: true },
			{ key: "ArrowUp", handler: selectPrevious, preventDefault: true },
			{ key: "g", handler: selectFirst, preventDefault: true },
			{
				key: "G",
				handler: selectLast,
				noModifiers: false,
				preventDefault: true,
			},
		],
	});

	return {
		currentIndex,
		selectNext,
		selectPrevious,
		selectFirst,
		selectLast,
	};
};
