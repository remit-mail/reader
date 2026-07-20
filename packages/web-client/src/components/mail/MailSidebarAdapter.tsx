import {
	mailboxOperationsListMailboxesOptions,
	outboxOperationsListOutboxMessagesOptions,
	threadOperationsListThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { NavAccount, NavLinkComponent, NavMailboxRole } from "@remit/ui";
import { NavSidebar } from "@remit/ui";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Link,
	useLocation,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	buildMailboxRoleMap,
	labelForMailbox,
	shouldShowUnreadBadgeForRole,
} from "@/lib/folder-roles";
import { useMailContext } from "@/lib/mail-context";
import { isOutboxListRow } from "@/lib/outbox-status";
import {
	loadSavedSearches,
	removeSavedSearch,
	saveSearch,
} from "@/lib/saved-searches";

interface MailSidebarAdapterProps {
	accounts: RemitImapAccountResponse[];
	/**
	 * Fires after the user selects a mailbox entry. The mobile drawer wires this
	 * to close itself on selection (#199). Desktop callers omit it.
	 */
	onMailboxSelect?: () => void;
	/**
	 * "desktop" (default) wraps the nav in a full-height aside — Pane 1 of the
	 * 4-pane shell. "drawer" renders the nav body only so the mobile Drawer
	 * panel can pin a settings footer below it (#685).
	 */
	variant?: "desktop" | "drawer";
}

type Translator = (key: string, fallback: string) => string;

const startsWithDigit = (str: string): boolean => /^\d/.test(str);

const compareLabelNames = (a: string, b: string): number => {
	const aStartsWithDigit = startsWithDigit(a);
	const bStartsWithDigit = startsWithDigit(b);
	if (aStartsWithDigit && !bStartsWithDigit) return -1;
	if (!aStartsWithDigit && bStartsWithDigit) return 1;
	return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
};

/**
 * Split a mailbox list into pinned system rows and alpha-sorted plain
 * folders. RFC 032 exclusive-folder-appointment (#976): "system" now means
 * "appointed to a role in this account's folderAppointments map" — nothing is
 * deduped here, because two folders can never share a role by construction.
 * The kit re-pins/orders system rows by role itself; the adapter only needs
 * to alpha-order the folders.
 */
function sortMailboxes(
	mailboxes: RemitImapMailboxResponse[],
	roleMap: Map<string, NavMailboxRole>,
	t: Translator,
): {
	system: RemitImapMailboxResponse[];
	labels: RemitImapMailboxResponse[];
} {
	const system: RemitImapMailboxResponse[] = [];
	const labels: RemitImapMailboxResponse[] = [];

	for (const mailbox of mailboxes) {
		if (roleMap.has(mailbox.mailboxId)) {
			system.push(mailbox);
		} else {
			labels.push(mailbox);
		}
	}

	labels.sort((a, b) =>
		compareLabelNames(
			labelForMailbox(a, undefined, t),
			labelForMailbox(b, undefined, t),
		),
	);

	return { system, labels };
}

/**
 * Convert an API mailbox to a NavMailbox for the kit: `role` comes from the
 * account's folder-role map (RFC 032 exclusive-folder-appointment, #976), the
 * label follows `displayNameOverride` then the role's canonical name then the
 * provider leaf, and the badge follows the role.
 */
function toNavMailbox(
	mb: RemitImapMailboxResponse,
	role: NavMailboxRole | undefined,
	t: Translator,
) {
	const showBadge = shouldShowUnreadBadgeForRole(role) && mb.unseenCount > 0;
	return {
		id: mb.mailboxId,
		name: labelForMailbox(mb, role, t),
		unseen: showBadge ? mb.unseenCount : undefined,
		role,
		fullPath: mb.fullPath,
	};
}

/**
 * Resolves the currently selected nav ID from the active route so the kit
 * component can highlight the right item.
 *   - /mail/outbox → "outbox"
 *   - /mail/flagged → "flagged"
 *   - /mail/$mailboxId → mailboxId
 *   - /mail (daily brief) → "brief"
 */
function useSelectedNavId(): string {
	const location = useLocation();
	const params = useParams({ strict: false }) as { mailboxId?: string };

	if (location.pathname.startsWith("/mail/outbox")) return "outbox";
	if (location.pathname.startsWith("/mail/flagged")) return "flagged";
	if (params.mailboxId) return params.mailboxId;
	if (location.pathname === "/mail" || location.pathname === "/mail/")
		return "brief";
	return "";
}

/**
 * Pane 1 of the 4-pane shell. Data bridge that fetches mailboxes per account,
 * maps them onto the kit's NavAccount shape, and renders each entry as a real
 * router anchor via the kit's `linkComponent` render-prop. Replaces the retired
 * local MailSidebar (#898).
 */
export function MailSidebarAdapter({
	accounts,
	onMailboxSelect,
	variant = "desktop",
}: MailSidebarAdapterProps) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const selectedNavId = useSelectedNavId();
	const { searchInput, onSearchChange } = useMailContext();
	const [savedSearches, setSavedSearches] = useState(loadSavedSearches);
	const { t } = useTranslation("mail", { useSuspense: false });
	const translator: Translator = useCallback(
		(key, fallback) => t(key, { defaultValue: fallback }),
		[t],
	);

	const mailboxQueries = useQueries({
		queries: accounts.map((account) => ({
			...mailboxOperationsListMailboxesOptions({
				path: { accountId: account.accountId },
			}),
			// Mailboxes change rarely; cache forever, rely on explicit invalidation.
			staleTime: Infinity,
		})),
	});

	const { data: outboxResponse } = useQuery(
		outboxOperationsListOutboxMessagesOptions(),
	);

	const outboxPendingCount = useMemo(
		() =>
			(outboxResponse?.items ?? []).filter((item) =>
				isOutboxListRow(item.status),
			).length,
		[outboxResponse?.items],
	);

	const navAccounts: NavAccount[] = useMemo(() => {
		return accounts.map((account, i) => {
			const query = mailboxQueries[i];
			const mailboxes = query?.data?.items ?? [];
			const roleMap = buildMailboxRoleMap(account.folderAppointments);
			const { system, labels } = sortMailboxes(mailboxes, roleMap, translator);

			const status: NavAccount["status"] = query?.isError
				? "error"
				: query?.isLoading
					? "loading"
					: "ready";

			return {
				id: account.accountId,
				label: account.email,
				email: account.email,
				muted: Boolean(account.muted),
				// Outbox is a shared singleton shown inside each account's section,
				// matching existing sidebar behaviour.
				outboxPending: outboxPendingCount,
				status,
				onRetry: () => query?.refetch(),
				mailboxes: [...system, ...labels].map((mb) =>
					toNavMailbox(mb, roleMap.get(mb.mailboxId), translator),
				),
			};
		});
	}, [accounts, mailboxQueries, outboxPendingCount, translator]);

	// Invalidate a mailbox's thread list on navigation so a re-visit always
	// fetches fresh data (mirrors the retired MailboxItem behaviour).
	const invalidateMailboxThreads = (mailboxId: string) => {
		queryClient.invalidateQueries({
			queryKey: threadOperationsListThreadsQueryKey({
				path: { mailboxId },
				query: { order: "desc" },
			}),
		});
	};

	const linkComponent: NavLinkComponent = ({
		navId,
		className,
		ariaLabel,
		title,
		children,
		onClick,
	}) => {
		if (navId === "brief") {
			return (
				<Link
					to="/mail"
					search={{ q: undefined, selectedMessageId: undefined }}
					onClick={() => onClick?.()}
					className={className}
					aria-label={ariaLabel}
					title={title}
				>
					{children}
				</Link>
			);
		}
		if (navId === "outbox") {
			return (
				<Link
					to="/mail/outbox"
					search={{ q: undefined, selectedOutboxMessageId: undefined }}
					onClick={() => onClick?.()}
					className={className}
					aria-label={ariaLabel}
					title={title}
				>
					{children}
				</Link>
			);
		}
		if (navId === "flagged") {
			return (
				<Link
					to="/mail/flagged"
					search={{ q: undefined, selectedMessageId: undefined }}
					onClick={() => onClick?.()}
					className={className}
					aria-label={ariaLabel}
					title={title}
				>
					{children}
				</Link>
			);
		}
		return (
			<Link
				to="/mail/$mailboxId"
				params={{ mailboxId: navId }}
				// Drop any stale search query / selected message when switching mailbox.
				search={{ q: undefined, selectedMessageId: undefined }}
				onClick={() => {
					invalidateMailboxThreads(navId);
					onClick?.();
				}}
				className={className}
				aria-label={ariaLabel}
				title={title}
			>
				{children}
			</Link>
		);
	};

	const handleSelectNav = () => {
		// Navigation is handled by the router <Link>; this runs the
		// post-selection side effects.
		//
		// Clearing the field is one of them. Every link above drops `q`, and the
		// shell re-seeds the field from the destination's `q` when the view
		// changes — but picking the folder you are already in is the same view,
		// so the shell leaves the field alone and the previous query would sit in
		// the bar over a list that no longer has it in the URL. Selecting a nav
		// entry is an unambiguous "show me this", so it clears here regardless.
		// It is a user action, not a mirror, so it cannot race in-flight typing.
		onSearchChange("");
		onMailboxSelect?.();
	};

	// Saved searches (#428 follow-up, local-only MVP — see
	// doc/design/flows/06-search.md). A saved query is the raw typed text; the
	// existing token parser re-derives its chips on reselect, so there's nothing
	// else to persist.
	const trimmedSearchInput = searchInput.trim();
	const saveableQuery =
		trimmedSearchInput.length > 0 && !savedSearches.includes(trimmedSearchInput)
			? trimmedSearchInput
			: undefined;

	const handleSaveCurrentSearch = useCallback(() => {
		if (!saveableQuery) return;
		setSavedSearches(saveSearch(saveableQuery));
	}, [saveableQuery]);

	const handleRemoveSavedSearch = useCallback((query: string) => {
		setSavedSearches(removeSavedSearch(query));
	}, []);

	// Running a saved search re-uses the daily brief as the search surface (the
	// cross-account default view) — the same destination the search field
	// itself lands results in once a query is active.
	const handleSelectSavedSearch = useCallback(
		(query: string) => {
			onSearchChange(query);
			navigate({
				to: "/mail",
				search: { q: query, selectedMessageId: undefined },
			});
			onMailboxSelect?.();
		},
		[onSearchChange, navigate, onMailboxSelect],
	);

	return (
		<NavSidebar
			accounts={navAccounts}
			selectedNavId={selectedNavId}
			onSelectNav={handleSelectNav}
			linkComponent={linkComponent}
			variant={variant}
			savedSearches={savedSearches}
			saveableQuery={saveableQuery}
			onSaveCurrentSearch={handleSaveCurrentSearch}
			onSelectSavedSearch={handleSelectSavedSearch}
			onRemoveSavedSearch={handleRemoveSavedSearch}
		/>
	);
}
