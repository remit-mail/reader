export const isCognitoConfigured = () =>
	globalThis.__AMPLIFY_CONFIG_MOCKS__?.configured ?? true;

export const configureAmplify = () => {};
