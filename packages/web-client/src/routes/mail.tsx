import {
	configOperationsGetConfigOptions,
	unifiedThreadOperationsListAllThreadsOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useTriageKeyboard } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Outlet,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import { z } from "zod";
import { ComposeFab } from "@/components/layout/ComposeFab";
import { MailShellProvider } from "@/components/layout/MailShell";
import { MailTopBar } from "@/components/layout/MailTopBar";
import { MailNav } from "@/components/mail/MailNav";
import { ErrorState } from "@/components/ui/ErrorState";
import { KeyboardShortcutsModal } from "@/components/ui/KeyboardShortcutsModal";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { isSinglePaneTier, useLayoutTier } from "@/hooks/useLayoutTier";
import { useMailboxNameIndex } from "@/hooks/useMailboxNameIndex";
import { useRailPanels } from "@/hooks/useRailPanels";
import { useResultFolderIndex } from "@/hooks/useResultFolderIndex";
import { useStaleAccountSync } from "@/hooks/useStaleAccountSync";
import { MailContext } from "@/lib/mail-context";
import { MailFreshnessProvider } from "@/lib/mail-freshness";
import { mailListRoute } from "@/lib/mail-route";
import { buildAccountNameIndex } from "@/lib/search-token-index";
import {
	useIsComposing,
	useOpenCompose,
	useSearchField,
	wizardEntryValue,
	wizardStepValue,
} from "@/routing";
import "@/lib/client";

// `MailContext` / `useMailContext` live in `@/lib/mail-context` so the provider
// here and the child-route consumers resolve to a single module instance — see
// that file for why the alias-vs-relative route-tree import split otherwise
// breaks context.
export { useMailContext } from "@/lib/mail-context";

const mailSearchSchema = z.object({
	q: z.string().optional(),
	// The selection wizard's step (#477 clause 1.6). The router owns history, so
	// the step is a validated search param rather than a raw pushState entry.
	wizard: wizardStepValue,
	// Which affordance opened it, so a reload lands back on the walk it was in.
	wizardFrom: wizardEntryValue,
});

export const Route = createFileRoute("/mail")({
	// Kick off config and the cross-account thread list together, without
	// awaiting either — the route paints its skeleton shell immediately and the
	// queries resolve in parallel rather than serialized behind config. The
	// zero-account onboarding redirect moved into the component (see
	// MailLayout), so a cold load no longer blocks first paint on the network.
	loader: ({ context: { queryClient } }) => {
		void queryClient.prefetchQuery(configOperationsGetConfigOptions());
		void queryClient.prefetchQuery({
			...unifiedThreadOperationsListAllThreadsOptions(),
			staleTime: 60_000,
		});
	},
	component: MailLayout,
	validateSearch: mailSearchSchema,
});

function MailLayout() {
	const navigate = useNavigate();
	const tier = useLayoutTier();
	// Below the reading boundary (phone AND tablet) the shell shows a SINGLE
	// pane — there is no reading pane to host the thread or the compose surface.
	// So both tiers use the single-pane view, which swaps the pane in place
	// between list, open thread, and compose. Keying this off "phone" alone left
	// tablet with no compose surface (compose lives in the reading pane, which
	// tablet doesn't mount) — the "c" shortcut / FAB opened nothing.
	const isSinglePane = isSinglePaneTier(tier);
	// What the address, the stored preference and the two rail verbs come to
	// (`hooks/useRailPanels`): a raise surfaces the rail for the thread in hand,
	// the reader's own toggle is the one that stores where they want it (#778).
	const {
		openOverlay,
		intelligenceOpen,
		showOverlay,
		toggleIntelligence,
		raiseIntelligence,
	} = useRailPanels();
	const showShortcuts = openOverlay === "shortcuts";
	const drawerOpen = openOverlay === "nav";

	// The one search field and the query it commits (`useSearchField`): seeded
	// from the URL, mirrored back by each list route's own `useSearchMirror`,
	// and re-seeded from the address whenever the reader leaves the view (#47).
	const { searchInput, committedQuery, viewKey, setSearchInput } =
		useSearchField();

	const {
		data: config,
		isLoading,
		isError: isConfigError,
		error: configError,
		refetch: refetchConfig,
	} = useQuery({
		...configOperationsGetConfigOptions(),
		// Config only changes when accounts are added/edited/removed; those
		// mutations explicitly invalidate this query.
		staleTime: Infinity,
	});

	// First-run guard: a zero-account user goes to the onboarding wizard. This
	// lives here (not a blocking beforeLoad) so a cold load paints the skeleton
	// shell immediately; the redirect fires once config arrives. It guards the
	// /mail parent so it holds for every child route — index redirect, daily
	// brief (#426/#484), etc.
	const hasNoAccounts = Boolean(config && (config.accounts?.length ?? 0) === 0);
	useEffect(() => {
		if (!hasNoAccounts) return;
		navigate({ to: "/onboarding", replace: true });
	}, [hasNoAccounts, navigate]);

	// Global keyboard shortcut for help
	useKeyboardNavigation({
		enabled: !showShortcuts,
		bindings: [
			{
				key: "?",
				action: "help",
				handler: () => showOverlay("shortcuts"),
				noModifiers: false, // Allow shift+/
				preventDefault: true,
			},
		],
	});

	// `c` / ⌘N off the mailbox routes — the brief, Flagged, the outbox. On a
	// mailbox the pane's own triage layer owns the key, so this is disabled there
	// rather than firing a second compose alongside it, and while the composer is
	// up the key belongs to whatever is being typed. An open modal contains the
	// key through the shared overlay stack, so this layer never opens compose out
	// from under one (#959).
	const openCompose = useOpenCompose();
	const isComposing = useIsComposing();
	const onMailbox = useRouterState({
		select: (s) => mailListRoute(s.matches)?.list === "mailbox",
	});
	const composeHandlers = useMemo(
		() => ({ compose: openCompose }),
		[openCompose],
	);
	useTriageKeyboard({
		enabled: !onMailbox && !isComposing,
		handlers: composeHandlers,
	});

	// Clears the search field; the list route's mirror drops `q` from the URL
	// after the debounce settles.
	const handleSearchClear = useCallback(() => {
		setSearchInput("");
	}, [setSearchInput]);

	// Esc inside the search field clears only the query (#489).
	const handleSearchClearQuery = useCallback(() => {
		setSearchInput("");
	}, [setSearchInput]);

	const accounts = config?.accounts ?? [];
	const accountIds = useMemo(
		() => accounts.map((account) => account.accountId),
		[accounts],
	);
	const mailboxNameIndex = useMailboxNameIndex(accounts);
	const resultFolderIndex = useResultFolderIndex(accounts);
	const accountNameIndex = useMemo(
		() => buildAccountNameIndex(accounts),
		[accounts],
	);

	// Auto-trigger a mailbox-list sync for any account whose lastSyncAt is
	// older than 15 minutes (or unset). Fires once per accountId per session
	// — re-mounts of MailLayout will not retrigger. See #205.
	useStaleAccountSync(accounts);

	const handleMailboxSelect = useCallback(() => {
		// Auto-collapse the mobile drawer after the user picks an inbox from the
		// sidebar (#199). Above the slide-over the sidebar is a pane, and there is
		// no overlay of its own to take down.
		if (openOverlay !== "nav") return;
		showOverlay(undefined);
	}, [openOverlay, showOverlay]);

	const mailContextValue = {
		accounts,
		mailboxNameIndex,
		accountNameIndex,
		resultFolderIndex,
		// The committed local value is the source of truth for search; it is
		// mirrored to the URL for shareable links.
		searchQuery: committedQuery,
		searchInput,
		searchViewKey: viewKey,
		onSearchChange: setSearchInput,
		onSearchClear: handleSearchClear,
		onSearchClearQuery: handleSearchClearQuery,
		intelligenceOpen,
		onToggleIntelligence: toggleIntelligence,
		onRaiseIntelligence: raiseIntelligence,
	};

	// Single nav node: the kit renders it as a pane (≥1024px) or inside its
	// own slide-over Dialog (narrow), never both — so there is exactly one
	// "Mailboxes" nav landmark at any width. `MailNav` adds the mobile
	// Settings + bug-report footer when it detects the slide-over context.
	const shellChrome = {
		isSinglePane,
		isLoading: isLoading || hasNoAccounts,
		intelligenceOpen,
		nav: <MailNav accounts={accounts} onMailboxSelect={handleMailboxSelect} />,
		// Desktop only. Below 1024px the single pane keeps its own header search
		// and the phone takeover; there is no room for a bar spanning panes that do
		// not exist side by side.
		topBar: isSinglePane ? undefined : <MailTopBar accounts={accounts} />,
		// Single-pane only, where the FAB is the compose entry point. Above it the
		// top bar owns compose.
		overlay: isSinglePane ? <ComposeFab /> : undefined,
		navOpen: drawerOpen,
		onOpenNav: () => showOverlay("nav"),
		onCloseNav: () => showOverlay(undefined),
	};

	return (
		<MailContext.Provider value={mailContextValue}>
			<MailFreshnessProvider accountIds={accountIds}>
				{isConfigError ? (
					<div className="flex h-full items-center justify-center bg-canvas p-4">
						<ErrorState
							title="Couldn't load your account"
							error={configError}
							onRetry={() => {
								refetchConfig();
							}}
						/>
					</div>
				) : (
					// Each list route mounts its own shell around its own panes.
					<MailShellProvider chrome={shellChrome}>
						<Outlet />
					</MailShellProvider>
				)}
				<KeyboardShortcutsModal
					isOpen={showShortcuts}
					onClose={() => showOverlay(undefined)}
				/>
			</MailFreshnessProvider>
		</MailContext.Provider>
	);
}
