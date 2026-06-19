import { AlertOctagon } from "lucide-react";
import { useEffect, useState } from "react";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";
import {
	type FatalError,
	getCurrentFatalError,
	subscribeFatalError,
} from "@/lib/fatal-error";

/**
 * The full-screen red escalation page. A first-party 5xx (or any other fatal
 * server failure) routed through `reportFatalError` takes over the entire
 * viewport here — loud, red, impossible to miss. It is never a benign grey
 * label.
 *
 * It is intentionally NOT dismissible: a fatal means the app is in an unknown
 * state. The user reloads, or files a bug.
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
}

/**
 * Presentational screen — exported so it can be rendered directly in tests and
 * by the route-level error boundary without going through the subscription.
 */
export const FatalErrorScreen = ({ fatal }: FatalErrorScreenProps) => {
	const handleReload = () => {
		window.location.reload();
	};

	const handleReportBug = () => {
		const url = buildGitHubIssueUrl(buildBugReportContext());
		window.open(url, "_blank", "noopener,noreferrer");
	};

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
				<p className="text-base text-red-50">
					The server returned an unexpected error. This is not your fault —
					nothing was saved or sent. Reload to try again, or report a bug so we
					can fix it.
				</p>
				<p className="break-words font-mono text-sm text-red-100">
					{fatal.message}
				</p>
				<p className="font-mono text-xs text-red-200">
					Reference: {fatal.correlationId}
				</p>
			</div>
			<div className="flex flex-wrap items-center justify-center gap-3">
				<button
					type="button"
					onClick={handleReload}
					className="inline-flex min-h-11 items-center rounded-md bg-white px-5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
				>
					Reload
				</button>
				<button
					type="button"
					onClick={handleReportBug}
					className="inline-flex min-h-11 items-center rounded-md border border-white/70 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
				>
					Report a bug
				</button>
			</div>
		</div>
	);
};
