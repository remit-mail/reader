import { useCallback, useEffect } from "react";

type KeyHandler = (event: KeyboardEvent) => void;

interface KeyBinding {
	key: string;
	handler: KeyHandler;
	/** If true, only trigger when no modifier keys are pressed */
	noModifiers?: boolean;
	/** If true, prevent default browser behavior */
	preventDefault?: boolean;
}

interface UseKeyboardNavigationOptions {
	/** Whether the keyboard navigation is enabled */
	enabled?: boolean;
	/** Key bindings to register */
	bindings: KeyBinding[];
}

/**
 * Hook for handling keyboard navigation.
 * Registers global keyboard event listeners and calls handlers for matching keys.
 */
export const useKeyboardNavigation = ({
	enabled = true,
	bindings,
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
				const noModifiersRequired = binding.noModifiers ?? true;
				const hasModifiers = event.ctrlKey || event.metaKey || event.altKey;

				if (keyMatches && (!noModifiersRequired || !hasModifiers)) {
					if (binding.preventDefault) {
						event.preventDefault();
					}
					binding.handler(event);
					return;
				}
			}
		},
		[bindings],
	);

	useEffect(() => {
		if (!enabled) return;

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [enabled, handleKeyDown]);
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
