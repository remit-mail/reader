import { useCallback, useState } from "react";

interface SignatureData {
	html: string;
	plainText: string;
}

const EMPTY_SIGNATURE: SignatureData = { html: "", plainText: "" };

const getStorageKey = (accountId: string) => `remit:signature:${accountId}`;

export const useSignature = (accountId?: string) => {
	const [signature, setSignatureState] = useState<SignatureData>(() => {
		if (!accountId) return EMPTY_SIGNATURE;
		const stored = localStorage.getItem(getStorageKey(accountId));
		if (!stored) return EMPTY_SIGNATURE;
		return JSON.parse(stored) as SignatureData;
	});

	const setSignature = useCallback(
		(html: string, plainText: string) => {
			if (!accountId) return;
			const data = { html, plainText };
			localStorage.setItem(getStorageKey(accountId), JSON.stringify(data));
			setSignatureState(data);
		},
		[accountId],
	);

	return { signature, setSignature };
};
