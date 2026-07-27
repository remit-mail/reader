import { addressOperationsSearchAddressesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAddressResponse } from "@remit/api-http-client/types.gen.ts";
import {
	AddressTag,
	type Suggestion,
	SuggestList,
	useSuggestList,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

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

/** Beyond Enter, the keys that take the highlighted suggestion in a chips field. */
const ACCEPT_KEYS = ["Tab", ","] as const;

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
	const inputRef = useRef<HTMLInputElement>(null);

	const debouncedQuery = useDebouncedValue(inputValue, 200);

	const { data: suggestionsData } = useQuery({
		...addressOperationsSearchAddressesOptions({
			query: { q: debouncedQuery, limit: 8 },
		}),
		enabled: debouncedQuery.length >= 2,
	});

	const suggestions = suggestionsData?.items ?? [];
	const existingEmails = new Set(addresses.map((a) => a.email.toLowerCase()));
	const filteredSuggestions =
		inputValue.length >= 2
			? suggestions.filter(
					(s) => !existingEmails.has(s.normalizedEmail.toLowerCase()),
				)
			: [];

	const addAddress = useCallback(
		(entry: AddressEntry) => {
			if (existingEmails.has(entry.email.toLowerCase())) return;
			onChange([...addresses, entry]);
			setInputValue("");
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

	// The open state, the highlight, and the arrow/Enter/Escape handling are the
	// app's one typeahead behaviour, shared with the filter-rule value field.
	const suggest = useSuggestList({
		count: filteredSuggestions.length,
		acceptKeys: ACCEPT_KEYS,
		onAccept: (index) => selectSuggestion(filteredSuggestions[index]),
	});

	const options = useMemo<Suggestion[]>(
		() =>
			filteredSuggestions.map((suggestion) => ({
				value: suggestion.normalizedEmail,
				label: suggestion.displayName ?? suggestion.normalizedEmail,
				...(suggestion.displayName ? { hint: suggestion.normalizedEmail } : {}),
			})),
		[filteredSuggestions],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === "Backspace" && inputValue === "" && addresses.length > 0) {
				removeAddress(addresses.length - 1);
				return;
			}

			if (suggest.handleKeyDown(e)) return;

			if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
				if (inputValue.trim()) {
					e.preventDefault();
					commitInput();
				}
			}
		},
		[
			inputValue,
			addresses.length,
			removeAddress,
			suggest.handleKeyDown,
			commitInput,
		],
	);

	const handleBlur = useCallback(() => {
		setTimeout(() => {
			commitInput();
			suggest.dismiss();
		}, 150);
	}, [commitInput, suggest.dismiss]);

	return (
		<div className="relative">
			<div className="flex items-start gap-2">
				<label
					htmlFor={`address-field-${label}`}
					className="text-sm text-fg-muted shrink-0 w-12 pt-1.5"
				>
					{label}:
				</label>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: click-to-focus wrapper for the address input; keyboard is forwarded to the inner input */}
				<div
					className="flex-1 flex flex-wrap items-center gap-1 min-h-[36px] px-2 py-1 border rounded-md bg-canvas cursor-text"
					onClick={() => inputRef.current?.focus()}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") inputRef.current?.focus();
					}}
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
						id={`address-field-${label}`}
						type="text"
						value={inputValue}
						onChange={(e) => {
							suggest.reopen();
							setInputValue(e.target.value);
						}}
						onKeyDown={handleKeyDown}
						onBlur={handleBlur}
						placeholder={addresses.length === 0 ? placeholder : ""}
						className="flex-1 min-w-[120px] bg-transparent outline-none text-sm py-0.5"
						autoComplete="off"
						{...suggest.comboboxProps}
					/>
				</div>
			</div>

			{suggest.open && (
				<SuggestList
					id={suggest.listId}
					suggestions={options}
					activeIndex={suggest.activeIndex}
					optionId={suggest.optionId}
					onPick={(option) => {
						const picked = filteredSuggestions.find(
							(suggestion) => suggestion.normalizedEmail === option.value,
						);
						if (picked) selectSuggestion(picked);
					}}
					onHighlight={suggest.setActiveIndex}
					label={`${label} suggestions`}
					className="absolute left-12 right-0 z-50 mt-1 max-h-[200px] shadow-lg"
				/>
			)}
		</div>
	);
};
