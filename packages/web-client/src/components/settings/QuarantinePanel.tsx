/**
 * Settings › Advanced — the messages sync set aside.
 *
 * A quarantined message exists on the server and nowhere else in the app, so
 * this pane is the only place it is ever mentioned. Three states are all
 * visible: the list, the reassurance that there is nothing in it, and the
 * failure to read it at all. None of them is an empty panel.
 */
import { meOperationsListQuarantineOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	Button,
	QuarantineBugDialog,
	type QuarantineEntry,
	QuarantineSection,
	quarantineIssueTitle,
	quarantineReportSections,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { Bug } from "lucide-react";
import { useState } from "react";
import { formatErrorMessage } from "@/components/ui/ErrorState";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";
import { toQuarantineEntry } from "@/lib/quarantine-entries";

function openIssue(url: string): void {
	window.open(url, "_blank", "noopener,noreferrer");
}

function issueUrlFor(entry: QuarantineEntry): string {
	return buildGitHubIssueUrl(
		buildBugReportContext({
			quarantine: quarantineReportSections(entry),
			title: quarantineIssueTitle(entry),
		}),
	);
}

function QuarantineReadFailure({ error }: { error: Error }) {
	return (
		<section role="alert" className="space-y-3">
			<h2 className="text-sm font-semibold text-fg">Messages set aside</h2>
			<div className="space-y-2 rounded-sm border border-danger/40 bg-danger-soft px-row-inset py-3">
				<p className="text-sm font-medium text-danger">
					The list of set-aside messages could not be read.
				</p>
				<p className="break-words text-sm text-fg-muted">
					{formatErrorMessage(error)}
				</p>
				<p className="text-xs text-fg-muted">
					Mail may still have been set aside — this page cannot say either way
					until it can read the list. Reporting this gets it fixed.
				</p>
				<Button
					variant="secondary"
					size="sm"
					icon={<Bug className="size-3.5" />}
					onClick={() =>
						openIssue(buildGitHubIssueUrl(buildBugReportContext()))
					}
				>
					Report this
				</Button>
			</div>
		</section>
	);
}

export interface QuarantinePanelViewProps {
	entries: readonly QuarantineEntry[];
	isPending: boolean;
	error: Error | null;
}

export function QuarantinePanelView({
	entries,
	isPending,
	error,
}: QuarantinePanelViewProps) {
	const [reporting, setReporting] = useState<QuarantineEntry | null>(null);
	const [copyFailed, setCopyFailed] = useState(false);

	if (isPending) {
		return (
			<p className="animate-pulse text-sm text-fg-subtle">
				Checking for messages set aside…
			</p>
		);
	}

	if (error) return <QuarantineReadFailure error={error} />;

	const handleCopy = (report: string) => {
		navigator.clipboard.writeText(report).then(
			() => {
				setCopyFailed(false);
				setReporting(null);
			},
			() => {
				setCopyFailed(true);
				setReporting(null);
			},
		);
	};

	return (
		<>
			{copyFailed && (
				<p role="alert" className="mb-3 text-sm text-danger">
					The report was not copied — this browser refused clipboard access. Cut
					the bug again and use Open on GitHub, which needs no clipboard.
				</p>
			)}
			<QuarantineSection entries={entries} onCutBug={setReporting} />
			<QuarantineBugDialog
				entry={reporting}
				issueUrl={reporting ? issueUrlFor(reporting) : ""}
				onClose={() => setReporting(null)}
				onCopy={handleCopy}
			/>
		</>
	);
}

export function QuarantinePanel() {
	const { data, isPending, error } = useQuery(
		meOperationsListQuarantineOptions(),
	);

	return (
		<QuarantinePanelView
			entries={(data?.entries ?? []).map(toQuarantineEntry)}
			isPending={isPending}
			error={error}
		/>
	);
}
