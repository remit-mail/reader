export const sessionStore = (): Storage | null => {
	try {
		return globalThis.sessionStorage ?? null;
	} catch {
		return null;
	}
};
