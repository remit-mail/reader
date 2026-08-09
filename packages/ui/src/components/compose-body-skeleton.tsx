export const ComposeBodySkeleton = () => (
	<div
		aria-hidden="true"
		data-testid="compose-body-skeleton"
		className="min-h-[120px] px-3 py-2"
	>
		<div className="mb-2 h-8 animate-pulse rounded bg-surface-sunken" />
		<div className="min-h-[80px] animate-pulse rounded bg-surface-sunken/50" />
	</div>
);
