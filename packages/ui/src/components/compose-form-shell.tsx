import type { ReactNode } from "react";

export type ComposeMode = "new" | "reply" | "reply_all" | "forward";

export const composeModeLabels: Record<ComposeMode, string> = {
	new: "New Message",
	reply: "Reply",
	reply_all: "Reply All",
	forward: "Forward",
};

export interface ComposeFormShellProps {
	/** Optional banner above the header (e.g. SMTP-missing notice). */
	banner?: ReactNode;
	/** Recipient / subject header region. */
	header: ReactNode;
	/** The editor body. */
	children: ReactNode;
	/** Quoted reply / forwarded content under the body. */
	quoted?: ReactNode;
	/** The ComposeActionBar. */
	actionBar: ReactNode;
}

/**
 * Presentational compose layout: banner / header / scrollable body+quote /
 * pinned action bar. Owns the column structure so the action bar always sits
 * at the bottom and never clips below the fold. The live form composes this
 * with its provider-driven slots; stories render it with static slots.
 */
export function ComposeFormShell({
	banner,
	header,
	children,
	quoted,
	actionBar,
}: ComposeFormShellProps) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			{banner}
			{header}
			<div className="min-h-0 flex-1 overflow-auto">
				{children}
				{quoted && <div className="px-3 pb-2">{quoted}</div>}
			</div>
			{actionBar}
		</div>
	);
}
