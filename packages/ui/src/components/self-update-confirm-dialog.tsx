import { Download, ExternalLink } from "lucide-react";
import { Button, ButtonLink } from "./button.js";
import { Dialog } from "./dialog.js";
import { formatReleaseDate, type ReleaseInfo } from "./self-update.js";

export interface SelfUpdateConfirmDialogProps {
	open: boolean;
	currentVersion: string;
	release: ReleaseInfo;
	onClose: () => void;
	onConfirm: () => void;
}

const consequences = [
	"Remit restarts. Mail stops loading for about a minute and this page will lose its connection while that happens.",
	"Nothing is sent, deleted or moved. Your mail stays at your provider.",
	"If the new version does not come back up, the version you are running now is restored automatically.",
];

/**
 * Consent before the server replaces itself. Reflects what will happen in the
 * user's terms, in the order they will feel it, and leaves the way back open
 * until the moment they commit.
 */
export function SelfUpdateConfirmDialog({
	open,
	currentVersion,
	release,
	onClose,
	onConfirm,
}: SelfUpdateConfirmDialogProps) {
	if (!open) return null;

	return (
		<Dialog open onClose={onClose} title={`Install Remit ${release.version}`}>
			<div className="flex max-h-[80vh] flex-col">
				<header className="space-y-1 border-b border-line px-4 py-3">
					<h3 className="text-sm font-semibold text-fg">
						Install Remit {release.version}?
					</h3>
					<p className="text-xs text-fg-muted">
						You are on {currentVersion}. {release.version} was released{" "}
						{formatReleaseDate(release.releasedAt)}.
					</p>
				</header>

				<div className="flex-1 space-y-3 overflow-auto px-4 py-3">
					<p className="text-sm text-fg-muted">{release.summary}</p>
					<ul className="space-y-2">
						{consequences.map((line) => (
							<li key={line} className="flex gap-2 text-sm text-fg-muted">
								<span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-fg-subtle" />
								<span>{line}</span>
							</li>
						))}
					</ul>
					<p className="text-xs text-fg-subtle">
						Good moment for this: when you are not waiting on a message.
					</p>
				</div>

				<footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
					<Button variant="ghost" size="sm" onClick={onClose}>
						Not now
					</Button>
					<ButtonLink
						variant="secondary"
						size="sm"
						external
						href={release.releaseNotesUrl}
						icon={<ExternalLink className="size-3.5" />}
					>
						Release notes
					</ButtonLink>
					<Button
						size="sm"
						icon={<Download className="size-3.5" />}
						onClick={onConfirm}
					>
						Install and restart
					</Button>
				</footer>
			</div>
		</Dialog>
	);
}
