import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { cn } from "@/lib/utils";

interface SearchBarProps {
	value: string;
	onChange: (value: string) => void;
	/**
	 * Full clear (X button): resets the query AND the selected thread so the
	 * view returns to the plain list with nothing pre-opened (#538).
	 */
	onClear: () => void;
	/**
	 * Query-only clear (Esc key): resets just the query and leaves any open
	 * thread untouched — one keypress, one effect (#489). Falls back to
	 * `onClear` when omitted.
	 */
	onClearQuery?: () => void;
	placeholder?: string;
}

export const SearchBar = ({
	value,
	onChange,
	onClear,
	onClearQuery,
	placeholder = "Search mail...",
}: SearchBarProps) => {
	const inputRef = useRef<HTMLInputElement>(null);
	const clearQuery = onClearQuery ?? onClear;

	const focusSearch = useCallback(() => {
		inputRef.current?.focus();
	}, []);

	const handleClear = useCallback(() => {
		onClear();
		inputRef.current?.focus();
	}, [onClear]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key === "Escape") {
				if (value) {
					clearQuery();
				} else {
					inputRef.current?.blur();
				}
			}
		},
		[value, clearQuery],
	);

	// Global "/" shortcut to focus search
	useKeyboardNavigation({
		enabled: true,
		bindings: [{ key: "/", handler: focusSearch, preventDefault: true }],
	});

	// Clear search on Escape when focused
	useEffect(() => {
		const handleGlobalEscape = (event: KeyboardEvent) => {
			if (
				event.key === "Escape" &&
				document.activeElement === inputRef.current
			) {
				if (value) {
					clearQuery();
				} else {
					inputRef.current?.blur();
				}
			}
		};

		window.addEventListener("keydown", handleGlobalEscape);
		return () => window.removeEventListener("keydown", handleGlobalEscape);
	}, [value, clearQuery]);

	return (
		<div className="relative w-full">
			<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-fg-muted pointer-events-none" />
			<input
				ref={inputRef}
				id="mail-search"
				name="q"
				type="text"
				aria-label="Search mail"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={placeholder}
				className={cn(
					"w-full pl-9 pr-9 py-1.5 text-sm rounded-md",
					"bg-surface-sunken/50 border border-transparent",
					"focus:bg-canvas focus:border-line focus:outline-none focus:ring-2 focus:ring-ring",
					"placeholder:text-fg-muted",
					"transition-colors",
				)}
			/>
			{value && (
				<button
					type="button"
					onClick={handleClear}
					className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-surface-raised transition-colors"
					aria-label="Clear search"
				>
					<X className="size-4 text-fg-muted" />
				</button>
			)}
		</div>
	);
};
