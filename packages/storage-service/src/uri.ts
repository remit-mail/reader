import { StorageType } from "@remit/domain-enums";

export type StorageTypeValue = (typeof StorageType)[keyof typeof StorageType];

export interface ParsedStorageUri {
	storageType: StorageTypeValue;
	storageLocation: string;
	storageKey: string;
}

export const parseStorageUri = (uri: string): ParsedStorageUri => {
	const url = new URL(uri);

	if (url.protocol === "s3:") {
		return {
			storageType: StorageType.S3,
			storageLocation: url.hostname,
			storageKey: url.pathname.slice(1),
		};
	}

	if (url.protocol === "file:") {
		return {
			storageType: StorageType.Filesystem,
			storageLocation: "",
			storageKey: url.pathname,
		};
	}

	throw new Error(`Unsupported storage URI scheme: ${url.protocol}`);
};

export const buildStorageUri = (
	storageType: StorageTypeValue,
	storageLocation: string,
	storageKey: string,
): string => {
	if (storageType === StorageType.S3) {
		return `s3://${storageLocation}/${storageKey}`;
	}

	if (storageType === StorageType.Filesystem) {
		return `file://${storageLocation}/${storageKey}`;
	}

	throw new Error(`Unsupported storage type: ${storageType}`);
};
