import { useCallback } from "react";
import { useTranslation } from "react-i18next";

/**
 * `labelForMailbox` expects a positional `(key, fallback)` translator; i18next's
 * `t` reads its second argument as an options object, which drops the fallback.
 * Memoized so callers can hold it as a `useMemo` dependency.
 */
export const useFolderLabelTranslator = (): ((
	key: string,
	fallback: string,
) => string) => {
	const { t } = useTranslation("mail", { useSuspense: false });
	return useCallback(
		(key: string, fallback: string): string =>
			t(key, { defaultValue: fallback }),
		[t],
	);
};
