import type { Ref } from "react";
import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSuggestList } from "../lib/use-suggest-list.js";
import { AddressTag } from "./address-tag.js";
import { type Suggestion, SuggestList } from "./suggest-list.js";

export interface AddressEntry {
	email: string;
	displayName?: string;
}

/**
 * What a caller acting on the field's contents holds it by.
 *
 * The field commits on blur behind a timer, so that a click travelling towards a
 * suggestion is not answered by the list disappearing under it. Anything that
 * acts on the recipients — sending — is a press that blurs the field, and so
 * lands inside that window and reads the list as it stood before the last
 * address was typed. `commitPending` closes it: it turns what is in the field
 * into an address and hands back the list including it, in the same tick as the
 * press.
 */
export interface ComposeAddressFieldHandle {
	/**
	 * Take what is typed and return the addresses as they now stand. Returns them
	 * unchanged when the field is empty, holds something that is not an address,
	 * or repeats one already there.
	 */
	commitPending: () => AddressEntry[];
}

export interface ComposeAddressFieldProps {
	label: string;
	addresses: AddressEntry[];
	onChange: (addresses: AddressEntry[]) => void;
	placeholder?: string;
	/** Candidates for what is typed so far. The caller looks them up. */
	suggestions?: readonly AddressEntry[];
	/** The current text, reported so the caller can look candidates up. */
	onQueryChange?: (query: string) => void;
	ref?: Ref<ComposeAddressFieldHandle>;
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

export const ComposeAddressField = ({
	label,
	addresses,
	onChange,
	placeholder,
	suggestions = [],
	onQueryChange,
	ref,
}: ComposeAddressFieldProps) => {
	const [inputValue, setInputValue] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const existingEmails = new Set(addresses.map((a) => a.email.toLowerCase()));
	const filteredSuggestions =
		inputValue.length >= 2
			? suggestions.filter((s) => !existingEmails.has(s.email.toLowerCase()))
			: [];

	const addAddress = useCallback(
		(entry: AddressEntry) => {
			if (existingEmails.has(entry.email.toLowerCase())) return;
			onChange([...addresses, entry]);
			setInputValue("");
			onQueryChange?.("");
		},
		[addresses, existingEmails, onChange, onQueryChange],
	);

	const removeAddress = useCallback(
		(index: number) => {
			onChange(addresses.filter((_, i) => i !== index));
		},
		[addresses, onChange],
	);

	const selectSuggestion = useCallback(
		(suggestion: AddressEntry) => {
			addAddress(suggestion);
			inputRef.current?.focus();
		},
		[addAddress],
	);

	const commitPending = useCallback((): AddressEntry[] => {
		const entry = parseEmailInput(inputValue);
		if (!entry || existingEmails.has(entry.email.toLowerCase()))
			return addresses;

		const next = [...addresses, entry];
		onChange(next);
		setInputValue("");
		onQueryChange?.("");
		return next;
	}, [inputValue, addresses, existingEmails, onChange, onQueryChange]);

	useImperativeHandle(ref, () => ({ commitPending }), [commitPending]);

	// A blur that has already been answered — by a send committing the field in
	// the same press — must not commit again off the value it saw on the way out.
	const latestCommitRef = useRef(commitPending);
	useEffect(() => {
		latestCommitRef.current = commitPending;
	}, [commitPending]);

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
				value: suggestion.email,
				label: suggestion.displayName ?? suggestion.email,
				...(suggestion.displayName ? { hint: suggestion.email } : {}),
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
					commitPending();
				}
			}
		},
		[
			inputValue,
			addresses.length,
			removeAddress,
			suggest.handleKeyDown,
			commitPending,
		],
	);

	// The delay is what keeps a click on a suggestion alive: the press blurs the
	// input before it lands, and committing straight away would take the list out
	// from under the pointer.
	const handleBlur = useCallback(() => {
		setTimeout(() => {
			latestCommitRef.current();
			suggest.dismiss();
		}, 150);
	}, [suggest.dismiss]);

	return (
		<div className="relative" data-address-field={label}>
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
							onQueryChange?.(e.target.value);
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
							(suggestion) => suggestion.email === option.value,
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
