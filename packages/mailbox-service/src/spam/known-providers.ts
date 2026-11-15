export const KNOWN_PROVIDERS: readonly string[] = [
	"google.com",
	"messagingengine.com",
	"microsoft.com",
	"outlook.com",
	"yahoo.com",
	"icloud.com",
];

export const isKnownProvider = (domain: string): boolean =>
	KNOWN_PROVIDERS.some(
		(known) => domain === known || domain.endsWith(`.${known}`),
	);
