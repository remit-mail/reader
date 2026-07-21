import {
	CheckCircle2,
	CloudOff,
	Download,
	ExternalLink,
	Loader2,
	RotateCcw,
	TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn.js";
import { Badge } from "./badge.js";
import { Banner } from "./banner.js";
import { Button, ButtonLink } from "./button.js";
import {
	formatRelativeCheck,
	formatReleaseDate,
	type SelfUpdateState,
} from "./self-update.js";

export interface SelfUpdateSectionProps {
	state: SelfUpdateState;
	onCheck: () => void;
	/** Opens consent before anything is replaced. */
	onInstall: () => void;
	/**
	 * Clears a finished result from the pane. Required: it is the only exit
	 * from `succeeded` and `rolledBack`, and without it the pane sticks on a
	 * red failure row for good.
	 */
	onDismissResult: () => void;
	/** Fixed "now" so stories and tests read the same relative times. */
	now?: number;
}

function SectionRow({
	children,
	tone,
}: {
	children: ReactNode;
	tone?: "danger";
}) {
	return (
		<div
			className={cn(
				"rounded-sm border bg-surface px-row-inset py-3",
				tone === "danger" ? "border-danger/50" : "border-line",
			)}
		>
			{children}
		</div>
	);
}

/**
 * Updates, in Settings › Advanced.
 *
 * A mail client is read first and administered second, so an available update
 * is stated here and nowhere else — no modal, no interruption, no repeat
 * asking. Applying one is consequential (the server goes away and comes back),
 * so it is never one click from this pane.
 */
export function SelfUpdateSection({
	state,
	onCheck,
	onInstall,
	onDismissResult,
	now = Date.now(),
}: SelfUpdateSectionProps) {
	const [notice, setNotice] = useState<string | null>(null);

	const checking = state.status === "checking";
	const installable = state.status === "available";

	const handleCheck = () => {
		if (checking) {
			setNotice("Already checking. The result appears here in a moment.");
			return;
		}
		setNotice(null);
		onCheck();
	};

	const handleInstall = () => {
		if (!installable && state.status !== "rolledBack") {
			setNotice(
				"There is no update to install. Check for updates first — if one is found it appears here.",
			);
			return;
		}
		setNotice(null);
		onInstall();
	};

	const body = ((): ReactNode => {
		switch (state.status) {
			case "upToDate":
				return (
					<SectionRow>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="flex min-w-0 items-center gap-2">
								<CheckCircle2
									className="size-4 shrink-0 text-positive"
									aria-hidden
								/>
								<p className="text-sm text-fg">
									Remit {state.version} is the latest version.
									<span className="text-fg-subtle">
										{" "}
										Checked {formatRelativeCheck(state.checkedAt, now)}.
									</span>
								</p>
							</div>
							<Button
								variant="secondary"
								size="sm"
								className="shrink-0"
								onClick={handleCheck}
							>
								Check again
							</Button>
						</div>
					</SectionRow>
				);

			case "checking":
				return (
					<SectionRow>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="flex min-w-0 items-center gap-2">
								<Loader2
									className="size-4 shrink-0 animate-spin text-fg-subtle"
									aria-hidden
								/>
								<p className="text-sm text-fg-muted">
									Looking for a newer version. You are on {state.version}.
								</p>
							</div>
							<Button
								variant="secondary"
								size="sm"
								className="shrink-0"
								onClick={handleCheck}
							>
								Check again
							</Button>
						</div>
					</SectionRow>
				);

			case "checkFailed":
				return (
					<SectionRow>
						<div className="space-y-2">
							<div className="flex items-start gap-2">
								<CloudOff
									className="mt-0.5 size-4 shrink-0 text-fg-subtle"
									aria-hidden
								/>
								<div className="min-w-0 space-y-1">
									<p className="text-sm text-fg">
										Could not reach the update source.
									</p>
									<p className="text-xs text-fg-muted">{state.reason}</p>
									<p className="text-xs text-fg-subtle">
										You are still on {state.version} and it keeps working.
										{state.lastCheckedAt !== undefined && (
											<>
												{" "}
												Last successful check{" "}
												{formatRelativeCheck(state.lastCheckedAt, now)}.
											</>
										)}
									</p>
								</div>
							</div>
							<div className="flex justify-end">
								<Button variant="secondary" size="sm" onClick={handleCheck}>
									Try again
								</Button>
							</div>
						</div>
					</SectionRow>
				);

			case "available":
				return (
					<SectionRow>
						<div className="space-y-3">
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-sm font-semibold text-fg">
									Remit {state.release.version}
								</span>
								<Badge tone="accent">update available</Badge>
								<span className="text-2xs text-fg-subtle">
									released {formatReleaseDate(state.release.releasedAt)} · you
									are on {state.version}
								</span>
							</div>
							<p className="text-sm text-fg-muted">{state.release.summary}</p>
							<p className="text-xs text-fg-subtle">
								Installing restarts Remit, so mail stops loading for about a
								minute. If the new version does not come back up, the one you
								are running now is restored on its own.
							</p>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									size="sm"
									icon={<Download className="size-3.5" />}
									onClick={handleInstall}
								>
									Install {state.release.version}
								</Button>
								<ButtonLink
									variant="secondary"
									size="sm"
									external
									href={state.release.releaseNotesUrl}
									icon={<ExternalLink className="size-3.5" />}
								>
									Release notes
								</ButtonLink>
							</div>
						</div>
					</SectionRow>
				);

			case "applying":
				return (
					<SectionRow>
						<div className="flex min-w-0 items-center gap-2">
							<Loader2
								className="size-4 shrink-0 animate-spin text-accent-2"
								aria-hidden
							/>
							<p className="text-sm text-fg-muted">
								Installing Remit {state.target}. The restart screen has the
								details.
							</p>
						</div>
					</SectionRow>
				);

			case "succeeded":
				return (
					<Banner tone="success" onDismiss={onDismissResult}>
						<div className="space-y-1">
							<p className="font-semibold">Updated to Remit {state.version}.</p>
							<p>
								You were on {state.previousVersion}.{" "}
								<a
									href={state.releaseNotesUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="underline"
								>
									See what changed
								</a>
								.
							</p>
						</div>
					</Banner>
				);

			case "rolledBack":
				return (
					<SectionRow tone="danger">
						<div className="space-y-3">
							<div className="flex items-start gap-2">
								<TriangleAlert
									className="mt-0.5 size-4 shrink-0 text-danger"
									aria-hidden
								/>
								<div className="min-w-0 space-y-1">
									<p className="text-sm font-semibold text-fg">
										Remit {state.attemptedVersion} did not start. Remit reports
										that it put {state.version} back.
									</p>
									<p className="text-sm text-fg-muted">
										You are running {state.version} again. A failed update can
										still have changed things on the way — the log below is the
										only account of what it got as far as doing.
									</p>
								</div>
							</div>
							<div className="space-y-1">
								<p className="text-xs text-fg-subtle">
									What Remit reported as the failure
								</p>
								<code className="block rounded-xs bg-danger-soft px-2 py-1 text-2xs text-danger">
									{state.reason}
								</code>
							</div>
							<div className="space-y-1">
								<p className="text-xs text-fg-subtle">
									Read the full log before trying again:
								</p>
								<code className="block rounded-xs bg-surface-sunken px-2 py-1 text-2xs text-fg-muted">
									{state.logsCommand}
								</code>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									variant="secondary"
									size="sm"
									icon={<RotateCcw className="size-3.5" />}
									onClick={handleInstall}
								>
									Try {state.attemptedVersion} again
								</Button>
								<Button variant="ghost" size="sm" onClick={onDismissResult}>
									Stay on {state.version}
								</Button>
							</div>
						</div>
					</SectionRow>
				);

			case "unreachable":
				return (
					<SectionRow tone="danger">
						<div className="space-y-2">
							<div className="flex items-start gap-2">
								<TriangleAlert
									className="mt-0.5 size-4 shrink-0 text-danger"
									aria-hidden
								/>
								<div className="min-w-0 space-y-1">
									<p className="text-sm font-semibold text-fg">
										Installing {state.attemptedVersion} left the server
										unreachable.
									</p>
									<p className="text-sm text-fg-muted">
										Remit has answered again since, but nothing here can say
										what happened during the silence.
									</p>
								</div>
							</div>
							<code className="block rounded-xs bg-surface-sunken px-2 py-1 text-2xs text-fg-muted">
								{state.logsCommand}
							</code>
							<div className="flex justify-end">
								<Button variant="ghost" size="sm" onClick={onDismissResult}>
									Dismiss
								</Button>
							</div>
						</div>
					</SectionRow>
				);

			default: {
				const exhaustive: never = state;
				return exhaustive;
			}
		}
	})();

	return (
		<section className="space-y-3">
			<header className="space-y-1">
				<h2 className="text-sm font-semibold text-fg">Updates</h2>
				<p className="text-xs text-fg-muted">
					This Remit runs on your own server, so it updates when you say so.
					Your mail lives at your provider and is never touched by an update.
				</p>
			</header>

			{body}

			{notice && (
				<p role="status" className="text-xs text-fg-muted">
					{notice}
				</p>
			)}
		</section>
	);
}
