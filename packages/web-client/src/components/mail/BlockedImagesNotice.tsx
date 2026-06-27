interface BlockedImagesNoticeProps {
	blockedImageCount: number;
	canAlwaysTrust: boolean;
	isTrustPending: boolean;
	onLoadOnce: () => void;
	onAlwaysTrust: () => void;
}

export const BlockedImagesNotice = ({
	blockedImageCount,
	canAlwaysTrust,
	isTrustPending,
	onLoadOnce,
	onAlwaysTrust,
}: BlockedImagesNoticeProps) => (
	<div className="mb-3 flex items-center justify-between rounded-md bg-surface-sunken/50 px-3 py-2 text-sm">
		<span className="text-fg-muted">
			{blockedImageCount} image{blockedImageCount > 1 ? "s" : ""} blocked for
			privacy
		</span>
		<div className="flex items-center gap-3">
			<button
				type="button"
				onClick={onLoadOnce}
				className="text-accent hover:underline"
			>
				Load once
			</button>
			{canAlwaysTrust && (
				<button
					type="button"
					onClick={onAlwaysTrust}
					aria-busy={isTrustPending}
					className="text-accent hover:underline aria-busy:opacity-50"
				>
					{isTrustPending ? "Trusting…" : "Always trust"}
				</button>
			)}
		</div>
	</div>
);
