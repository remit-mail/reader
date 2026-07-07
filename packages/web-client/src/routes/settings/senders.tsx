/**
 * Senders & Rules — 2-pane page: rule groups left, dense filterable
 * sender table right. Built to scale to hundreds of flagged senders.
 *
 * Backend gap (#427): there is no "list all addresses with flag X" endpoint.
 * VIP group: served from GET /me/vip-suggestions (suggested-to-promote list).
 * Muted / Blocked groups: users search by name/email to find flagged senders
 * via GET /addresses/search; results are filtered client-side on the flag.
 * The real flagged-address query endpoint is tracked as a backend issue.
 */
import {
	addressDetailOperationsUpdateAddressMutation,
	addressOperationsSearchAddressesOptions,
	meOperationsListVipSuggestionsOptions,
	meOperationsListVipSuggestionsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAddressResponse,
	RemitImapVipSuggestionEntry,
} from "@remit/api-http-client/types.gen.ts";
import {
	Button,
	Input,
	Kbd,
	SenderFlagRow,
	SenderGroupSwitch,
	SettingsShell,
} from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search, Star, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { formatDate } from "@/lib/format";
import { SETTINGS_ID_TO_PATH, SETTINGS_NAV_ITEMS } from "@/routes/settings";

export const Route = createFileRoute("/settings/senders")({
	component: SendersSettings,
});

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

type SenderGroup = "vip" | "muted" | "blocked";

const groupLabels: Record<SenderGroup, string> = {
	vip: "VIPs",
	muted: "Muted",
	blocked: "Blocked",
};

/* ------------------------------------------------------------------ */
/* Help rail copy — matches Storybook sendersHelp exactly             */
/* ------------------------------------------------------------------ */

const sendersHelp = (
	<div className="space-y-3">
		<p>
			<strong className="text-fg">VIP</strong> senders get priority surface in
			the daily brief and notification escalation, even when an account is
			quiet.
		</p>
		<p>
			<strong className="text-fg">Muted</strong> senders never notify and stay
			out of the brief. Their mail still syncs and stays searchable.
		</p>
		<p>
			<strong className="text-fg">Blocked</strong> senders never load images and
			go straight to junk.
		</p>
		<p>
			Tip: flag from the keyboard on any message — <Kbd>v</Kbd> VIP,{" "}
			<Kbd>m</Kbd> mute, <Kbd>b</Kbd> block. Every rule an automation creates
			shows up here and can be removed.
		</p>
	</div>
);

/* ------------------------------------------------------------------ */
/* VIP group: served from suggestions endpoint                        */
/* ------------------------------------------------------------------ */

function VipGroupPane({
	query,
	onCount,
}: {
	query: string;
	onCount?: (matched: number, total: number) => void;
}) {
	const { data, isPending, isError, error } = useQuery(
		meOperationsListVipSuggestionsOptions(),
	);
	const queryClient = useQueryClient();

	const addMutation = useMutation({
		...addressDetailOperationsUpdateAddressMutation(),
		onSettled: () => {
			queryClient.invalidateQueries({
				queryKey: meOperationsListVipSuggestionsQueryKey(),
			});
		},
	});

	const suggestions = data?.suggestions ?? [];
	const q = query.trim().toLowerCase();
	const filtered = q
		? suggestions.filter(
				(s) =>
					(s.displayName ?? "").toLowerCase().includes(q) ||
					s.normalizedEmail.toLowerCase().includes(q),
			)
		: suggestions;

	useEffect(() => {
		onCount?.(filtered.length, suggestions.length);
	}, [onCount, filtered.length, suggestions.length]);

	if (isPending) {
		return (
			<div className="px-row-inset py-3 text-sm text-fg-subtle animate-pulse">
				Loading VIP suggestions…
			</div>
		);
	}

	if (isError) {
		return (
			<div className="px-row-inset py-3">
				<ErrorState
					variant="inline"
					title="Couldn't load VIP suggestions"
					error={error}
				/>
			</div>
		);
	}

	if (suggestions.length === 0) {
		return (
			<div className="px-row-inset py-5 text-sm text-fg-subtle">
				No VIP suggestions yet. As you reply to senders, they&apos;ll appear
				here. Press <Kbd>v</Kbd> on any message to promote a sender to VIP.
			</div>
		);
	}

	if (filtered.length === 0) {
		return (
			<p className="px-row-inset py-5 text-sm text-fg-subtle">
				No VIPs match &ldquo;{query}&rdquo;.
			</p>
		);
	}

	return (
		<>
			<div className="px-row-inset py-1 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				Suggested — promote to VIP
			</div>
			{filtered.map((s: RemitImapVipSuggestionEntry) => (
				<SenderFlagRow
					key={s.addressId}
					name={s.displayName ?? s.normalizedEmail}
					email={s.normalizedEmail}
					meta={
						s.replyCount > 0
							? `${s.inboundCount} received · you replied ${s.replyCount}×`
							: `${s.inboundCount} received · you've never replied`
					}
					trailing={
						<Button
							variant="ghost"
							size="sm"
							icon={<Star className="size-3.5" />}
							aria-busy={addMutation.isPending}
							onClick={() => {
								if (addMutation.isPending) return;
								addMutation.mutate({
									path: { addressId: s.addressId },
									body: {
										flags: {
											vip: { value: true, setAt: Date.now(), setBy: "user" },
										},
									},
								});
							}}
						>
							Add VIP
						</Button>
					}
				/>
			))}
		</>
	);
}

/* ------------------------------------------------------------------ */
/* Muted / Blocked groups: search-based (backend gap noted)           */
/* ------------------------------------------------------------------ */

function SearchGroupPane({
	group,
	query,
	onCount,
}: {
	group: "muted" | "blocked";
	query: string;
	onCount?: (matched: number, total: number | null) => void;
}) {
	const debouncedQ = useDebouncedValue(query.trim(), 300);
	const queryClient = useQueryClient();
	const [retryId, setRetryId] = useState<string | null>(null);

	const enabled = debouncedQ.length >= 2;

	const searchOptions = addressOperationsSearchAddressesOptions({
		query: { q: debouncedQ, limit: 50 },
	});

	const { data, isPending, isError, error } = useQuery({
		...searchOptions,
		enabled,
	});

	const removeMutation = useMutation({
		...addressDetailOperationsUpdateAddressMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: searchOptions.queryKey });
		},
	});

	const items = (data?.items ?? []).filter((a: RemitImapAddressResponse) =>
		group === "muted"
			? (a.flags?.muted?.value ?? false)
			: (a.flags?.blocked?.value ?? false),
	);

	useEffect(() => {
		// Total flagged count is unknown (no list-all-flagged endpoint), so the
		// group rail shows the live matched-row count while a search is active.
		onCount?.(enabled ? items.length : 0, null);
	}, [onCount, enabled, items.length]);

	if (!enabled) {
		// Backend gap: no list-all-flagged endpoint; prompt user to search.
		return (
			<div className="px-row-inset py-5 text-sm text-fg-subtle space-y-2">
				<p>
					Type 2+ characters to search {groupLabels[group].toLowerCase()}{" "}
					senders by name or address.
				</p>
				<p className="text-2xs text-fg-subtle">
					Note: a dedicated flagged-address list endpoint is in the backlog.
					Press <Kbd>m</Kbd> on any message to mute its sender; <Kbd>b</Kbd> to
					block.
				</p>
			</div>
		);
	}

	if (isPending) {
		return (
			<div className="px-row-inset py-3 text-sm text-fg-subtle animate-pulse">
				Searching…
			</div>
		);
	}

	if (isError) {
		return (
			<div className="px-row-inset py-3">
				<ErrorState variant="inline" title="Search failed" error={error} />
			</div>
		);
	}

	if (items.length === 0) {
		return (
			<p className="px-row-inset py-5 text-sm text-fg-subtle">
				No {groupLabels[group].toLowerCase()} senders matching &ldquo;
				{debouncedQ}&rdquo;.
			</p>
		);
	}

	return (
		<>
			{items.map((a: RemitImapAddressResponse) => {
				const flag = group === "muted" ? a.flags?.muted : a.flags?.blocked;
				// The search response carries no engagement counts, so the row's
				// info line is the flag provenance (when/why it was flagged)
				// rather than echoing the email already in the header.
				const meta = flag
					? [
							`${group}`,
							flag.setAt
								? formatDate(flag.setAt, {
										month: "short",
										year: "numeric",
									}) || null
								: null,
							flag.reason ? `— ${flag.reason}` : null,
						]
							.filter(Boolean)
							.join(" ")
					: group;

				const isPendingRemove =
					removeMutation.isPending &&
					removeMutation.variables?.path.addressId === a.addressId;
				const isFailedRemove =
					removeMutation.isError && retryId === a.addressId;

				return (
					<SenderFlagRow
						key={a.addressId}
						name={a.displayName ?? a.normalizedEmail}
						email={a.normalizedEmail}
						danger={group === "blocked"}
						meta={meta}
						trailing={
							isFailedRemove ? (
								<Button
									variant="secondary"
									size="sm"
									onClick={() => {
										setRetryId(a.addressId);
										removeMutation.mutate({
											path: { addressId: a.addressId },
											body: { flags: { [group]: null } },
										});
									}}
								>
									Retry
								</Button>
							) : (
								<Button
									variant="ghost"
									size="sm"
									icon={<X className="size-3.5" />}
									aria-busy={isPendingRemove}
									aria-label={`Remove ${group} flag`}
									onClick={() => {
										if (isPendingRemove) return;
										setRetryId(a.addressId);
										removeMutation.mutate({
											path: { addressId: a.addressId },
											body: { flags: { [group]: null } },
										});
									}}
								/>
							)
						}
					/>
				);
			})}
		</>
	);
}

/* ------------------------------------------------------------------ */
/* Page component                                                     */
/* ------------------------------------------------------------------ */

function SendersSettings() {
	const navigate = useNavigate();
	const [group, setGroup] = useState<SenderGroup>("vip");
	const [query, setQuery] = useState("");
	const [helpOpen, setHelpOpen] = useState(true);

	// Per-group counts for the rail + footer. VIP total is the suggestions
	// list size; muted/blocked have no list endpoint, so their total is null
	// (the rail shows the live matched-row count instead of a stale total).
	const [matched, setMatched] = useState(0);
	const [groupCounts, setGroupCounts] = useState<
		Record<SenderGroup, number | null>
	>({ vip: 0, muted: null, blocked: null });

	const handleVipCount = useCallback((m: number, total: number) => {
		setMatched(m);
		setGroupCounts((prev) => ({ ...prev, vip: total }));
	}, []);

	const handleSearchCount = useCallback(
		(m: number, _total: number | null) => {
			setMatched(m);
			setGroupCounts((prev) => ({ ...prev, [group]: m }));
		},
		[group],
	);

	const total = groupCounts[group];

	const handleSelectNav = (id: string) => {
		const path = SETTINGS_ID_TO_PATH[id];
		if (path) void navigate({ to: path });
	};

	return (
		<SettingsShell
			items={SETTINGS_NAV_ITEMS}
			activeId="senders"
			title="Senders & Rules"
			description="Per-sender preferences — set with one key from any message, managed here."
			flush
			help={sendersHelp}
			helpOpen={helpOpen}
			onToggleHelp={() => setHelpOpen((v) => !v)}
			onSelect={handleSelectNav}
			onBackToMail={() => void navigate({ to: "/mail" })}
		>
			<div className="flex min-h-0 flex-1 flex-col lg:flex-row">
				<SenderGroupSwitch<SenderGroup>
					active={group}
					onSelect={(g) => {
						setGroup(g);
						setQuery("");
					}}
					options={(["vip", "muted", "blocked"] as SenderGroup[]).map((g) => ({
						id: g,
						label: groupLabels[g],
						count: groupCounts[g],
					}))}
				/>

				{/* Dense filterable sender table */}
				<div className="flex min-w-0 flex-1 flex-col">
					<div className="border-b border-line px-row-inset py-2">
						<Input
							icon={<Search className="size-4" />}
							placeholder={`Filter ${groupLabels[group].toLowerCase()} by name or address`}
							className="h-8 max-w-sm"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>
					</div>

					<div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
						{group === "vip" ? (
							<VipGroupPane query={query} onCount={handleVipCount} />
						) : (
							<SearchGroupPane
								group={group}
								query={query}
								onCount={handleSearchCount}
							/>
						)}
					</div>

					<footer className="flex items-center justify-between border-t border-line px-row-inset py-1 text-2xs text-fg-subtle">
						<span>
							{total != null
								? `${matched} of ${total} flagged senders`
								: `${matched} flagged senders`}
						</span>
						<span>
							<Kbd>j</Kbd> <Kbd>k</Kbd> navigate · <Kbd>⌫</Kbd> remove flag
						</span>
					</footer>
				</div>
			</div>
		</SettingsShell>
	);
}
