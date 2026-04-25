const store = () => {
	globalThis.__REMIT_CLIENT_MOCKS__ = globalThis.__REMIT_CLIENT_MOCKS__ ?? {
		requestFns: [],
	};
	return globalThis.__REMIT_CLIENT_MOCKS__;
};

export const client = {
	interceptors: {
		request: {
			use: (fn) => {
				store().requestFns.push(fn);
			},
		},
	},
};
