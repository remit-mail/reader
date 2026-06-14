const mocks = () => {
	globalThis.__AWS_RUM_MOCKS__ = globalThis.__AWS_RUM_MOCKS__ ?? {
		instances: [],
	};
	return globalThis.__AWS_RUM_MOCKS__;
};

export class AwsRum {
	constructor(appMonitorId, version, region, config) {
		this.appMonitorId = appMonitorId;
		this.version = version;
		this.region = region;
		this.config = config;
		this.calls = { recordPageView: [], recordError: [], recordEvent: [] };
		mocks().instances.push(this);
	}

	recordPageView(path) {
		this.calls.recordPageView.push(path);
	}

	recordError(error) {
		this.calls.recordError.push(error);
	}

	recordEvent(name, attributes) {
		this.calls.recordEvent.push({ name, attributes });
	}
}
