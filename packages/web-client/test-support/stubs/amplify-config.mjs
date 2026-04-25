const mocks = () => {
	globalThis.__AMPLIFY_CONFIG_MOCKS__ = globalThis.__AMPLIFY_CONFIG_MOCKS__ ?? {
		configured: true,
		configureCalls: 0,
	};
	return globalThis.__AMPLIFY_CONFIG_MOCKS__;
};

export const isCognitoConfigured = () => mocks().configured;

export const configureAmplify = () => {
	mocks().configureCalls += 1;
};
