export interface SignOutMenuVisibilityInput {
	configured: boolean;
	authStatus: string | undefined;
}

export const isSignOutVisible = ({
	configured,
	authStatus,
}: SignOutMenuVisibilityInput): boolean =>
	configured && authStatus === "authenticated";
