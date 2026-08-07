import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "../lib/cn.js";
import {
	browserSpellcheckHelp,
	languageChipLabel,
	languageLabel,
} from "../lib/compose-language.js";
import { rovingNextIndex } from "../lib/roving-focus.js";
import { Button } from "./button.js";

export interface ComposeLanguageChipProps {
	/** The BCP 47 tag the message is currently being written in. */
	language: string;
	/** The account's configured tags — the menu, and detection's candidate set. */
	languages: readonly string[];
	onSelect: (tag: string) => void;
	/**
	 * The sentence naming where the browser keeps its dictionary setting.
	 * Derived from the user agent when absent.
	 */
	helpText?: string;
}

/**
 * The language control at the right of the compose toolbar: two letters, the
 * language in full to a screen reader, and a menu of the account's languages.
 *
 * Nothing here claims to change spellchecking. In Chrome and Safari the
 * underlines do not move — only the sentence at the foot of the menu names the
 * setting that does, and it names it as the browser's, not the app's.
 */
export const ComposeLanguageChip = ({
	language,
	languages,
	onSelect,
	helpText,
}: ComposeLanguageChipProps) => {
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const menuId = useId();

	const close = useCallback((returnFocus: boolean) => {
		setOpen(false);
		if (returnFocus) triggerRef.current?.focus();
	}, []);

	useEffect(() => {
		if (!open) return;
		const onPointer = (event: MouseEvent) => {
			if (containerRef.current?.contains(event.target as Node)) return;
			setOpen(false);
		};
		document.addEventListener("mousedown", onPointer);
		return () => document.removeEventListener("mousedown", onPointer);
	}, [open]);

	// The menu takes focus as it opens, so Escape and the arrow keys have
	// somewhere to land and the caret does not stay behind in the message.
	useEffect(() => {
		if (!open) return;
		const current = menuRef.current?.querySelector<HTMLElement>(
			'[aria-checked="true"]',
		);
		const first = menuRef.current?.querySelector<HTMLElement>(
			'[role="menuitemradio"]',
		);
		(current ?? first)?.focus();
	}, [open]);

	const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			close(true);
			return;
		}
		const items = [
			...(menuRef.current?.querySelectorAll<HTMLElement>(
				'[role="menuitemradio"]',
			) ?? []),
		];
		const index = items.indexOf(document.activeElement as HTMLElement);
		const next = rovingNextIndex(event.key, index, items.length);
		if (next === null) return;
		event.preventDefault();
		items[next]?.focus();
	};

	const pick = (tag: string) => {
		onSelect(tag);
		close(true);
	};

	return (
		<div ref={containerRef} className="relative">
			<Button
				ref={triggerRef}
				variant="ghost"
				size="md"
				aria-label={`Message language: ${languageLabel(language)}`}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				onClick={() => setOpen((value) => !value)}
				data-testid="compose-language-chip"
				data-language={language}
				className="min-h-11 min-w-11 shrink-0 px-2 font-medium"
			>
				{languageChipLabel(language)}
			</Button>
			{open && (
				<div
					ref={menuRef}
					id={menuId}
					role="menu"
					aria-label="Message language"
					onKeyDown={onMenuKeyDown}
					data-testid="compose-language-menu"
					className="absolute right-0 top-full z-50 mt-1 flex max-h-[60dvh] min-w-56 flex-col overflow-y-auto overscroll-contain rounded-md border border-line bg-surface py-1 shadow-lg"
				>
					{languages.map((tag) => (
						<button
							key={tag}
							type="button"
							role="menuitemradio"
							aria-checked={tag === language}
							lang={tag}
							onClick={() => pick(tag)}
							className={cn(
								"flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-left text-sm text-fg transition-colors hover:bg-surface-sunken",
								tag === language && "bg-accent-2-soft",
							)}
						>
							{languageLabel(tag)}
							<span className="shrink-0 text-xs text-fg-subtle">
								{languageChipLabel(tag)}
							</span>
						</button>
					))}
					<p
						data-testid="compose-language-help"
						className="border-t border-line px-4 pb-1 pt-2 text-xs text-fg-muted"
					>
						{helpText ?? browserSpellcheckHelp(navigator.userAgent)}
					</p>
				</div>
			)}
		</div>
	);
};
