/**
 * /calendar — a sibling of /mail, sharing its nav and nothing else.
 *
 * The layout owns what the whole calendar needs and no more: the account list
 * the sidebar is built from, and the nav slide-over the narrow tiers open. The
 * view below it decides what the panes hold.
 *
 * The fragment keeps the meaning it has in mail. The calendar has no
 * intelligence rail, so a reader arriving with `#intelligence` carries it
 * through and takes it back to their mail — nothing calendar-specific joins the
 * union, because none of the calendar's own chrome is a panel.
 */
import { configOperationsGetConfigOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { CalendarShellProvider } from "@/components/calendar/CalendarShell";
import { MailNav } from "@/components/mail/MailNav";
import { ErrorState } from "@/components/ui/ErrorState";
import { isSinglePaneTier, useLayoutTier } from "@/hooks/useLayoutTier";
import { panelsWithOverlay, useOpenPanels, useSetOpenPanels } from "@/routing";
import "@/lib/client";

export const Route = createFileRoute("/calendar")({
	loader: ({ context: { queryClient } }) => {
		void queryClient.prefetchQuery(configOperationsGetConfigOptions());
	},
	component: CalendarLayout,
});

function CalendarLayout() {
	const navigate = useNavigate();
	const isSinglePane = isSinglePaneTier(useLayoutTier());
	// Only the nav slide-over is the calendar's to open, and it is written as
	// the whole set so a pane the reader brought with them from mail survives
	// the visit rather than being dropped by the first tap on the hamburger.
	const openPanels = useOpenPanels();
	const setOpenPanels = useSetOpenPanels();
	const navOpen = openPanels.includes("nav");
	const showNav = useCallback(
		(open: boolean) => {
			setOpenPanels(panelsWithOverlay(openPanels, open ? "nav" : undefined));
		},
		[openPanels, setOpenPanels],
	);

	const {
		data: config,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
	});

	// The same first-run guard `/mail` carries: a reader with no account has no
	// calendar either, and the onboarding wizard is where they belong.
	const hasNoAccounts = Boolean(config && (config.accounts?.length ?? 0) === 0);
	useEffect(() => {
		if (!hasNoAccounts) return;
		navigate({ to: "/onboarding", replace: true });
	}, [hasNoAccounts, navigate]);

	const accounts = config?.accounts ?? [];

	if (isError) {
		return (
			<div className="flex h-full items-center justify-center bg-canvas p-4">
				<ErrorState
					title="Couldn't load your account"
					error={error}
					onRetry={() => {
						refetch();
					}}
				/>
			</div>
		);
	}

	return (
		<CalendarShellProvider
			chrome={{
				isSinglePane,
				isLoading: isLoading || hasNoAccounts,
				nav: (
					<MailNav accounts={accounts} onMailboxSelect={() => showNav(false)} />
				),
				navOpen,
				onOpenNav: () => showNav(true),
				onCloseNav: () => showNav(false),
			}}
		>
			<Outlet />
		</CalendarShellProvider>
	);
}
