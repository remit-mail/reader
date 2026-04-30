import { meOperationsListVipSuggestionsOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { SuggestedVipsCard } from "@/components/settings/SuggestedVipsCard";
import { deriveSuggestedVipsState } from "@/components/settings/suggested-vips-state.js";
import { ErrorState } from "@/components/ui/ErrorState";
import { useAddToVips } from "@/hooks/useAddToVips";

export const Route = createFileRoute("/settings/suggested-vips")({
	component: SuggestedVipsSettings,
});

const LoadingSkeleton = () => (
	<ul
		className="space-y-3"
		aria-busy="true"
		aria-label="Loading VIP suggestions"
	>
		{Array.from({ length: 3 }).map((_, i) => (
			<li
				key={i}
				className="rounded-lg border border-border p-4 animate-pulse flex items-center gap-3"
			>
				<div className="size-10 rounded-full bg-muted" />
				<div className="flex-1 min-w-0 space-y-2">
					<div className="h-4 bg-muted rounded w-1/3" />
					<div className="h-3 bg-muted rounded w-2/3" />
				</div>
				<div className="h-9 w-28 bg-muted rounded-md" />
			</li>
		))}
	</ul>
);

function SuggestedVipsSettings() {
	const { data, isPending, isError, error, refetch } = useQuery(
		meOperationsListVipSuggestionsOptions(),
	);

	const {
		addToVips,
		pendingAddressId,
		error: addError,
		reset: resetAddError,
	} = useAddToVips();

	const state = deriveSuggestedVipsState({ isPending, isError, error, data });

	return (
		<div className="max-w-2xl">
			<div className="mb-6">
				<h1 className="text-xl font-semibold">Suggested VIPs</h1>
				<p className="text-sm text-muted-foreground">
					People you exchange mail with most. Promote them to VIPs to surface
					their mail and unlock push escalation.
				</p>
			</div>

			{addError ? (
				<div className="mb-4">
					<ErrorState
						variant="inline"
						title="Couldn't add to VIPs"
						error={addError}
						onRetry={() => resetAddError()}
					/>
				</div>
			) : null}

			{state.kind === "loading" ? <LoadingSkeleton /> : null}
			{state.kind === "error" ? (
				<ErrorState
					title="Couldn't load suggestions"
					error={state.error}
					onRetry={() => {
						refetch();
					}}
				/>
			) : null}
			{state.kind === "empty" ? (
				<div
					className="text-center py-12 border border-dashed rounded-lg"
					data-testid="suggested-vips-empty"
				>
					<p className="text-muted-foreground">
						No suggestions yet. As you reply to senders, they'll show up here.
					</p>
				</div>
			) : null}
			{state.kind === "list" ? (
				<ul className="space-y-3" data-testid="suggested-vips-list">
					{state.data.suggestions.map((suggestion) => (
						<SuggestedVipsCard
							key={suggestion.addressId}
							suggestion={suggestion}
							onAdd={() => addToVips(suggestion.addressId)}
							disabled={pendingAddressId === suggestion.addressId}
						/>
					))}
				</ul>
			) : null}
		</div>
	);
}
