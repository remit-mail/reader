import { Button } from "@remit/ui";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { useOrganizeJob } from "@/hooks/useOrganizeJob";

/**
 * The non-editing states a filter-rule editor lands in after commit, shared by
 * the Organize and filter-from-search surfaces so a back-apply job, a saved
 * standing rule, and a commit failure read identically wherever the rule was
 * authored (RFC 038 D1).
 */

export function JobProgress({
	progress,
	isDone,
	runningLabel,
	onClose,
}: {
	progress: ReturnType<typeof useOrganizeJob>["progress"];
	isDone: boolean;
	/** In-flight copy — the caller names what it is organizing. */
	runningLabel: string;
	onClose: () => void;
}) {
	const failed = progress.state === "Failed";
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
			{!isDone ? (
				<Loader2 className="size-8 animate-spin text-accent-2" />
			) : failed ? (
				<span className="text-sm font-semibold text-danger">
					Organize failed
				</span>
			) : (
				<CheckCircle2 className="size-8 text-positive" />
			)}

			{!isDone && <p className="text-sm font-medium text-fg">{runningLabel}</p>}

			{isDone && !failed && (
				<div className="text-sm text-fg">
					<p className="font-medium">Done</p>
					<p className="mt-1 text-xs text-fg-muted">
						{progress.appliedCount} of {progress.matchedCount} moved
						{progress.failedCount > 0
							? ` · ${progress.failedCount} failed`
							: ""}
						.
					</p>
				</div>
			)}

			{isDone && failed && (
				<p className="max-w-xs text-xs text-fg-muted">
					{progress.errorMessage || "Something went wrong. Please try again."}
				</p>
			)}

			{isDone && (
				<Button variant="primary" onClick={onClose} className="mt-2">
					Done
				</Button>
			)}
		</div>
	);
}

export function SavingState() {
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
			<Loader2 className="size-8 animate-spin text-accent-2" />
			<p className="text-sm font-medium text-fg">Saving rule…</p>
		</div>
	);
}

export function FilterSaved({ onClose }: { onClose: () => void }) {
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
			<CheckCircle2 className="size-8 text-positive" />
			<p className="text-sm font-medium text-fg">Filter saved</p>
			<p className="max-w-xs text-xs text-fg-muted">
				You can see it, and when it expires, under Settings › Filters.
			</p>
			<Button variant="primary" onClick={onClose} className="mt-2">
				Done
			</Button>
		</div>
	);
}

export function CommitError({
	onRetry,
	onClose,
}: {
	onRetry: () => void;
	onClose: () => void;
}) {
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
			<p className="text-sm font-medium text-danger">Couldn't save the rule</p>
			<p className="max-w-xs text-xs text-fg-muted">Please try again.</p>
			<div className="mt-2 flex gap-2">
				<Button variant="primary" onClick={onRetry}>
					Try again
				</Button>
				<Button variant="ghost" onClick={onClose}>
					Not now
				</Button>
			</div>
		</div>
	);
}
