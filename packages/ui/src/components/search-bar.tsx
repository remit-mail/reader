import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { cn } from "../lib/cn.js";

export interface SearchBarProps {
	value: string;
	onChange: (value: string) => void;
	/**
	 * Full clear (X button): the consumer resets the query AND any open thread
	 * so the view returns to the plain list with nothing pre-opened (#538).
	 */
	onClear: () => void;
	/**
	 * Query-only clear (Esc key): resets just the query and leaves any open
	 * thread untouched — one keypress, one effect (#489). Falls back to
	 * `onClear` when omitted.
	 */
	onClearQuery?: () => void;
	placeholder?: string;
	/**
	 * Bind the global "/" shortcut that focuses the field from anywhere on the
	 * page. Defaults to true; set false where a page hosts more than one bar.
	 */
	globalFocusKey?: boolean;
	/**
	 * Show the inline clear (X) inside the field. Defaults to true. Set false in
	 * the mobile takeover / collapsed header, where a single outer X owns
	 * clear-and-close so there is exactly one X (Esc still clears the query).
	 */
	showClearButton?: boolean;
}

const isEditableTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.tagName === "INPUT" ||
		target.tagName === "TEXTAREA" ||
		target.isContentEditable
	);
};

export const SearchBar = ({
	value,
	onChange,
	onClear,
	onClearQuery,
	placeholder = "Search mail...",
	globalFocusKey = true,
	showClearButton = true,
}: SearchBarProps) => {
	const inputRef = useRef<HTMLInputElement>(null);
	const clearQuery = onClearQuery ?? onClear;

	const handleClear = useCallback(() => {
		onClear();
		inputRef.current?.focus();
	}, [onClear]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key !== "Escape") return;
			if (value) {
				clearQuery();
				return;
			}
			inputRef.current?.blur();
		},
		[value, clearQuery],
	);

	useEffect(() => {
		if (!globalFocusKey) return;
		const handleGlobalSlash = (event: KeyboardEvent) => {
			if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
				return;
			}
			if (isEditableTarget(event.target)) return;
			event.preventDefault();
			inputRef.current?.focus();
		};
		window.addEventListener("keydown", handleGlobalSlash);
		return () => window.removeEventListener("keydown", handleGlobalSlash);
	}, [globalFocusKey]);

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
			{value && showClearButton && (
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
