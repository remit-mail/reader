import { messageOperationsGetRawMessageOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/ErrorState";

interface RawMessageViewProps {
	/** The message whose raw RFC822/MIME source to fetch and display. */
	messageId: string;
	/**
	 * Only fetch when the raw view is actually visible. The expanded card
	 * mounts this lazily, but gating on `enabled` keeps the request from
	 * firing if a parent ever renders it ahead of time.
	 */
	enabled?: boolean;
}

const LoadingSkeleton = () => (
	// biome-ignore lint/a11y/useSemanticElements: <div> with role="status" preserves block layout; <output> is inline
	<div
		className="animate-pulse space-y-2"
		role="status"
		aria-label="Loading raw email"
	>
		<div className="h-4 bg-surface-sunken rounded w-full" />
		<div className="h-4 bg-surface-sunken rounded w-11/12" />
		<div className="h-4 bg-surface-sunken rounded w-5/6" />
		<div className="h-4 bg-surface-sunken rounded w-3/4" />
	</div>
);

/**
 * Render the raw RFC822/MIME source (headers + body) of a message in a
 * scrollable monospace block. Distinguishes loading / failed / loaded so an
 * empty raw body is never confused with a fetch failure
 * (memory: feedback_never_hide_failure).
 */
export const RawMessageView = ({
	messageId,
	enabled = true,
}: RawMessageViewProps) => {
	const { data, isLoading, isError, error, refetch } = useQuery({
		...messageOperationsGetRawMessageOptions({ path: { messageId } }),
		enabled,
	});

	if (isLoading) {
		return (
			<div className="message-body">
				<LoadingSkeleton />
			</div>
		);
	}

	if (isError) {
		return (
			<div className="message-body">
				<ErrorState
					variant="inline"
					title="Couldn't load the raw email"
					error={error}
					onRetry={() => refetch()}
				/>
			</div>
		);
	}

	const raw = data?.raw ?? "";
	if (raw === "") {
		return (
			<div className="message-body">
				<p className="text-fg-muted text-sm italic">
					No raw source available for this message.
				</p>
			</div>
		);
	}

	return (
		<div className="message-body">
			<pre className="email-text whitespace-pre-wrap break-words text-sm leading-relaxed bg-surface-sunken rounded-md p-3 max-h-[32rem] overflow-auto">
				{raw}
			</pre>
		</div>
	);
};
