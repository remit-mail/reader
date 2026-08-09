import type { MouseEvent, ReactNode } from "react";
import { cn } from "../lib/cn.js";
import type { ThreadRowData } from "./app-shell-types.js";
import { comfortableRowClass, ComfortableRowTextContent } from "./message-row.js";

export interface IconRowProps {
	thread: ThreadRowData;
	/** Leading glyph in place of the usual avatar (e.g. a draft/document icon). */
	icon: ReactNode;
	active?: boolean;
	/** Row-trailing actions, revealed on hover (e.g. a delete button). */
	trailing?: ReactNode;
	onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * A `comfortableRowClass` row whose leading slot is an icon rather than an
 * `Avatar` — the Remit-drafts row in the Drafts pane, not yet backed by a
 * real IMAP sender to show an avatar for.
 */
export function IconRow({ thread, icon, active, trailing, onClick }: IconRowProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn("group", comfortableRowClass({ active }))}
		>
			{icon}
			<ComfortableRowTextContent thread={thread} />
			{trailing}
		</button>
	);
}
