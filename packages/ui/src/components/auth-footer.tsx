export interface AuthFooterProps {
	note?: string;
}

export function AuthFooter(props?: AuthFooterProps) {
	const note = props?.note ?? "Secure sign-in powered by AWS Cognito";
	return (
		<div className="text-center pt-5">
			<p className="text-xs text-fg-muted">{note}</p>
		</div>
	);
}
