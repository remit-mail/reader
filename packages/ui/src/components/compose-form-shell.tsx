import { type DragEvent, type ReactNode, useState } from "react";

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
	/** The files the message carries, above the action bar. */
	attachments?: ReactNode;
	/** The ComposeActionBar. */
	actionBar: ReactNode;
	layout?: ComposeShellLayout;
	onDropFiles?: (files: File[]) => void;
}

const carriesFiles = (event: DragEvent): boolean =>
	Array.from(event.dataTransfer?.types ?? []).includes("Files");

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
	attachments,
	actionBar,
	layout = "fill",
	onDropFiles,
}: ComposeFormShellProps) {
	const fills = layout === "fill";
	const [dropping, setDropping] = useState(false);
	const dropTarget = onDropFiles
		? {
				onDragOver: (event: DragEvent<HTMLDivElement>) => {
					if (!carriesFiles(event)) return;
					event.preventDefault();
					setDropping(true);
				},
				onDragLeave: (event: DragEvent<HTMLDivElement>) => {
					if (
						event.relatedTarget instanceof Node &&
						event.currentTarget.contains(event.relatedTarget)
					)
						return;
					setDropping(false);
				},
				onDrop: (event: DragEvent<HTMLDivElement>) => {
					setDropping(false);
					const files = Array.from(event.dataTransfer?.files ?? []);
					if (files.length === 0) return;
					event.preventDefault();
					onDropFiles(files);
				},
			}
		: {};
	return (
		<div
			className={[
				fills ? "flex h-full min-h-0 flex-col" : "flex flex-col",
				dropping && "outline-2 -outline-offset-2 outline-dashed outline-accent",
			]
				.filter(Boolean)
				.join(" ")}
			data-testid="compose-drop-target"
			data-dropping={dropping || undefined}
			{...dropTarget}
		>
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
			{attachments && <div className="shrink-0">{attachments}</div>}
			{fills ? (
				actionBar
			) : (
				<div className="sticky bottom-0 z-10 bg-canvas">{actionBar}</div>
			)}
		</div>
	);
}
