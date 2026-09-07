interface BlockedImagesNoticeProps {
	blockedImageCount: number;
	canAlwaysTrust: boolean;
	isTrustPending: boolean;
	/**
	 * The From-address carries the `blocked` flag. Blocking is a stronger
	 * instruction than "not trusted": images never load, "even on explicit
	 * click", so the bar states why the message is image-free instead of
	 * offering a way past it. The affordances are absent, never disabled — a
	 * dead button reads as broken (#943).
	 */
	isSenderBlocked: boolean;
	onLoadOnce: () => void;
	onAlwaysTrust: () => void;
}

const noticeCopy = (
	blockedImageCount: number,
	isSenderBlocked: boolean,
): string => {
	const images = `${blockedImageCount} image${blockedImageCount > 1 ? "s" : ""}`;
	if (isSenderBlocked) return `${images} hidden — you blocked this sender`;
	return `${images} blocked for privacy`;
};

export const BlockedImagesNotice = ({
	blockedImageCount,
	canAlwaysTrust,
	isTrustPending,
	isSenderBlocked,
	onLoadOnce,
	onAlwaysTrust,
}: BlockedImagesNoticeProps) => (
	<div
		data-testid="blocked-images-notice"
		className="mb-3 flex items-center justify-between rounded-md bg-surface-sunken/50 px-3 py-2 text-sm"
	>
		<span className="text-fg-muted">
			{noticeCopy(blockedImageCount, isSenderBlocked)}
		</span>
		{!isSenderBlocked && (
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
		)}
	</div>
);
