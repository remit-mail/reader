import { ComposeSmtpMissingBanner as Banner } from "@remit/ui";
import { useNavigate } from "@tanstack/react-router";
import type { Ref } from "react";

interface ComposeSmtpMissingBannerProps {
	accountId: string;
	configureRef?: Ref<HTMLButtonElement>;
}

/** Sends "Configure SMTP" to the account's settings panel. */
export const ComposeSmtpMissingBanner = ({
	accountId,
	configureRef,
}: ComposeSmtpMissingBannerProps) => {
	const navigate = useNavigate();

	return (
		<Banner
			configureRef={configureRef}
			onConfigure={() => {
				navigate({
					to: "/settings/accounts",
					search: { editAccountId: accountId, focusSmtp: true },
				});
			}}
		/>
	);
};
