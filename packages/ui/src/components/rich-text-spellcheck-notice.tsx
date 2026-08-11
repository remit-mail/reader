import { AlertCircle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatByteSize } from "../lib/attachment-file.js";
import { languageLabel } from "../lib/compose-language.js";
import type { ProviderStatus } from "./rich-text-spellcheck.js";

/**
 * How long a dictionary may download before the composer says so. A first Dutch
 * download is 435 ms on a fast link and fourteen seconds on a bad one (#692),
 * and a composer that says nothing for fourteen seconds reads as a composer
 * with no opinion about spelling.
 */
export const SPELLCHECK_SLOW_MS = 5000;

export const SPELLCHECK_ISSUE_URL =
	"https://github.com/remit-mail/reader/issues/new";

export const spellcheckReportUrl = (
	language: string,
	detail: string,
): string => {
	const title = `Spellcheck dictionary failed to load (${language})`;
	const body = [
		`Language: ${language}`,
		`What happened: ${detail}`,
		"",
		"What I was doing:",
	].join("\n");
	return `${SPELLCHECK_ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
};

export interface RichTextSpellcheckNoticeProps {
	status: ProviderStatus;
	/** The writer cancelled the download, so nothing is coming unless they ask. */
	standDown: boolean;
	onCancel: () => void;
	onRetry: () => void;
}

const Row = ({
	tone,
	children,
}: {
	tone: "quiet" | "danger";
	children: React.ReactNode;
}) => (
	<div
		role="status"
		data-testid="spellcheck-notice"
		className={`flex items-start gap-2 border-t px-3 py-1.5 text-xs ${
			tone === "danger"
				? "border-danger/30 bg-danger-soft"
				: "border-border bg-surface-sunken"
		}`}
	>
		{children}
	</div>
);

/**
 * What the composer says while a dictionary is on its way, and when it never
 * arrives. The browser's own checker is on the whole time either way, so this
 * never claims spelling has stopped — only that ours has not started.
 *
 * Quiet for the first five seconds, because a fast link finishes inside half of
 * one and a banner that flashes on every composer open is worse than no banner.
 */
export function RichTextSpellcheckNotice({
	status,
	standDown,
	onCancel,
	onRetry,
}: RichTextSpellcheckNoticeProps) {
	const [waited, setWaited] = useState(false);
	const opening = status.state === "opening";

	useEffect(() => {
		if (!opening) {
			setWaited(false);
			return;
		}
		const timer = setTimeout(() => setWaited(true), SPELLCHECK_SLOW_MS);
		return () => clearTimeout(timer);
	}, [opening]);

	if (standDown) {
		return (
			<Row tone="quiet">
				<p className="min-w-0 flex-1 text-fg-muted">
					{languageLabel(status.language)} spelling is left to the browser.
				</p>
				<button
					type="button"
					onClick={onRetry}
					data-testid="spellcheck-retry"
					className="shrink-0 font-medium text-accent hover:underline"
				>
					Download again
				</button>
			</Row>
		);
	}

	if (status.state === "failed") {
		return (
			<Row tone="danger">
				<AlertCircle
					className="mt-0.5 size-3.5 shrink-0 text-danger"
					aria-hidden
				/>
				<div className="min-w-0 flex-1">
					<p className="font-medium text-danger">
						The {languageLabel(status.language)} dictionary did not load.
					</p>
					<p className="mt-0.5 text-fg-muted" data-testid="spellcheck-detail">
						{status.detail}. The browser is still checking your spelling.
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-3">
					<button
						type="button"
						onClick={onRetry}
						data-testid="spellcheck-retry"
						className="font-medium text-accent hover:underline"
					>
						Try again
					</button>
					<a
						href={spellcheckReportUrl(status.language, status.detail)}
						target="_blank"
						rel="noreferrer"
						data-testid="spellcheck-report"
						className="font-medium text-accent hover:underline"
					>
						Report this
					</a>
				</div>
			</Row>
		);
	}

	if (!opening || !waited) return null;

	return (
		<Row tone="quiet">
			<Loader2
				className="mt-0.5 size-3.5 shrink-0 animate-spin text-fg-subtle"
				aria-hidden
			/>
			<p className="min-w-0 flex-1 text-fg-muted">
				Downloading the {languageLabel(status.language)} dictionary
				{status.bytesTotal > 0 ? ` (${formatByteSize(status.bytesTotal)})` : ""}
				{"… "}
				<span data-testid="spellcheck-progress">
					{formatByteSize(status.bytesLoaded)} so far
				</span>
			</p>
			<button
				type="button"
				onClick={onCancel}
				data-testid="spellcheck-cancel"
				className="shrink-0 font-medium text-accent hover:underline"
			>
				Cancel
			</button>
		</Row>
	);
}
