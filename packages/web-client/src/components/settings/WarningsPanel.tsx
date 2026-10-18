import { configOperationsGetConfigOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapQuarantineResponse,
	RemitImapSyncWarningResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	Button,
	formatQuarantineReport,
	formatSyncWarningReport,
	MessageReportDialog,
	type QuarantineEntry,
	QuarantineSection,
	quarantineIssueTitle,
	quarantineReportSections,
	type SyncWarningEntry,
	SyncWarningSection,
	syncWarningIssueTitle,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { Bug } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { SignInAgain } from "@/auth/SignInAgain";
import { formatErrorMessage } from "@/components/ui/ErrorState";
import { useResultFolderIndex } from "@/hooks/useResultFolderIndex";
import { useWarningsList } from "@/hooks/useWarningsAttention";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";
import { isUnauthenticated } from "@/lib/error-classifier";
import { toQuarantineEntry } from "@/lib/quarantine-entries";
import type { ResultFolderIndex } from "@/lib/result-folder";
import { toSyncWarningEntry } from "@/lib/sync-warning-entries";

const EMPTY_QUARANTINE: readonly RemitImapQuarantineResponse[] = [];
const EMPTY_WARNINGS: readonly RemitImapSyncWarningResponse[] = [];

interface Reporting {
	report: string;
	issueUrl: string;
}

function openIssue(url: string): void {
	window.open(url, "_blank", "noopener,noreferrer");
}

function quarantineReporting(entry: QuarantineEntry): Reporting {
	return {
		report: formatQuarantineReport(entry),
		issueUrl: buildGitHubIssueUrl(
			buildBugReportContext({
				quarantine: quarantineReportSections(entry),
				title: quarantineIssueTitle(entry),
			}),
		),
	};
}

function syncWarningReporting(entry: SyncWarningEntry): Reporting {
	const report = formatSyncWarningReport(entry);
	return {
		report,
		issueUrl: buildGitHubIssueUrl(
			buildBugReportContext({
				syncWarning: report,
				title: syncWarningIssueTitle(entry),
			}),
		),
	};
}

function WarningsSignedOut({ signIn }: { signIn: ReactNode }) {
	return (
		<section role="alert" className="space-y-3">
			<div className="space-y-2 rounded-sm border border-danger/40 bg-danger-soft px-row-inset py-3">
				<p className="text-sm font-medium text-danger">
					Your session has ended.
				</p>
				<p className="text-sm text-fg-muted">
					Sign in again to see the messages that failed to sync or were set
					aside.
				</p>
				{signIn}
			</div>
		</section>
	);
}

function WarningsReadFailure({ error }: { error: unknown }) {
	return (
		<section role="alert" className="space-y-3">
			<div className="space-y-2 rounded-sm border border-danger/40 bg-danger-soft px-row-inset py-3">
				<p className="text-sm font-medium text-danger">
					The warnings could not be read.
				</p>
				<p className="break-words text-sm text-fg-muted">
					{formatErrorMessage(error)}
				</p>
				<p className="text-xs text-fg-muted">
					Mail may still be failing to sync or have been set aside — this page
					cannot say either way until it can read the list. Reporting this gets
					it fixed.
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

export type WarningsRead =
	| { kind: "Pending" }
	| { kind: "SignedOut" }
	| { kind: "Failed"; error: unknown }
	| {
			kind: "Ready";
			quarantine: readonly QuarantineEntry[];
			warnings: readonly SyncWarningEntry[];
			warningsTotal: number;
	  };

export interface WarningsPanelViewProps {
	read: WarningsRead;
	signIn: ReactNode;
}

export function WarningsPanelView({ read, signIn }: WarningsPanelViewProps) {
	const [reporting, setReporting] = useState<Reporting | null>(null);
	const [copyFailed, setCopyFailed] = useState(false);

	if (read.kind === "Pending") {
		return (
			<p className="animate-pulse text-sm text-fg-subtle">
				Checking for warnings…
			</p>
		);
	}

	if (read.kind === "SignedOut") return <WarningsSignedOut signIn={signIn} />;

	if (read.kind === "Failed") return <WarningsReadFailure error={read.error} />;

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
		<div className="space-y-6">
			{copyFailed && (
				<p role="alert" className="text-sm text-danger">
					The report was not copied — this browser refused clipboard access. Cut
					the bug again and use Open on GitHub, which needs no clipboard.
				</p>
			)}
			<SyncWarningSection
				entries={read.warnings}
				total={read.warningsTotal}
				onReport={(entry) => setReporting(syncWarningReporting(entry))}
			/>
			<QuarantineSection
				entries={read.quarantine}
				onCutBug={(entry) => setReporting(quarantineReporting(entry))}
			/>
			<MessageReportDialog
				report={reporting?.report ?? null}
				issueUrl={reporting?.issueUrl ?? ""}
				onClose={() => setReporting(null)}
				onCopy={handleCopy}
			/>
		</div>
	);
}

function delimiterForMailbox(
	folders: ResultFolderIndex,
	mailboxId: string,
): string {
	return folders.get(mailboxId)?.hierarchyDelimiter ?? "";
}

export function WarningsPanel() {
	const list = useWarningsList();
	const config = useQuery(configOperationsGetConfigOptions());
	const accounts = useMemo(() => config.data?.accounts ?? [], [config.data]);
	const folders = useResultFolderIndex(accounts);

	const wireQuarantine = list.data?.entries ?? EMPTY_QUARANTINE;
	const wireWarnings = list.data?.warnings ?? EMPTY_WARNINGS;
	const quarantine = useMemo(
		() =>
			wireQuarantine.map((entry) =>
				toQuarantineEntry(
					entry,
					delimiterForMailbox(folders.index, entry.mailboxId),
				),
			),
		[wireQuarantine, folders.index],
	);
	const warnings = useMemo(
		() =>
			wireWarnings.map((warning) =>
				toSyncWarningEntry(warning, folders.index.get(warning.mailboxId)),
			),
		[wireWarnings, folders.index],
	);

	const read = readOf(
		list.error ?? config.error ?? folders.error,
		list.isPending || config.isPending || folders.isPending,
		{
			kind: "Ready",
			quarantine,
			warnings,
			warningsTotal: list.data?.warningsTotal ?? 0,
		},
	);

	return <WarningsPanelView read={read} signIn={<SignInAgain />} />;
}

function readOf(
	error: unknown,
	isPending: boolean,
	ready: WarningsRead,
): WarningsRead {
	if (isUnauthenticated(error)) return { kind: "SignedOut" };
	if (error) return { kind: "Failed", error };
	if (isPending) return { kind: "Pending" };
	return ready;
}
