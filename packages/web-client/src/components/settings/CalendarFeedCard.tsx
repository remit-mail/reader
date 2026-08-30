/**
 * Settings › Calendars: one calendar's secret subscription address (#1067).
 *
 * Presentational. Every state the server can put this control in is drawn —
 * the read still out, the read refused, not shared, shared, and the one moment
 * the address is legible — because a control that renders nothing for one of
 * them is indistinguishable from a calendar that cannot be shared at all.
 */
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHeader,
	CardTitle,
	ConfirmDialog,
} from "@remit/ui";
import { Check, Copy, Link2, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { ErrorState, formatErrorMessage } from "@/components/ui/ErrorState";
import type { CalendarFeedState } from "@/hooks/calendar/useCalendarFeed";
import {
	revokeFeedConfirmCopy,
	rotateFeedConfirmCopy,
} from "@/lib/calendar-feed-copy";
import { formatDatePreset } from "@/lib/format";

export interface CalendarFeedCardProps {
	calendarName: string;
	state: CalendarFeedState;
	/** The address just minted, shown once. Empty at every other moment. */
	mintedUrl: string;
	isBusy: boolean;
	/** A create, rotate or revoke the server turned down. */
	actionError: unknown;
	onMint: () => void;
	onRevoke: () => void;
	onDismissMinted: () => void;
	onRetry: () => void;
}

type Pending = "none" | "rotate" | "revoke";

function MintedAddress({
	calendarName,
	url,
	onDismiss,
}: {
	calendarName: string;
	url: string;
	onDismiss: () => void;
}) {
	const [copied, setCopied] = useState(false);
	const [copyFailed, setCopyFailed] = useState(false);

	const copy = () => {
		navigator.clipboard
			.writeText(url)
			.then(() => {
				setCopyFailed(false);
				setCopied(true);
				window.setTimeout(() => setCopied(false), 2000);
			})
			.catch(() => setCopyFailed(true));
	};

	return (
		<div className="mt-3 space-y-2 rounded-sm border border-accent-2/40 bg-accent-2/10 px-3 py-2.5">
			<p className="text-sm font-medium text-fg">
				Subscribe with this address. It is shown once and cannot be read back.
			</p>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				<input
					readOnly
					value={url}
					aria-label={`Subscription address for ${calendarName}`}
					onFocus={(event) => event.currentTarget.select()}
					className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg"
				/>
				<Button
					variant="primary"
					size="sm"
					icon={
						copied ? (
							<Check className="size-3.5" />
						) : (
							<Copy className="size-3.5" />
						)
					}
					onClick={copy}
				>
					{copied ? "Copied" : "Copy address"}
				</Button>
			</div>
			{copyFailed && (
				<Banner tone="warning" variant="soft">
					The address could not be copied to the clipboard. Select it above and
					copy it by hand before leaving this page.
				</Banner>
			)}
			<p className="text-xs text-fg-muted">
				Anyone holding this address can read every event in this calendar,
				without signing in. Rotate it if it reaches the wrong person.
			</p>
			<Button variant="ghost" size="sm" onClick={onDismiss}>
				I've saved it
			</Button>
		</div>
	);
}

function ActiveFeed({
	createdAt,
	rotatedAt,
	isBusy,
	onRotate,
	onRevoke,
}: {
	createdAt: number;
	rotatedAt: number;
	isBusy: boolean;
	onRotate: () => void;
	onRevoke: () => void;
}) {
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center gap-2">
				<Badge tone="positive">shared</Badge>
				<span className="text-xs text-fg-muted">
					Address created {formatDatePreset(createdAt, "medium")}
					{rotatedAt > 0
						? `, last replaced ${formatDatePreset(rotatedAt, "medium")}`
						: ""}
				</span>
			</div>
			<p className="text-sm text-fg-muted">
				The address itself is not stored in readable form, so it cannot be shown
				again. Replace it if you no longer know where it went.
			</p>
			<div className="flex flex-wrap gap-2">
				<Button
					variant="secondary"
					size="sm"
					disabled={isBusy}
					icon={<RefreshCw className="size-3.5" />}
					onClick={onRotate}
				>
					Replace address
				</Button>
				<Button
					variant="danger"
					size="sm"
					disabled={isBusy}
					icon={<Trash2 className="size-3.5" />}
					onClick={onRevoke}
				>
					Stop sharing
				</Button>
			</div>
		</div>
	);
}

export function CalendarFeedCard({
	calendarName,
	state,
	mintedUrl,
	isBusy,
	actionError,
	onMint,
	onRevoke,
	onDismissMinted,
	onRetry,
}: CalendarFeedCardProps) {
	const [pending, setPending] = useState<Pending>("none");

	const confirm = () => {
		const action = pending;
		setPending("none");
		if (action === "rotate") onMint();
		if (action === "revoke") onRevoke();
	};

	const copy =
		pending === "revoke"
			? revokeFeedConfirmCopy(calendarName)
			: rotateFeedConfirmCopy(calendarName);

	return (
		<Card className="max-w-xl">
			<CardHeader>
				<CardTitle>{calendarName}</CardTitle>
			</CardHeader>
			<CardBody>
				{state.status === "loading" && (
					// biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label on a loading skeleton is what assistive tech has to go on
					<div
						className="h-12 animate-pulse rounded-sm bg-surface-sunken"
						aria-busy="true"
						aria-label={`Loading the subscription address for ${calendarName}`}
					/>
				)}

				{state.status === "unreadable" && (
					<ErrorState
						variant="inline"
						title={`Couldn't read whether ${calendarName} is shared`}
						error={state.error}
						onRetry={onRetry}
					/>
				)}

				{state.status === "absent" && (
					<div className="space-y-2">
						<p className="text-sm text-fg-muted">
							Give this calendar a secret address and Apple Calendar, Google
							Calendar, Outlook and Thunderbird can subscribe to it read-only.
							Nobody signs in — the address is the credential, so treat it like
							a password.
						</p>
						<Button
							variant="primary"
							size="sm"
							disabled={isBusy}
							icon={<Link2 className="size-3.5" />}
							onClick={onMint}
						>
							{isBusy ? "Creating…" : "Create subscription address"}
						</Button>
					</div>
				)}

				{state.status === "active" && (
					<ActiveFeed
						createdAt={state.createdAt}
						rotatedAt={state.rotatedAt}
						isBusy={isBusy}
						onRotate={() => setPending("rotate")}
						onRevoke={() => setPending("revoke")}
					/>
				)}

				{actionError !== undefined && actionError !== null && (
					<Banner tone="danger" variant="soft" className="mt-3">
						<p className="font-medium">
							The subscription address for {calendarName} was not changed.
						</p>
						<p className="mt-0.5 break-words">
							{formatErrorMessage(actionError)}
						</p>
					</Banner>
				)}

				{mintedUrl !== "" && (
					<MintedAddress
						calendarName={calendarName}
						url={mintedUrl}
						onDismiss={onDismissMinted}
					/>
				)}
			</CardBody>

			<ConfirmDialog
				isOpen={pending !== "none"}
				title={copy.title}
				description={copy.description}
				confirmLabel={pending === "revoke" ? "Stop sharing" : "Replace address"}
				destructive
				isBusy={isBusy}
				onConfirm={confirm}
				onCancel={() => setPending("none")}
			/>
		</Card>
	);
}
