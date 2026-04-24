import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { cn } from "@/lib/utils";

interface SearchBarProps {
	value: string;
	onChange: (value: string) => void;
	onClear: () => void;
	placeholder?: string;
}

export const SearchBar = ({
	value,
	onChange,
	onClear,
	placeholder = "Search mail...",
}: SearchBarProps) => {
	const inputRef = useRef<HTMLInputElement>(null);

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
					onClear();
				} else {
					inputRef.current?.blur();
				}
			}
		},
		[value, onClear],
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
					onClear();
				} else {
					inputRef.current?.blur();
				}
			}
		};

		window.addEventListener("keydown", handleGlobalEscape);
		return () => window.removeEventListener("keydown", handleGlobalEscape);
	}, [value, onClear]);

	return (
		<div className="relative w-full">
			<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
			<input
				ref={inputRef}
				id="mail-search"
				name="q"
				type="search"
				aria-label="Search mail"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={placeholder}
				className={cn(
					"w-full pl-9 pr-9 py-1.5 text-sm rounded-md",
					"bg-muted/50 border border-transparent",
					"focus:bg-background focus:border-border focus:outline-none focus:ring-2 focus:ring-ring",
					"placeholder:text-muted-foreground",
					"transition-colors",
				)}
			/>
			{value && (
				<button
					type="button"
					onClick={handleClear}
					className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-accent transition-colors"
					aria-label="Clear search"
				>
					<X className="size-4 text-muted-foreground" />
				</button>
			)}
		</div>
	);
};
