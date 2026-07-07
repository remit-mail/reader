import { COGNITO_FOOTER_NOTE } from "@remit/ui";

export type AccountMenuMode = "betterAuth" | "cognito" | "none";

export interface AccountMenuModeInput {
	betterAuthEnabled: boolean;
	cognitoConfigured: boolean;
}

export const accountMenuMode = ({
	betterAuthEnabled,
	cognitoConfigured,
}: AccountMenuModeInput): AccountMenuMode => {
	if (betterAuthEnabled) return "betterAuth";
	if (cognitoConfigured) return "cognito";
	return "none";
};

/**
 * The sign-in footer caption names Cognito only when Cognito is the active
 * provider. Every other mode falls through to the kit's provider-neutral
 * default, so the caption can never claim an identity provider the build does
 * not use.
 */
export const authFooterNote = (
	input: AccountMenuModeInput,
): string | undefined =>
	accountMenuMode(input) === "cognito" ? COGNITO_FOOTER_NOTE : undefined;
