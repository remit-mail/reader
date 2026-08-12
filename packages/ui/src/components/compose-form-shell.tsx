import type { ReactNode } from "react";

export type ComposeMode = "new" | "reply" | "reply_all" | "forward";

export const composeModeLabels: Record<ComposeMode, string> = {
	new: "New Message",
	reply: "Reply",
	reply_all: "Reply All",
	forward: "Forward",
};

/**
 * How the surface gets its height. `fill` takes the one its container hands it
 * and scrolls the body inside that, so the action bar is pinned to the bottom
 * edge — a window's shape. `flow` takes the height of what is written in it and
 * has no scroller of its own, so the surface grows downward and whatever it
 * sits in is the only thing that scrolls.
 */
export type ComposeShellLayout = "fill" | "flow";

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
	layout?: ComposeShellLayout;
}

/**
 * Presentational compose layout: banner / header / body+quote / action bar.
 *
 * In `fill` the body region is a column so the editor can claim the space the
 * quote and the action bar leave — a body slot shorter than the region would
 * otherwise leave dead, unclickable canvas under it.
 *
 * In `flow` nothing here scrolls. A composer that is a block of the page it was
 * opened on must not bring a second scroller into that pane: two tracks in one
 * column, with the caret in the inner one, is the reader guessing which of them
 * a wheel gesture belongs to.
 *
 * A surface that grows with the writing grows past the screen on a phone after
 * a few paragraphs, and the action bar is the last thing in it — so in `flow`
 * the bar rides the bottom edge of whatever scrolls the page while the surface
 * is on it. Send is reachable at every length of draft, and lands back in the
 * column when the end of the composer comes into view.
 */
export function ComposeFormShell({
	banner,
	header,
	children,
	quoted,
	actionBar,
	layout = "fill",
}: ComposeFormShellProps) {
	const fills = layout === "fill";
	return (
		<div className={fills ? "flex h-full min-h-0 flex-col" : "flex flex-col"}>
			{banner}
			{header}
			<div
				className={
					fills ? "flex min-h-0 flex-1 flex-col overflow-auto" : "flex flex-col"
				}
				data-testid="compose-body-area"
			>
				{children}
				{quoted && <div className="shrink-0 px-3 pb-2">{quoted}</div>}
			</div>
			{fills ? (
				actionBar
			) : (
				<div className="sticky bottom-0 z-10 bg-canvas">{actionBar}</div>
			)}
		</div>
	);
}
