import type { Ref } from "react";
import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type AddressEntry,
	type ParsedAddressInput,
	parseAddressInput,
} from "../lib/parse-address-input.js";
import { useSuggestList } from "../lib/use-suggest-list.js";
import { AddressTag } from "./address-tag.js";
import { type Suggestion, SuggestList } from "./suggest-list.js";

export type { AddressEntry, ParsedAddressInput };

/** What the field holds, after a commit. */
export interface ComposeAddressCommit {
	/** Every address the field now has, the ones just taken included. */
	addresses: AddressEntry[];
	/** What was left in the field because it is not an address. */
	unparsed: string;
}

/**
 * What a caller acting on the field's contents holds it by.
 *
 * The field commits on blur behind a timer, so that a click travelling towards a
 * suggestion is not answered by the list disappearing under it. Anything that
 * acts on the recipients — sending — is a press that blurs the field, and so
 * lands inside that window and reads the list as it stood before the last
 * address was typed. `commitPending` closes it: it takes what is in the field
 * and hands back the list including it, in the same tick as the press.
 */
export interface ComposeAddressFieldHandle {
	/**
	 * Take the addresses the field is holding and report what it holds after.
	 * Anything that is not an address stays in the field and is named in
	 * `unparsed`, for the caller to refuse on rather than send without.
	 */
	commitPending: () => ComposeAddressCommit;
	/** Drop what is typed and not committed — the field's share of a new document. */
	clearPending: () => void;
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
	/**
	 * What the field is holding but has not committed, so a caller whose own
	 * state turns on having a recipient counts what is on screen.
	 */
	onPendingChange?: (pending: ParsedAddressInput) => void;
	ref?: Ref<ComposeAddressFieldHandle>;
}

/** Beyond Enter, the keys that take the highlighted suggestion in a chips field. */
const ACCEPT_KEYS = ["Tab", ","] as const;

/** How long a click has to reach a suggestion before the blur commits the field. */
const BLUR_COMMIT_MS = 150;

export const ComposeAddressField = ({
	label,
	addresses,
	onChange,
	placeholder,
	suggestions = [],
	onQueryChange,
	onPendingChange,
	ref,
}: ComposeAddressFieldProps) => {
	const [inputValue, setInputValue] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const pending = useMemo(() => parseAddressInput(inputValue), [inputValue]);
	useEffect(() => {
		onPendingChange?.(pending);
	}, [pending, onPendingChange]);

	const blurCommitRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const cancelBlurCommit = useCallback(() => {
		if (blurCommitRef.current === undefined) return;
		clearTimeout(blurCommitRef.current);
		blurCommitRef.current = undefined;
	}, []);
	useEffect(() => cancelBlurCommit, [cancelBlurCommit]);

	const existingEmails = new Set(addresses.map((a) => a.email.toLowerCase()));
	const filteredSuggestions =
		inputValue.length >= 2
			? suggestions.filter((s) => !existingEmails.has(s.email.toLowerCase()))
			: [];

	const setInput = useCallback(
		(next: string) => {
			setInputValue(next);
			onQueryChange?.(next);
		},
		[onQueryChange],
	);

	const addAddress = useCallback(
		(entry: AddressEntry) => {
			cancelBlurCommit();
			if (existingEmails.has(entry.email.toLowerCase())) return;
			onChange([...addresses, entry]);
			setInput("");
		},
		[addresses, existingEmails, onChange, setInput, cancelBlurCommit],
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

	const commitPending = useCallback((): ComposeAddressCommit => {
		cancelBlurCommit();
		if (pending.entries.length === 0) {
			return { addresses, unparsed: pending.unparsed };
		}

		const taken = new Set(existingEmails);
		const next = [...addresses];
		for (const entry of pending.entries) {
			const key = entry.email.toLowerCase();
			if (taken.has(key)) continue;
			taken.add(key);
			next.push(entry);
		}

		onChange(next);
		setInput(pending.unparsed);
		return { addresses: next, unparsed: pending.unparsed };
	}, [
		pending,
		addresses,
		existingEmails,
		onChange,
		setInput,
		cancelBlurCommit,
	]);

	const clearPending = useCallback(() => {
		cancelBlurCommit();
		setInput("");
	}, [setInput, cancelBlurCommit]);

	useImperativeHandle(ref, () => ({ commitPending, clearPending }), [
		commitPending,
		clearPending,
	]);

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
		cancelBlurCommit();
		blurCommitRef.current = setTimeout(() => {
			blurCommitRef.current = undefined;
			latestCommitRef.current();
			suggest.dismiss();
		}, BLUR_COMMIT_MS);
	}, [cancelBlurCommit, suggest.dismiss]);

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
							setInput(e.target.value);
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
