import type { AccountService } from "./account-service-choice.js";
import { ConfirmDialog } from "./confirm-dialog.js";

/**
 * A pending change to what an account syncs. `last` is the switch that would
 * leave the account syncing nothing: no stored account holds the empty set, so
 * the way to sync nothing is to remove the account.
 */
export type AccountServiceChange =
	| { kind: "enable"; service: AccountService }
	| { kind: "disable"; service: AccountService }
	| { kind: "last"; service: AccountService };

export interface AccountServiceChangeCopy {
	title: string;
	description: string;
	confirmLabel: string;
	cancelLabel: string;
	destructive: boolean;
}

const STORED: Record<AccountService, string> = {
	Mail: "Mail already in Remit stays, and you can keep reading it.",
	Calendar: "Events already in Remit stay on your calendar.",
};

const STOPS: Record<AccountService, string> = {
	Mail: "New mail stops arriving until you turn it back on.",
	Calendar: "Changes stop arriving until you turn it back on.",
};

const NOUN: Record<AccountService, string> = {
	Mail: "mail",
	Calendar: "calendar",
};

/**
 * The words each change gets, in one place, so the dialog and the tests that
 * pin the promise read the same sentence.
 */
export function accountServiceChangeCopy(
	change: AccountServiceChange,
	providerName: string,
): AccountServiceChangeCopy {
	const noun = NOUN[change.service];

	if (change.kind === "enable") {
		return {
			title: `Sign in with ${providerName} to add ${noun}?`,
			description: `This account was never asked for ${noun} access. Remit sends you to ${providerName} to ask for it, and brings you back here when you are done. Nothing changes until you get back.`,
			confirmLabel: `Continue to ${providerName}`,
			cancelLabel: "Cancel",
			destructive: false,
		};
	}

	if (change.kind === "last") {
		return {
			title: `${change.service} is the only thing this account syncs`,
			description: `An account has to sync something. To stop this one entirely, remove the account — that deletes what Remit stored for it, which switching ${noun} off never does.`,
			confirmLabel: "Remove account",
			cancelLabel: `Keep syncing ${noun}`,
			destructive: true,
		};
	}

	return {
		title: `Stop syncing ${noun} for this account?`,
		description: `${STORED[change.service]} ${STOPS[change.service]} Nothing is deleted.`,
		confirmLabel: `Stop syncing ${noun}`,
		cancelLabel: "Cancel",
		destructive: false,
	};
}

export interface AccountServiceChangeDialogProps {
	/** The change waiting for an answer; `null` while nothing is pending. */
	change: AccountServiceChange | null;
	providerName: string;
	/** Commits the change, or leaves for the provider, or opens account removal. */
	onConfirm: () => void;
	onCancel: () => void;
	/** Disables the confirm button while the host's mutation is in flight. */
	isBusy?: boolean;
}

/**
 * The confirmation between a service switch and the change it asks for (#1179).
 *
 * Switching a service off says what stays and what stops, because a person only
 * believes disabling deletes nothing if the screen says so. Switching one on
 * names the sign-in round trip before they commit, because the scopes come from
 * the authorization request and no saved setting can grant them.
 */
export function AccountServiceChangeDialog({
	change,
	providerName,
	onConfirm,
	onCancel,
	isBusy,
}: AccountServiceChangeDialogProps) {
	if (change === null) return null;
	const copy = accountServiceChangeCopy(change, providerName);
	return (
		<ConfirmDialog
			isOpen
			title={copy.title}
			description={copy.description}
			confirmLabel={copy.confirmLabel}
			cancelLabel={copy.cancelLabel}
			destructive={copy.destructive}
			isBusy={isBusy ?? false}
			onConfirm={onConfirm}
			onCancel={onCancel}
		/>
	);
}
