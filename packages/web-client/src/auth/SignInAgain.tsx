import { useAuthProvider } from "@/auth/provider";

export function SignInAgain() {
	const { Account } = useAuthProvider();
	return (
		<Account>
			{({ signOut }) => (
				<button
					type="button"
					onClick={() => signOut()}
					className="rounded-md border border-line px-2.5 py-1 text-sm font-medium text-fg outline-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-ring"
				>
					Sign in again
				</button>
			)}
		</Account>
	);
}
