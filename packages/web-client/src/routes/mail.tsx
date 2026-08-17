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
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useResultFolderIndex } from "@/hooks/useResultFolderIndex";
import { useSearchField } from "@/hooks/useSearchField";
import { useStaleAccountSync } from "@/hooks/useStaleAccountSync";
import {
	readIntelligencePref,
	resolveRailOpen,
	writeIntelligencePref,
} from "@/lib/intelligence-pref";
import { MailContext } from "@/lib/mail-context";
import { MailFreshnessProvider } from "@/lib/mail-freshness";
import { mailListRoute } from "@/lib/mail-route";
import { buildAccountNameIndex } from "@/lib/search-token-index";
import { wizardEntryValue, wizardStepValue } from "@/lib/wizard-history";
import {
	isOverlayPanel,
	type OverlayPanel,
	useIsComposing,
	useOpenCompose,
	useOpenPanels,
	useOpenThreadPath,
	useSetOpenPanels,
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
	// The panels the address carries (#722): the intelligence rail, the nav
	// slide-over and the shortcuts sheet. The rail is a pane and the other two
	// cover it, so the address holds a pane and an overlay at once — a sheet
	// opening never takes the rail down — while two overlays cannot both be up.
	const openPanels = useOpenPanels();
	const setOpenPanels = useSetOpenPanels();
	const openOverlay = openPanels.find(isOverlayPanel);
	const showShortcuts = openOverlay === "shortcuts";
	const drawerOpen = openOverlay === "nav";
	// Pane 4 on desktop, the details drawer below it. `resolveRailOpen` is the
	// one place the address and the stored preference meet: the address decides
	// whenever it says anything at all, and the preference opens the rail with
	// the thread where it is silent (#782).
	const openThread = useOpenThreadPath();
	// Held in state, not read back from storage each render: closing the rail
	// where the address is silent changes nothing about the address, and the
	// answer has to move anyway.
	const [prefersRail, setPrefersRail] = useState(readIntelligencePref);
	const intelligenceOpen = resolveRailOpen({
		panels: openPanels,
		prefersOpen: prefersRail,
		isDesktop: tier === "desktop",
		hasThread: openThread !== undefined,
	});
	// Every write states the whole set, because it is composed from what is
	// showing rather than from what the address happens to spell: the rail open
	// by preference alone is still open, and an overlay must not close it.
	const showPanels = useCallback(
		(rail: boolean, overlay: OverlayPanel | undefined) => {
			setOpenPanels([
				...(rail ? (["intelligence"] as const) : []),
				...(overlay ? [overlay] : []),
			]);
		},
		[setOpenPanels],
	);
	const handleSetIntelligenceOpen = useCallback(
		(open: boolean) => {
			writeIntelligencePref(open);
			setPrefersRail(open);
			showPanels(open, openOverlay);
		},
		[openOverlay, showPanels],
	);
	const showOverlay = useCallback(
		(overlay: OverlayPanel | undefined) => {
			showPanels(intelligenceOpen, overlay);
		},
		[intelligenceOpen, showPanels],
	);

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
				handler: () => showOverlay("shortcuts"),
				noModifiers: false, // Allow shift+/
				preventDefault: true,
			},
		],
	});

	// `c` / ⌘N off the mailbox routes — the brief, Flagged, the outbox. On a
	// mailbox the pane's own triage layer owns the key, so this is disabled there
	// rather than firing a second compose alongside it, and while the composer is
	// up the key belongs to whatever is being typed.
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
	// after the debounce settles. Esc inside the field does the same, keeping the
	// thread open (#489), so the two are one handler under two names.
	const handleSearchClear = useCallback(() => {
		setSearchInput("");
	}, [setSearchInput]);

	const handleToggleIntelligence = useCallback(() => {
		handleSetIntelligenceOpen(!intelligenceOpen);
	}, [handleSetIntelligenceOpen, intelligenceOpen]);

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
		onSearchClearQuery: handleSearchClear,
		intelligenceOpen,
		onToggleIntelligence: handleToggleIntelligence,
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
