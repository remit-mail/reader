import type { RemitImapMailboxResponse } from "@remit/api-http-client/types.gen.ts";
import { Search } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useRovingFocus } from "@/hooks/useRovingFocus.ts";
import {
	getMailboxDisplayLabel,
	getMailboxDisplayName,
} from "@/lib/mailbox-order";
import { buildMoveTargets, filterMoveTargetsByQuery } from "@/lib/move-targets";
import { cn } from "@/lib/utils";

interface MoveToMailboxPickerProps {
	mailboxes: readonly RemitImapMailboxResponse[];
	currentMailboxId: string;
	onSelect: (destinationMailboxId: string) => void;
	/**
	 * Called when the user dismisses the picker via Escape. Trigger consumers
	 * use this to close their popover/drawer; the picker itself never owns
	 * presentation, so it cannot close itself without help.
	 */
	onCancel?: () => void;
	/**
	 * Mobile callers (bottom-sheet) pass `autoFocus` to focus the search
	 * input as soon as the sheet opens — keyboard accessory + immediate
	 * filter typing without an extra tap. Desktop dropdowns leave the
	 * focus on the trigger so click-outside dismissal stays predictable.
	 */
	autoFocus?: boolean;
}

const ROW_BASE =
	"w-full text-left px-3 py-2.5 min-h-11 flex items-center gap-2 transition-colors text-sm rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

export const MoveToMailboxPicker = ({
	mailboxes,
	currentMailboxId,
	onSelect,
	onCancel,
	autoFocus = false,
}: MoveToMailboxPickerProps) => {
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const { t } = useTranslation("mail", { useSuspense: false });
	// `getMailboxDisplayLabel` expects a translator with a positional
	// `(key, fallback)` shape; i18next's `t` treats the second argument as
	// an options object — passing it raw breaks fallback behavior. Wrap it
	// the same way `MailboxItem.tsx` does so the picker labels match the
	// sidebar exactly.
	const translator = (key: string, fallback: string): string =>
		t(key, { defaultValue: fallback });

	useEffect(() => {
		if (autoFocus) {
			inputRef.current?.focus();
		}
	}, [autoFocus]);

	const targets = useMemo(() => buildMoveTargets(mailboxes), [mailboxes]);
	const filtered = useMemo(
		() => filterMoveTargetsByQuery(targets, query),
		[targets, query],
	);

	const isOptionDisabled = useCallback(
		(idx: number) => filtered[idx]?.mailboxId === currentMailboxId,
		[filtered, currentMailboxId],
	);

	const {
		index: focusedIndex,
		next,
		previous,
		first,
		last,
		setIndex,
	} = useRovingFocus({
		count: filtered.length,
		isDisabled: isOptionDisabled,
	});

	useEffect(() => {
		if (focusedIndex < 0) return;
		const node = optionRefs.current[focusedIndex];
		if (!node) return;
		// Only steal focus if the user is already navigating the list — moving
		// focus while they type in the filter input would trap them. The search
		// input keeps focus until the first ArrowDown.
		if (document.activeElement === inputRef.current) return;
		node.focus();
	}, [focusedIndex]);

	const handleConfirm = useCallback(() => {
		if (focusedIndex < 0) return;
		const target = filtered[focusedIndex];
		if (!target) return;
		if (target.mailboxId === currentMailboxId) return;
		onSelect(target.mailboxId);
	}, [focusedIndex, filtered, currentMailboxId, onSelect]);

	const handleListKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLElement>) => {
			switch (event.key) {
				case "ArrowDown":
					event.preventDefault();
					next();
					return;
				case "ArrowUp":
					event.preventDefault();
					previous();
					return;
				case "Home":
					event.preventDefault();
					first();
					return;
				case "End":
					event.preventDefault();
					last();
					return;
				case "Enter":
				case " ":
					event.preventDefault();
					handleConfirm();
					return;
				case "Escape":
					event.preventDefault();
					onCancel?.();
					return;
				default:
					return;
			}
		},
		[next, previous, first, last, handleConfirm, onCancel],
	);

	const handleInputKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLInputElement>) => {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				if (filtered.length === 0) return;
				const target = optionRefs.current[focusedIndex >= 0 ? focusedIndex : 0];
				target?.focus();
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				onCancel?.();
			}
		},
		[filtered.length, focusedIndex, onCancel],
	);

	return (
		<div className="flex flex-col">
			<div className="px-3 pt-3 pb-2 border-b border-line">
				<div className="relative">
					<Search
						className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-fg-muted"
						aria-hidden="true"
					/>
					<input
						ref={inputRef}
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={handleInputKeyDown}
						placeholder="Filter folders"
						aria-label="Filter folders"
						className={cn(
							"w-full pl-8 pr-3 py-2 min-h-11 text-sm rounded-md",
							"bg-canvas border border-line",
							"focus:outline-none focus:ring-2 focus:ring-ring",
						)}
					/>
				</div>
			</div>
			<ul
				className="flex-1 overflow-y-auto py-1"
				role="listbox"
				aria-label="Destination folders"
				onKeyDown={handleListKeyDown}
			>
				{filtered.length === 0 ? (
					<li className="px-3 py-3 text-sm text-fg-muted" aria-live="polite">
						No folders match "{query}"
					</li>
				) : (
					filtered.map((mailbox, idx) => {
						const isCurrent = mailbox.mailboxId === currentMailboxId;
						const isFocused = idx === focusedIndex;
						const label =
							getMailboxDisplayLabel(
								mailbox.fullPath,
								mailbox.specialUse,
								translator,
							) || getMailboxDisplayName(mailbox.fullPath);
						return (
							<li key={mailbox.mailboxId}>
								{/* The interactive element IS the listbox option — putting
								    role="option" on the <li> while keeping a nested <button>
								    is invalid ARIA (an option may not contain a separately
								    interactive control). The <button> takes the option role
								    so assistive tech announces the right structure. */}
								<button
									ref={(node) => {
										optionRefs.current[idx] = node;
									}}
									type="button"
									role="option"
									aria-selected={isCurrent}
									tabIndex={isFocused ? 0 : -1}
									onClick={() => {
										if (isCurrent) return;
										onSelect(mailbox.mailboxId);
									}}
									onFocus={() => setIndex(idx)}
									disabled={isCurrent}
									aria-label={
										isCurrent ? `${label} (current folder)` : `Move to ${label}`
									}
									className={cn(
										ROW_BASE,
										"hover:bg-surface-raised",
										isCurrent &&
											"opacity-60 cursor-not-allowed bg-surface-sunken/40",
									)}
								>
									<span className="truncate flex-1">{label}</span>
									{isCurrent && (
										<span className="text-xs text-fg-muted shrink-0">
											current
										</span>
									)}
								</button>
							</li>
						);
					})
				)}
			</ul>
		</div>
	);
};
