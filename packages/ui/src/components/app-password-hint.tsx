export interface AppPasswordHintProps {
	/** Resolved provider deep link; omit for the generic fallback. */
	url?: string;
}

export function AppPasswordHint({ url }: AppPasswordHintProps) {
	return (
		<p className="text-2xs text-fg-subtle">
			Stored encrypted, used only to connect to your mail server.{" "}
			{url ? (
				<a
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					className="text-accent underline"
				>
					How to create an app password
				</a>
			) : (
				<span>Check your provider's help for app password instructions.</span>
			)}
		</p>
	);
}
