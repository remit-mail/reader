import { RefreshCw } from "lucide-react";
import { useState } from "react";
import type { ThreadSection } from "./app-shell-types.js";
import { SwipeableRow, type SwipePeek } from "./swipeable-row.js";

export function TouchListBody({
	sections,
	selectedThreadId,
	selectionMode,
	checkedIds,
	initialPeek,
	onToggleCheck,
	onEnterSelection,
	onOpenThread,
	onRefresh,
	refreshing,
	busy = false,
}: {
	sections: ThreadSection[];
	selectedThreadId?: string;
	selectionMode: boolean;
	checkedIds: ReadonlySet<string>;
	initialPeek?: SwipePeek;
	onToggleCheck: (id: string) => void;
	onEnterSelection: (id: string) => void;
	onOpenThread: (id: string) => void;
	onRefresh: () => void;
	refreshing: boolean;
	/**
	 * A bulk operation (e.g. delete) is running against the checked set. Rows
	 * dim and stop responding to taps instead of sitting normal, undimmed and
	 * still tappable while a count above them claims they're being deleted.
	 */
	busy?: boolean;
}) {
	// What a swipe has left a row at — the state it landed on, not a flip of
	// whatever the prop says — so the list still follows the `sections` its
	// consumer passes. The live client owns real mutation.
	const [swipedAway, setSwipedAway] = useState<ReadonlySet<string>>(new Set());
	const [swipedRead, setSwipedRead] = useState<ReadonlyMap<string, boolean>>(
		new Map(),
	);
	const items = sections
		.flatMap((section) => section.threads)
		.filter((thread) => !swipedAway.has(thread.id))
		.map((thread) => {
			const read = swipedRead.get(thread.id);
			return read === undefined ? thread : { ...thread, isRead: read };
		});
	const [peek, setPeek] = useState<{ id: string; side: SwipePeek } | null>(
		initialPeek && initialPeek !== "none" && items[1]
			? { id: items[1].id, side: initialPeek }
			: null,
	);
	const act = (id: string, side: "leading" | "trailing") => {
		if (side === "trailing") {
			setSwipedAway((prev) => new Set(prev).add(id));
		} else {
			const shown = items.find((thread) => thread.id === id);
			setSwipedRead((prev) => new Map(prev).set(id, !shown?.isRead));
		}
		setPeek(null);
	};
	return (
		<div className="flex-1 overflow-y-auto">
			{refreshing && (
				<div className="flex items-center justify-center gap-2 border-b border-line py-3 text-fg-muted">
					<RefreshCw className="size-4 animate-spin" />
					<span className="text-xs">Checking for new mail…</span>
				</div>
			)}
			<div className="divide-y divide-line">
				{items.map((thread) => (
					<div
						key={thread.id}
						className={busy ? "pointer-events-none opacity-50" : undefined}
					>
						<SwipeableRow
							thread={thread}
							selectionMode={selectionMode}
							checked={checkedIds.has(thread.id)}
							active={thread.id === selectedThreadId}
							peek={peek?.id === thread.id ? peek.side : "none"}
							onPeek={(next) =>
								setPeek(next === "none" ? null : { id: thread.id, side: next })
							}
							onToggleCheck={() => onToggleCheck(thread.id)}
							onLongPress={() => onEnterSelection(thread.id)}
							onOpen={() => onOpenThread(thread.id)}
							onAct={(side) => act(thread.id, side)}
						/>
					</div>
				))}
			</div>
			{!selectionMode && !refreshing && !busy && (
				<button
					type="button"
					onClick={onRefresh}
					className="w-full border-t border-line py-2 text-center text-2xs text-fg-subtle transition-colors hover:bg-surface-sunken"
				>
					Pull to refresh
				</button>
			)}
		</div>
	);
}
