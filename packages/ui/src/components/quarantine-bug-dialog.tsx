import { Copy, ExternalLink } from "lucide-react";
import { Button } from "./button.js";
import { Dialog } from "./dialog.js";
import {
	formatQuarantineReport,
	type QuarantineEntry,
	quarantineIssueUrl,
} from "./quarantine-report.js";

export interface QuarantineBugDialogProps {
	entry: QuarantineEntry | null;
	onClose: () => void;
	/** Repository the issue is filed against, e.g. `https://github.com/o/r`. */
	repositoryUrl: string;
	onCopy: (report: string) => void;
}

/**
 * The report, in full, before it goes anywhere. Filing opens the user's own
 * GitHub session with the issue prefilled — Remit never posts on their behalf,
 * and nothing is sent that is not on this screen.
 */
export function QuarantineBugDialog({
	entry,
	onClose,
	repositoryUrl,
	onCopy,
}: QuarantineBugDialogProps) {
	if (!entry) return null;
	const report = formatQuarantineReport(entry);

	return (
		<Dialog open onClose={onClose} title="Report this message">
			<div className="flex max-h-[80vh] flex-col">
				<header className="space-y-1 border-b border-line px-4 py-3">
					<h3 className="text-sm font-semibold text-fg">Report this message</h3>
					<p className="text-xs text-fg-muted">
						This is everything the report contains. It describes the shape of
						the message — never its contents, addresses, subject or attachment
						names.
					</p>
				</header>
				<pre className="flex-1 overflow-auto bg-surface-sunken px-4 py-3 text-2xs leading-relaxed text-fg-muted whitespace-pre-wrap">
					{report}
				</pre>
				<footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
					<Button variant="ghost" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="secondary"
						size="sm"
						icon={<Copy className="size-3.5" />}
						onClick={() => onCopy(report)}
					>
						Copy report
					</Button>
					<a
						href={quarantineIssueUrl(entry, repositoryUrl)}
						target="_blank"
						rel="noreferrer"
						className="inline-flex h-7 items-center justify-center gap-2 rounded-md bg-accent px-2.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
					>
						<ExternalLink className="size-3.5" />
						Open on GitHub
					</a>
				</footer>
			</div>
		</Dialog>
	);
}
