import { AlertOctagon } from "lucide-react";
import { useEffect, useState } from "react";
import {
	type BugReportSeed,
	buildBugReportContext,
	buildBugReportDetails,
	buildGitHubIssueUrl,
} from "@/lib/bug-report";
import {
	type FatalError,
	getCurrentFatalError,
	subscribeFatalError,
} from "@/lib/fatal-error";

/** Safe route to escape a deterministically-crashing page. `/` redirects here. */
const SAFE_ROUTE = "/mail";

/**
 * The full-screen red escalation page. A first-party fatal — an escalated 5xx,
 * or a render exception caught by the route error boundary — takes over the
 * entire viewport here: loud, red, impossible to miss. Never a benign grey
 * label.
 *
 * It is intentionally NOT dismissible: a fatal means the app is in an unknown
 * state. The affordances depend on whether the error is recoverable:
 *  - recoverable (transient 5xx / network / abort) → Retry the same action.
 *  - fatal (deterministic render exception) → NO Retry (it re-crashes); offer a
 *    way out to a safe route instead.
 * Both states can Report a bug (prefilled with the stacktrace) and Copy full
 * details.
 */
export const FatalErrorOverlay = () => {
	const [fatal, setFatal] = useState<FatalError | null>(() =>
		getCurrentFatalError(),
	);

	useEffect(() => subscribeFatalError(setFatal), []);

	if (!fatal) return null;

	return <FatalErrorScreen fatal={fatal} />;
};

interface FatalErrorScreenProps {
	fatal: FatalError;
	/**
	 * What Retry does for a recoverable error. The route error boundary passes
	 * TanStack's `reset`; without it, Retry reloads the page. Ignored for a
	 * non-recoverable fatal (no Retry is shown).
	 */
	onRetry?: () => void;
}

const seedFromFatal = (fatal: FatalError): BugReportSeed => ({
	errorMessage: fatal.message,
	stack: fatal.stack,
	componentStack: fatal.componentStack,
});

/**
 * Presentational screen — exported so it can be rendered directly in tests and
 * by the route-level error boundary without going through the subscription.
 */
export const FatalErrorScreen = ({ fatal, onRetry }: FatalErrorScreenProps) => {
	const [copied, setCopied] = useState(false);

	const handleReload = () => {
		window.location.reload();
	};

	const handleRetry = () => {
		if (onRetry) {
			onRetry();
			return;
		}
		handleReload();
	};

	const handleReportBug = () => {
		const url = buildGitHubIssueUrl(
			buildBugReportContext(seedFromFatal(fatal)),
		);
		window.open(url, "_blank", "noopener,noreferrer");
	};

	const handleCopyDetails = async () => {
		const details = buildBugReportDetails(
			buildBugReportContext(seedFromFatal(fatal)),
		);
		await navigator.clipboard.writeText(details);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 2000);
	};

	const description = fatal.recoverable
		? "The server returned an unexpected error. This is not your fault — nothing was saved or sent. Retry, or report a bug so we can fix it."
		: "Something went wrong and this page can't recover. This is not your fault — nothing was saved or sent. Go to your inbox, or report a bug so we can fix it.";

	return (
		<div
			role="alert"
			aria-live="assertive"
			data-testid="fatal-error-overlay"
			className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-6 bg-red-700 p-6 text-center text-white"
		>
			<AlertOctagon className="size-16 shrink-0" aria-hidden="true" />
			<div className="max-w-lg space-y-3">
				<h1 className="text-2xl font-bold tracking-tight">Something broke</h1>
				<p className="text-base text-red-50">{description}</p>
				<p className="break-words font-mono text-sm text-red-100">
					{fatal.message}
				</p>
				<p className="font-mono text-xs text-red-200">
					Reference: {fatal.correlationId}
				</p>
			</div>
			<div className="flex flex-wrap items-center justify-center gap-3">
				{fatal.recoverable ? (
					<button
						type="button"
						onClick={handleRetry}
						className="inline-flex min-h-11 items-center rounded-md bg-white px-5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
					>
						Retry
					</button>
				) : (
					<a
						href={SAFE_ROUTE}
						className="inline-flex min-h-11 items-center rounded-md bg-white px-5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
					>
						Go to inbox
					</a>
				)}
				<button
					type="button"
					onClick={handleReportBug}
					className="inline-flex min-h-11 items-center rounded-md border border-white/70 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
				>
					Report a bug
				</button>
				<button
					type="button"
					onClick={handleCopyDetails}
					className="inline-flex min-h-11 items-center rounded-md border border-white/70 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
				>
					{copied ? "Copied" : "Copy full details"}
				</button>
			</div>
		</div>
	);
};
