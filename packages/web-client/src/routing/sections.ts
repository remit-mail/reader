import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

/**
 * A top-level destination, as the sidebar and the keyboard name it. These are
 * the moves that leave whatever the reader is on rather than open something
 * under it, so they carry no panels and no query.
 */
export type AppSection =
	| "brief"
	| "flagged"
	| "outbox"
	| "settings"
	| "accounts"
	| "importConfig";

const sectionRoute = {
	brief: "/mail/brief",
	flagged: "/mail/flagged",
	outbox: "/mail/outbox",
	settings: "/settings",
	accounts: "/settings/accounts",
	importConfig: "/import",
} as const satisfies Record<AppSection, string>;

/** Go to a top-level section by name, so no caller writes a path. */
export function useGoToSection(): (section: AppSection) => void {
	const navigate = useNavigate();
	return useCallback(
		(section: AppSection) => {
			navigate({ to: sectionRoute[section] });
		},
		[navigate],
	);
}

/**
 * Open one account's settings on its outgoing-mail fields.
 *
 * The account and the field to land on ride the address, so the banner that
 * sends the reader there is not also responsible for telling the settings pane
 * what it was about.
 */
export function useConfigureAccountSmtp(): (accountId: string) => void {
	const navigate = useNavigate();
	return useCallback(
		(accountId: string) => {
			navigate({
				to: "/settings/accounts",
				search: { editAccountId: accountId, focusSmtp: true },
			});
		},
		[navigate],
	);
}
