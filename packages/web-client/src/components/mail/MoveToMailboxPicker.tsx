import type { RemitImapMailboxResponse } from "@remit/api-http-client/types.gen.ts";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
	 * Mobile callers (bottom-sheet) pass `autoFocus` to focus the search
	 * input as soon as the sheet opens — keyboard accessory + immediate
	 * filter typing without an extra tap. Desktop dropdowns leave the
	 * focus on the trigger so click-outside dismissal stays predictable.
	 */
	autoFocus?: boolean;
}

const ROW_BASE =
	"w-full text-left px-3 py-2.5 min-h-11 flex items-center gap-2 transition-colors text-sm rounded-md";

export const MoveToMailboxPicker = ({
	mailboxes,
	currentMailboxId,
	onSelect,
	autoFocus = false,
}: MoveToMailboxPickerProps) => {
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
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

	return (
		<div className="flex flex-col">
			<div className="px-3 pt-3 pb-2 border-b border-border">
				<div className="relative">
					<Search
						className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
						aria-hidden="true"
					/>
					<input
						ref={inputRef}
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Filter folders"
						aria-label="Filter folders"
						className={cn(
							"w-full pl-8 pr-3 py-2 min-h-11 text-sm rounded-md",
							"bg-background border border-border",
							"focus:outline-none focus:ring-2 focus:ring-ring",
						)}
					/>
				</div>
			</div>
			<ul
				className="flex-1 overflow-y-auto py-1"
				role="listbox"
				aria-label="Destination folders"
			>
				{filtered.length === 0 ? (
					<li
						className="px-3 py-3 text-sm text-muted-foreground"
						aria-live="polite"
					>
						No folders match "{query}"
					</li>
				) : (
					filtered.map((mailbox) => {
						const isCurrent = mailbox.mailboxId === currentMailboxId;
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
									type="button"
									role="option"
									aria-selected={isCurrent}
									onClick={() => {
										if (isCurrent) return;
										onSelect(mailbox.mailboxId);
									}}
									disabled={isCurrent}
									aria-label={
										isCurrent ? `${label} (current folder)` : `Move to ${label}`
									}
									className={cn(
										ROW_BASE,
										"hover:bg-accent",
										isCurrent && "opacity-60 cursor-not-allowed bg-muted/40",
									)}
								>
									<span className="truncate flex-1">{label}</span>
									{isCurrent && (
										<span className="text-xs text-muted-foreground shrink-0">
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
