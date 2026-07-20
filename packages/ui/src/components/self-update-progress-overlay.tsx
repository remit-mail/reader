import { AlertOctagon, Check, Loader2 } from "lucide-react";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";
import {
	type UpdatePhase,
	updatePhaseLabel,
	updateWaitNote,
} from "./self-update.js";

const phaseOrder: UpdatePhase[] = ["preparing", "restarting", "reconnecting"];

export interface SelfUpdateProgressOverlayProps {
	target: string;
	phase: UpdatePhase;
	elapsedSeconds: number;
}

/**
 * Applying an update takes the server away, so the app genuinely cannot be
 * used while it runs. Blocking here is the honest state — a background spinner
 * over a dead mailbox would let a broken system look healthy.
 */
export function SelfUpdateProgressOverlay({
	target,
	phase,
	elapsedSeconds,
}: SelfUpdateProgressOverlayProps) {
	const activeIndex = phaseOrder.indexOf(phase);

	return (
		<div
			role="status"
			aria-live="polite"
			className="absolute inset-0 z-[1000] flex flex-col items-center justify-center gap-6 bg-canvas p-6 text-center"
		>
			<div className="max-w-md space-y-2">
				<h1 className="text-lg font-semibold text-fg">
					Installing Remit {target}
				</h1>
				<p className="text-sm text-fg-muted">
					Remit is restarting, so this page has no server to talk to for a
					moment. Leave this open — it reconnects on its own.
				</p>
			</div>

			<ol className="w-full max-w-sm space-y-2 text-left">
				{phaseOrder.map((step, index) => {
					const done = index < activeIndex;
					const active = index === activeIndex;
					return (
						<li
							key={step}
							className={cn(
								"flex items-center gap-3 rounded-sm border px-row-inset py-2 text-sm",
								active
									? "border-line-strong bg-surface text-fg"
									: "border-line bg-surface-sunken text-fg-subtle",
							)}
						>
							{done ? (
								<Check className="size-4 shrink-0 text-positive" aria-hidden />
							) : active ? (
								<Loader2
									className="size-4 shrink-0 animate-spin text-accent-2"
									aria-hidden
								/>
							) : (
								<span className="size-4 shrink-0 rounded-full border border-line-strong" />
							)}
							{updatePhaseLabel(step)}
						</li>
					);
				})}
			</ol>

			<p className="max-w-md text-xs text-fg-subtle">
				{updateWaitNote(elapsedSeconds)}
			</p>
		</div>
	);
}

export interface SelfUpdateUnreachableScreenProps {
	attemptedVersion: string;
	previousVersion: string;
	elapsedSeconds: number;
	logsCommand: string;
	onRetryConnection: () => void;
}

/**
 * The server never came back. The client cannot tell whether the rollback ran,
 * so it must not claim that it did — it says what it knows, what it does not,
 * and where to look on the machine that is still running.
 */
export function SelfUpdateUnreachableScreen({
	attemptedVersion,
	previousVersion,
	elapsedSeconds,
	logsCommand,
	onRetryConnection,
}: SelfUpdateUnreachableScreenProps) {
	const minutes = Math.max(1, Math.round(elapsedSeconds / 60));

	return (
		<div
			role="alert"
			className="absolute inset-0 z-[1000] flex flex-col items-center justify-center gap-6 bg-canvas p-6 text-center"
		>
			<AlertOctagon className="size-12 shrink-0 text-danger" aria-hidden />
			<div className="max-w-lg space-y-3">
				<h1 className="text-lg font-semibold text-fg">
					Remit has not answered since the restart
				</h1>
				<p className="text-sm text-fg-muted">
					Installing {attemptedVersion} started {minutes} minute
					{minutes === 1 ? "" : "s"} ago and the server has been silent since.
					Your mail is safe at your provider — it was never part of the update.
				</p>
				<p className="text-sm text-fg-muted">
					Remit rolls back to {previousVersion} on its own when the new version
					fails to start, but this page cannot confirm that from here. Check the
					server directly:
				</p>
				<code className="block rounded-xs bg-surface-sunken px-3 py-2 text-left text-xs text-fg-muted">
					{logsCommand}
				</code>
			</div>
			<div className="flex flex-wrap items-center justify-center gap-2">
				<Button size="sm" onClick={onRetryConnection}>
					Try connecting again
				</Button>
			</div>
		</div>
	);
}
