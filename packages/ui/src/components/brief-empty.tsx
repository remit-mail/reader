import { Loader2, Sparkles } from "lucide-react";

/**
 * How far the mail sync has got, for the accounts feeding the brief. `total` is
 * 0 while the server has not counted the mailbox yet, which is a real state
 * during the first seconds of a sync — not a missing number.
 */
export interface BriefSyncProgress {
	synced: number;
	total: number;
}

export interface BriefEmptyProps {
	/**
	 * Present only while at least one account reports an in-progress sync phase.
	 * Its presence is what separates "we have everything and there is nothing"
	 * from "we do not have it yet" — an empty brief looks identical either way,
	 * and saying "caught up" during the first sync is a false statement about
	 * the user's mail (#452).
	 */
	sync?: BriefSyncProgress;
}

/**
 * The brief with no sections. Two states, because an empty list has two
 * causes and only one of them is good news.
 */
export function BriefEmpty({ sync }: BriefEmptyProps) {
	if (sync) {
		return (
			<div
				className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center px-4"
				role="status"
				aria-live="polite"
			>
				<Loader2
					className="size-8 animate-spin text-fg-subtle"
					aria-hidden="true"
				/>
				<p className="text-sm font-medium text-fg">Still syncing your mail</p>
				<p className="text-xs text-fg-subtle">{syncCopy(sync)}</p>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center px-4">
			<Sparkles className="size-8 text-fg-subtle" aria-hidden="true" />
			<p className="text-sm font-medium text-fg">You're caught up</p>
			<p className="text-xs text-fg-subtle">Nothing needs attention.</p>
		</div>
	);
}

function syncCopy({ synced, total }: BriefSyncProgress): string {
	if (total > 0) {
		return `${synced.toLocaleString()} of ${total.toLocaleString()} messages downloaded. This list fills in as they arrive.`;
	}
	return "Downloading your messages. This list fills in as they arrive.";
}
