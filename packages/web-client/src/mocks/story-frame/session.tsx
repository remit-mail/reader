import { type AuthProvider, noneAuthProvider } from "@/auth/provider";

type RuntimeConfig = NonNullable<typeof globalThis.__REMIT_CONFIG__>;

export const signedInAs = (email: string): AuthProvider => ({
	...noneAuthProvider,
	Account: ({ children }) => (
		<>{children({ email, signOut: () => undefined })}</>
	),
});

export const withRuntimeConfig =
	(config: RuntimeConfig) => (): (() => void) => {
		const previous = globalThis.__REMIT_CONFIG__;
		globalThis.__REMIT_CONFIG__ = config;
		return () => {
			globalThis.__REMIT_CONFIG__ = previous;
		};
	};
