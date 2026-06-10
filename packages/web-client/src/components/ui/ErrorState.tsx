import { AlertCircle } from "lucide-react";

interface ErrorStateProps {
	title?: string;
	error: unknown;
	onRetry?: () => void;
	variant?: "block" | "inline";
}

const formatErrorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof (error as { message: unknown }).message === "string"
	) {
		return (error as { message: string }).message;
	}
	return "An unexpected error occurred";
};

export const ErrorState = ({
	title = "Couldn't load content",
	error,
	onRetry,
	variant = "block",
}: ErrorStateProps) => {
	const message = formatErrorMessage(error);

	if (variant === "inline") {
		return (
			<div
				role="alert"
				className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm"
			>
				<AlertCircle
					className="size-4 shrink-0 text-danger mt-0.5"
					aria-hidden="true"
				/>
				<div className="flex-1 min-w-0">
					<p className="font-medium text-danger">{title}</p>
					<p className="text-fg-muted mt-0.5 break-words">{message}</p>
				</div>
				{onRetry && (
					<button
						type="button"
						onClick={onRetry}
						className="shrink-0 text-sm font-medium text-accent hover:underline"
					>
						Retry
					</button>
				)}
			</div>
		);
	}

	return (
		<div
			role="alert"
			className="flex flex-col items-center justify-center gap-3 p-8 text-center"
		>
			<AlertCircle className="size-8 text-danger" aria-hidden="true" />
			<div>
				<p className="font-medium text-danger">{title}</p>
				<p className="text-sm text-fg-muted mt-1 break-words">{message}</p>
			</div>
			{onRetry && (
				<button
					type="button"
					onClick={onRetry}
					className="inline-flex items-center rounded-md border border-line bg-canvas px-4 py-2 text-sm font-medium hover:bg-surface-raised transition-colors"
				>
					Retry
				</button>
			)}
		</div>
	);
};
