import { useId } from "react";
import { cn } from "../lib/cn.js";
import {
	ACCOUNT_SERVICE_ROWS,
	type AccountService,
} from "./account-service-choice.js";

/**
 * A service switch on the account settings screen. The host never flips one on
 * its own: every press asks, because switching mail off stops a sync and
 * switching a service on the consent never covered leaves for the provider.
 */
export type AccountServiceIntent = "on" | "off";

export interface AccountServiceTogglesProps {
	/** Provider named in the consent note, e.g. "Microsoft". */
	providerName: string;
	/** Services this account's connector carries. Under two, nothing renders. */
	offered: AccountService[];
	/** Services the account syncs today. */
	enabled: AccountService[];
	/** Services the account's grant already covers. The rest cost a sign-in. */
	consented: AccountService[];
	/** Asks the host for a change. The host confirms before it commits. */
	onRequestChange: (
		service: AccountService,
		intent: AccountServiceIntent,
	) => void;
}

function ServiceSwitch({
	checked,
	label,
	describedBy,
	onToggle,
}: {
	checked: boolean;
	label: string;
	describedBy: string;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			aria-describedby={describedBy}
			onClick={onToggle}
			className={cn(
				"relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
				"outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
				checked
					? "border-positive bg-positive"
					: "border-line-strong bg-surface-sunken",
			)}
		>
			<span
				aria-hidden
				className={cn(
					"size-4 rounded-full bg-canvas transition-transform",
					checked ? "translate-x-6" : "translate-x-1",
				)}
			/>
		</button>
	);
}

/**
 * What an account syncs, on the account settings screen (#1179). One switch per
 * service the connector carries, mail first.
 *
 * An IMAP account carries mail and nothing else, so it gets no switches at all
 * rather than one it can never move — the same rule the onboarding choice
 * follows for a single-service provider.
 */
export function AccountServiceToggles({
	providerName,
	offered,
	enabled,
	consented,
	onRequestChange,
}: AccountServiceTogglesProps) {
	const groupId = useId();
	const rows = ACCOUNT_SERVICE_ROWS.filter((row) => offered.includes(row.id));

	if (rows.length < 2) return null;

	return (
		<fieldset>
			<legend className="text-sm font-semibold text-fg">
				What this account syncs
			</legend>
			<div className="mt-1 divide-y divide-line">
				{rows.map((row) => {
					const on = enabled.includes(row.id);
					const noteId = `${groupId}-${row.id}`;
					const needsConsent = !on && !consented.includes(row.id);
					return (
						<div
							key={row.id}
							className="flex min-h-11 items-center gap-3 py-2 text-left"
						>
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="text-sm text-fg">{row.label}</span>
								<span id={noteId} className="text-xs text-fg-subtle">
									{needsConsent
										? `${row.description} Turning this on means signing in with ${providerName} again.`
										: row.description}
								</span>
							</span>
							<ServiceSwitch
								checked={on}
								label={`Sync ${row.label.toLowerCase()}`}
								describedBy={noteId}
								onToggle={() => onRequestChange(row.id, on ? "off" : "on")}
							/>
						</div>
					);
				})}
			</div>
		</fieldset>
	);
}
