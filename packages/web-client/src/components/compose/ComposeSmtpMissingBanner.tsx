import { ComposeSmtpMissingBanner as Banner } from "@remit/ui";
import type { Ref } from "react";
import { useConfigureAccountSmtp } from "@/routing";

interface ComposeSmtpMissingBannerProps {
	accountId: string;
	configureRef?: Ref<HTMLButtonElement>;
}

/** Sends "Configure SMTP" to the account's settings panel. */
export const ComposeSmtpMissingBanner = ({
	accountId,
	configureRef,
}: ComposeSmtpMissingBannerProps) => {
	const configureSmtp = useConfigureAccountSmtp();

	return (
		<Banner
			configureRef={configureRef}
			onConfigure={() => {
				configureSmtp(accountId);
			}}
		/>
	);
};
