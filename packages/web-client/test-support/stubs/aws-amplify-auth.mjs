const mocks = () => {
	globalThis.__AMPLIFY_AUTH_MOCKS__ = globalThis.__AMPLIFY_AUTH_MOCKS__ ?? {
		session: { tokens: {} },
		fetchCalls: 0,
		fetchImpl: null,
	};
	return globalThis.__AMPLIFY_AUTH_MOCKS__;
};

export const fetchAuthSession = async () => {
	const m = mocks();
	m.fetchCalls += 1;
	if (m.fetchImpl) return m.fetchImpl();
	return m.session;
};
