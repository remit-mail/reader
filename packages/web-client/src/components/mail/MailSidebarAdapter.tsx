import {
	mailboxOperationsListMailboxesOptions,
	outboxOperationsListOutboxMessagesOptions,
	threadOperationsListThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import type {
	MailboxSpecialUse,
	NavAccount,
	NavLinkComponent,
} from "@remit/ui";
import { NavSidebar } from "@remit/ui";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
	filterDuplicateSpecialUse,
	getMailboxDisplayLabel,
	getMailboxPriority,
	isSystemMailbox,
	shouldShowUnreadBadge,
} from "@/lib/mailbox-order";
import { isOutboxListRow } from "@/lib/outbox-status";

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

/** Map an API mailbox list to sorted system + folder arrays. */
function sortMailboxes(
	mailboxes: RemitImapMailboxResponse[],
	t: Translator,
): {
	system: RemitImapMailboxResponse[];
	labels: RemitImapMailboxResponse[];
} {
	const filtered = filterDuplicateSpecialUse(mailboxes);
	const system: RemitImapMailboxResponse[] = [];
	const labels: RemitImapMailboxResponse[] = [];

	for (const mailbox of filtered) {
		if (isSystemMailbox(mailbox.fullPath, mailbox.specialUse)) {
			system.push(mailbox);
		} else {
			labels.push(mailbox);
		}
	}

	system.sort(
		(a, b) =>
			getMailboxPriority(a.fullPath, a.specialUse) -
			getMailboxPriority(b.fullPath, b.specialUse),
	);
	labels.sort((a, b) =>
		compareLabelNames(
			getMailboxDisplayLabel(a.fullPath, a.specialUse, t),
			getMailboxDisplayLabel(b.fullPath, b.specialUse, t),
		),
	);

	return { system, labels };
}

/** Convert an API mailbox to a NavMailbox for the kit, localizing system names. */
function toNavMailbox(mb: RemitImapMailboxResponse, t: Translator) {
	const showBadge =
		shouldShowUnreadBadge(mb.fullPath, mb.specialUse) && mb.unseenCount > 0;
	return {
		id: mb.mailboxId,
		name: getMailboxDisplayLabel(mb.fullPath, mb.specialUse, t),
		unseen: showBadge ? mb.unseenCount : undefined,
		// The API's specialUse values are RFC 6154 strings ("\\Sent" etc.)
		// which are the same runtime values as MailboxSpecialUse — just cast.
		specialUse: mb.specialUse as MailboxSpecialUse[] | undefined,
		fullPath: mb.fullPath,
	};
}

/**
 * Resolves the currently selected nav ID from the active route so the kit
 * component can highlight the right item.
 *   - /mail/outbox → "outbox"
 *   - /mail/$mailboxId → mailboxId
 *   - /mail (daily brief) → "brief"
 */
function useSelectedNavId(): string {
	const location = useLocation();
	const params = useParams({ strict: false }) as { mailboxId?: string };

	if (location.pathname.startsWith("/mail/outbox")) return "outbox";
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
	const selectedNavId = useSelectedNavId();
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
			const { system, labels } = sortMailboxes(mailboxes, translator);

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
					toNavMailbox(mb, translator),
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
					search={{}}
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
					search={{}}
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
		// Navigation is handled by the router <Link>; this only runs the
		// post-selection side effect (drawer auto-close on mobile).
		onMailboxSelect?.();
	};

	return (
		<NavSidebar
			accounts={navAccounts}
			selectedNavId={selectedNavId}
			onSelectNav={handleSelectNav}
			linkComponent={linkComponent}
			variant={variant}
		/>
	);
}
