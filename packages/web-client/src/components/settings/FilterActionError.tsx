import { ErrorState, formatErrorMessage } from "@/components/ui/ErrorState";
import { getErrorStatus } from "@/lib/error-classifier";

interface FilterActionErrorProps {
	title: string;
	error: unknown;
	onRetry: () => void;
	reportHref: (message: string) => string;
}

const isRefusal = (error: unknown): boolean => {
	const status = getErrorStatus(error);
	return status !== undefined && status >= 400 && status < 500;
};

export function FilterActionError({
	title,
	error,
	onRetry,
	reportHref,
}: FilterActionErrorProps) {
	return (
		<div className="space-y-1">
			<ErrorState
				variant="inline"
				title={title}
				error={error}
				onRetry={isRefusal(error) ? undefined : onRetry}
			/>
			<a
				href={reportHref(formatErrorMessage(error))}
				target="_blank"
				rel="noreferrer"
				className="text-xs text-accent hover:underline"
			>
				Report an issue
			</a>
		</div>
	);
}
