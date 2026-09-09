/**
 * Settings › Advanced: the two halves of moving a configuration between
 * instances (#1021). Export writes the file this instance is set up with;
 * import reads one back in through the wizard.
 *
 * A failed export says so where the button is. A dead download control is the
 * worse outcome: the reader cannot tell whether it saved, whether it is broken,
 * or whether they missed something.
 */

import {
	Badge,
	Button,
	Card,
	CardBody,
	CardHeader,
	CardTitle,
} from "@remit/ui";
import { Download, FileJson, Loader2 } from "lucide-react";

export interface ConfigExportCardProps {
	fileName: string;
	state?: "ready" | "downloading" | "failed";
	/** The server's own words, kept for a bug report. */
	error?: string;
	onDownload?: () => void;
	onImport?: () => void;
}

export function ConfigExportCard({
	fileName,
	state = "ready",
	error,
	onDownload,
	onImport,
}: ConfigExportCardProps) {
	const downloading = state === "downloading";
	return (
		<Card className="max-w-xl">
			<CardHeader>
				<CardTitle>Configuration file</CardTitle>
			</CardHeader>
			<CardBody>
				<p className="text-sm text-fg-muted">
					One versioned JSON document carrying every setting this instance
					holds: accounts and their servers, folder roles, rules, labels,
					flagged senders and appearance. No passwords and no OAuth tokens — you
					sign in again wherever you import it.
				</p>
				{state === "failed" && (
					<div className="mt-3 space-y-2 rounded-sm border border-danger/40 bg-danger-soft px-3 py-2.5">
						<p className="text-sm font-medium text-danger">
							The config file could not be written.
						</p>
						<p className="text-xs text-fg-muted">
							Nothing was downloaded. Try again — if it keeps failing, use{" "}
							<code className="rounded bg-surface-sunken px-1 py-0.5">
								remit config save
							</code>{" "}
							on the host in the meantime.
						</p>
						{error && (
							<code className="block rounded bg-surface-sunken px-2.5 py-2 text-2xs text-fg-muted">
								{error}
							</code>
						)}
					</div>
				)}
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<Button
						variant="secondary"
						size="sm"
						disabled={downloading}
						icon={
							downloading ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<Download className="size-3.5" />
							)
						}
						onClick={onDownload}
					>
						{downloading ? "Preparing…" : `Download ${fileName}`}
					</Button>
					<Badge tone="neutral">no passwords</Badge>
				</div>
				<p className="mt-3 text-2xs text-fg-subtle">
					On the host, the same file comes from{" "}
					<code className="rounded bg-surface-sunken px-1 py-0.5">
						remit config save ~/{fileName}
					</code>
					.
				</p>
				<div className="mt-5 border-t border-line pt-4">
					<p className="text-sm font-medium text-fg">Import a config file</p>
					<p className="mt-1 text-sm text-fg-muted">
						Read a file from another Reader into this one. It shows what will
						change before anything is written, and asks for each account's
						credentials afterwards.
					</p>
					<Button
						className="mt-3"
						variant="secondary"
						size="sm"
						icon={<FileJson className="size-3.5" />}
						onClick={onImport}
					>
						Import a config file
					</Button>
				</div>
			</CardBody>
		</Card>
	);
}
