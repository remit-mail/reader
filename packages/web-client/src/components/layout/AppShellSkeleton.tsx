/**
 * AppShellSkeleton — structural placeholder shown on cold load.
 *
 * Renders the inbox chrome (nav rail + list rows) immediately, before the
 * auth session hydrates and the config query resolves, so the user sees the
 * shape of the app instead of a blank screen or a "Loading..." string. The
 * real list components swap in once their own data arrives.
 */

const NavRailSkeleton = () => (
	<div className="hidden h-full w-[17%] min-w-40 max-w-64 shrink-0 flex-col gap-1 border-r border-line p-3 md:flex">
		<div className="mb-3 h-6 w-24 rounded bg-surface-sunken" />
		{Array.from({ length: 6 }).map((_, i) => (
			<div
				// biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows have no stable id
				key={i}
				className="flex items-center gap-2 py-1.5"
			>
				<div className="size-5 shrink-0 rounded bg-surface-sunken" />
				<div className="h-3.5 flex-1 rounded bg-surface-sunken" />
			</div>
		))}
	</div>
);

const ListRowsSkeleton = () => (
	<div className="min-w-0 flex-1">
		{Array.from({ length: 8 }).map((_, i) => (
			<div
				// biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows have no stable id
				key={i}
				className="flex items-start gap-3 border-b border-line py-2 pl-5 pr-4"
			>
				<div className="mt-0.5 size-7 shrink-0 rounded-full bg-surface-sunken" />
				<div className="flex-1 space-y-1.5">
					<div className="flex justify-between gap-2">
						<div className="h-3.5 w-28 rounded bg-surface-sunken" />
						<div className="h-3 w-12 rounded bg-surface-sunken" />
					</div>
					<div className="h-3.5 w-48 rounded bg-surface-sunken" />
					<div className="h-3 w-full rounded bg-surface-sunken" />
				</div>
			</div>
		))}
	</div>
);

export const AppShellSkeleton = () => (
	<div className="flex h-dvh animate-pulse bg-canvas" aria-hidden="true">
		<NavRailSkeleton />
		<ListRowsSkeleton />
	</div>
);
