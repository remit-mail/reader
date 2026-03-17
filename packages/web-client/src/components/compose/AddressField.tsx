import { addressOperationsSearchAddressesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAddressResponse } from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AddressTag } from "./AddressTag";

export interface AddressEntry {
	email: string;
	displayName?: string;
}

interface AddressFieldProps {
	label: string;
	addresses: AddressEntry[];
	onChange: (addresses: AddressEntry[]) => void;
	placeholder?: string;
}

const formatSuggestion = (addr: RemitImapAddressResponse): string => {
	if (addr.displayName) {
		return `${addr.displayName} <${addr.normalizedEmail}>`;
	}
	return addr.normalizedEmail;
};

const isValidEmail = (value: string): boolean =>
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const parseEmailInput = (value: string): AddressEntry | undefined => {
	const trimmed = value.trim();
	if (!trimmed) return undefined;

	const angleMatch = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
	if (angleMatch) {
		const displayName = angleMatch[1].trim();
		const email = angleMatch[2].trim();
		if (isValidEmail(email)) return { email, displayName };
	}

	if (isValidEmail(trimmed)) return { email: trimmed };
	return undefined;
};

export const AddressField = ({
	label,
	addresses,
	onChange,
	placeholder,
}: AddressFieldProps) => {
	const [inputValue, setInputValue] = useState("");
	const [highlightedIndex, setHighlightedIndex] = useState(-1);
	const [isOpen, setIsOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLUListElement>(null);

	const debouncedQuery = useDebouncedValue(inputValue, 200);

	const { data: suggestionsData } = useQuery({
		...addressOperationsSearchAddressesOptions({
			query: { q: debouncedQuery, limit: 8 },
		}),
		enabled: debouncedQuery.length >= 2,
	});

	const suggestions = suggestionsData?.items ?? [];
	const existingEmails = new Set(addresses.map((a) => a.email.toLowerCase()));
	const filteredSuggestions = suggestions.filter(
		(s) => !existingEmails.has(s.normalizedEmail.toLowerCase()),
	);

	useEffect(() => {
		setHighlightedIndex(-1);
		setIsOpen(filteredSuggestions.length > 0 && inputValue.length >= 2);
	}, [filteredSuggestions.length, inputValue.length]);

	const addAddress = useCallback(
		(entry: AddressEntry) => {
			if (existingEmails.has(entry.email.toLowerCase())) return;
			onChange([...addresses, entry]);
			setInputValue("");
			setIsOpen(false);
		},
		[addresses, existingEmails, onChange],
	);

	const removeAddress = useCallback(
		(index: number) => {
			onChange(addresses.filter((_, i) => i !== index));
		},
		[addresses, onChange],
	);

	const selectSuggestion = useCallback(
		(suggestion: RemitImapAddressResponse) => {
			addAddress({
				email: suggestion.normalizedEmail,
				displayName: suggestion.displayName,
			});
			inputRef.current?.focus();
		},
		[addAddress],
	);

	const commitInput = useCallback(() => {
		const entry = parseEmailInput(inputValue);
		if (entry) {
			addAddress(entry);
		}
	}, [inputValue, addAddress]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === "Backspace" && inputValue === "" && addresses.length > 0) {
				removeAddress(addresses.length - 1);
				return;
			}

			if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
				if (highlightedIndex >= 0 && filteredSuggestions[highlightedIndex]) {
					e.preventDefault();
					selectSuggestion(filteredSuggestions[highlightedIndex]);
					return;
				}
				if (inputValue.trim()) {
					e.preventDefault();
					commitInput();
				}
				return;
			}

			if (e.key === "ArrowDown" && isOpen) {
				e.preventDefault();
				setHighlightedIndex((prev) =>
					prev < filteredSuggestions.length - 1 ? prev + 1 : 0,
				);
				return;
			}

			if (e.key === "ArrowUp" && isOpen) {
				e.preventDefault();
				setHighlightedIndex((prev) =>
					prev > 0 ? prev - 1 : filteredSuggestions.length - 1,
				);
				return;
			}

			if (e.key === "Escape") {
				setIsOpen(false);
				setHighlightedIndex(-1);
			}
		},
		[
			inputValue,
			addresses.length,
			highlightedIndex,
			filteredSuggestions,
			isOpen,
			removeAddress,
			selectSuggestion,
			commitInput,
		],
	);

	const handleBlur = useCallback(() => {
		setTimeout(() => {
			commitInput();
			setIsOpen(false);
		}, 150);
	}, [commitInput]);

	return (
		<div className="relative">
			<div className="flex items-start gap-2">
				<label className="text-sm text-muted-foreground shrink-0 w-12 pt-1.5">
					{label}:
				</label>
				<div
					className="flex-1 flex flex-wrap items-center gap-1 min-h-[36px] px-2 py-1 border rounded-md bg-background cursor-text"
					onClick={() => inputRef.current?.focus()}
				>
					{addresses.map((addr, i) => (
						<AddressTag
							key={addr.email}
							email={addr.email}
							displayName={addr.displayName}
							onRemove={() => removeAddress(i)}
						/>
					))}
					<input
						ref={inputRef}
						type="text"
						value={inputValue}
						onChange={(e) => setInputValue(e.target.value)}
						onKeyDown={handleKeyDown}
						onBlur={handleBlur}
						placeholder={addresses.length === 0 ? placeholder : ""}
						className="flex-1 min-w-[120px] bg-transparent outline-none text-sm py-0.5"
					/>
				</div>
			</div>

			{isOpen && filteredSuggestions.length > 0 && (
				<ul
					ref={listRef}
					className="absolute left-12 right-0 mt-1 bg-popover border rounded-md shadow-lg z-50 max-h-[200px] overflow-auto"
				>
					{filteredSuggestions.map((suggestion, index) => (
						<li
							key={suggestion.addressId}
							className={cn(
								"px-3 py-2 text-sm cursor-pointer transition-colors",
								index === highlightedIndex && "bg-accent",
							)}
							onMouseDown={(e) => {
								e.preventDefault();
								selectSuggestion(suggestion);
							}}
							onMouseEnter={() => setHighlightedIndex(index)}
						>
							{formatSuggestion(suggestion)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
};

const useDebouncedValue = (value: string, delay: number): string => {
	const [debouncedValue, setDebouncedValue] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebouncedValue(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);

	return debouncedValue;
};
