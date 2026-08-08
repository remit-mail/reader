import { ComposeSmtpMissingBanner as Banner } from "@remit/ui";
import { useNavigate } from "@tanstack/react-router";

interface ComposeSmtpMissingBannerProps {
	accountId: string;
}

/** Sends "Configure SMTP" to the account's settings panel. */
export const ComposeSmtpMissingBanner = ({
	accountId,
}: ComposeSmtpMissingBannerProps) => {
	const navigate = useNavigate();

	return (
		<Banner
			onConfigure={() => {
				navigate({
					to: "/settings/accounts",
					search: { editAccountId: accountId, focusSmtp: true },
				});
			}}
		/>
	);
};
