/**
 * What stands where the writing surface will be while its chunk loads. The
 * header, the banner and the action bar are already live around it, so this is
 * a state a user can act in — Send refuses with a reason until the body is
 * mounted rather than sending the document that is not on screen yet.
 */
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
