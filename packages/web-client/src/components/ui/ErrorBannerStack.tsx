import { ErrorBanner } from "./ErrorBanner.js";
import type { ErrorBannerEntry } from "./error-banners.js";

interface ErrorBannerStackProps {
	errors: ErrorBannerEntry[];
	onDismiss: (id: string) => void;
}

export const ErrorBannerStack = ({
	errors,
	onDismiss,
}: ErrorBannerStackProps) => {
	if (errors.length === 0) return null;

	return (
		<section
			aria-label="Notifications"
			className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-4 sm:items-end sm:pr-6"
		>
			<div className="flex w-full max-w-md flex-col gap-2">
				{errors.map((entry) => (
					<ErrorBanner
						key={entry.id}
						id={entry.id}
						severity={entry.severity}
						title={entry.title}
						detail={entry.detail}
						onDismiss={onDismiss}
					/>
				))}
			</div>
		</section>
	);
};
