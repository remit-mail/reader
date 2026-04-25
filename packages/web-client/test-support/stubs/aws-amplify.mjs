const mocks = () => {
	globalThis.__AMPLIFY_MOCKS__ = globalThis.__AMPLIFY_MOCKS__ ?? {
		configureCalls: [],
	};
	return globalThis.__AMPLIFY_MOCKS__;
};

export const Amplify = {
	configure: (config) => {
		mocks().configureCalls.push(config);
	},
};
