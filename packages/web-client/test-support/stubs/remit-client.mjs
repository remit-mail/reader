const store = () => {
	globalThis.__REMIT_CLIENT_MOCKS__ = globalThis.__REMIT_CLIENT_MOCKS__ ?? {
		requestFns: [],
		errorFns: [],
		responseFns: [],
	};
	return globalThis.__REMIT_CLIENT_MOCKS__;
};

export const client = {
	setConfig: () => {},
	interceptors: {
		request: {
			use: (fn) => {
				store().requestFns.push(fn);
			},
		},
		error: {
			use: (fn) => {
				store().errorFns.push(fn);
			},
		},
		response: {
			use: (fn) => {
				store().responseFns.push(fn);
			},
		},
	},
};
