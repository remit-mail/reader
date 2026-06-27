import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { Kbd } from "./kbd.js";

export interface KeyboardHint {
	/** One or more keys shown as `Kbd` chips. */
	keys: string[];
	/** What the keys do. */
	label: string;
}

export interface KeyboardHintBarProps {
	/** Override the default hint set. */
	hints?: KeyboardHint[];
	className?: string;
}

/** The persistent message-list footer hint set (desktop). */
export const defaultKeyboardHints: KeyboardHint[] = [
	{ keys: ["j", "k"], label: "navigate" },
	{ keys: ["m"], label: "mute" },
	{ keys: ["?"], label: "all shortcuts" },
];

/**
 * The keyboard-shortcut hint footer under the message list. Keyboard-first
 * discoverability — the shortcuts aren't hidden behind the `?` modal. The host
 * renders it on desktop only (gating by layout tier, not a CSS breakpoint),
 * since a key-hint footer on a touch device is noise.
 */
export function KeyboardHintBar({
	hints = defaultKeyboardHints,
	className,
}: KeyboardHintBarProps) {
	return (
		<footer
			className={cn(
				"flex items-center gap-2 border-t border-line px-row-inset py-1 text-2xs text-fg-subtle",
				className,
			)}
		>
			{hints.map((hint) => (
				<HintGroup key={hint.label} hint={hint} />
			))}
		</footer>
	);
}

function HintGroup({ hint }: { hint: KeyboardHint }): ReactNode {
	return (
		<span className="flex items-center gap-1">
			{hint.keys.map((key) => (
				<Kbd key={key}>{key}</Kbd>
			))}
			<span>{hint.label}</span>
		</span>
	);
}
