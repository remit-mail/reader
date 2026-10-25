interface EmptyStateProps {
	message: string;
	icon?: React.ReactNode;
}

export const EmptyState = ({ message, icon }: EmptyStateProps) => (
	<div className="flex flex-col items-center justify-center p-8 text-center">
		{icon && <div className="mb-4 text-fg-muted">{icon}</div>}
		<p className="text-fg-muted">{message}</p>
	</div>
);
