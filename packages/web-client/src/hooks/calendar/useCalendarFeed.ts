/**
 * A calendar's secret subscription address, as the settings surface holds it
 * (issue #1067).
 *
 * The plaintext token exists in exactly one place: the answer to the write that
 * minted it. It is kept here until the reader dismisses it and is never read
 * back — the server stores a hash, so a lost address is rotated rather than
 * recovered.
 *
 * The read owns its 404 and its 403 and nothing else. "This calendar has no
 * feed" and "this calendar is not yours" are both answers the card states where
 * it stands — the 404 as the offer to create one, the 403 as "couldn't read
 * whether it is shared", never as "not shared yet". A 401 is the session gone,
 * and no banner on this card signs anyone back in, so it escalates.
 */
import {
	calendarDetailOperationsGetCalendarFeedOptions,
	calendarDetailOperationsGetCalendarFeedQueryKey,
	calendarDetailOperationsPutCalendarFeedMutation,
	calendarDetailOperationsRevokeCalendarFeedMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { calendarFeedUrl } from "@/lib/calendar-feed-url";
import {
	isNotFound,
	softErrorMeta,
	softErrorStatuses,
} from "@/lib/error-classifier";

export type CalendarFeedState =
	| { status: "loading" }
	/** The server answered, and this calendar is not shared. */
	| { status: "absent" }
	| { status: "active"; createdAt: number; rotatedAt: number }
	/** The server refused to say, which is not the same as "not shared". */
	| { status: "unreadable"; error: unknown };

export interface CalendarFeedControls {
	state: CalendarFeedState;
	/** The address just minted, shown once. Empty at every other moment. */
	mintedUrl: string;
	isBusy: boolean;
	/** A create, rotate or revoke the server turned down. */
	actionError: unknown;
	mint: () => void;
	revoke: () => void;
	dismissMinted: () => void;
	retry: () => void;
}

export function useCalendarFeed(calendarId: string): CalendarFeedControls {
	const queryClient = useQueryClient();
	const [mintedUrl, setMintedUrl] = useState("");

	const queryKey = calendarDetailOperationsGetCalendarFeedQueryKey({
		path: { calendarId },
	});

	const query = useQuery({
		...calendarDetailOperationsGetCalendarFeedOptions({
			path: { calendarId },
		}),
		meta: softErrorStatuses(404, 403),
		retry: false,
	});

	const invalidate = () => {
		queryClient.invalidateQueries({ queryKey });
	};

	// Each write clears the other's refusal as it starts, so the card never
	// states a failure the reader has already written past. Only one of the two
	// can name the other directly; the revoke is declared first and reaches
	// forward through this ref.
	const resetMint = useRef<() => void>(() => {});

	const revokeMutation = useMutation({
		...calendarDetailOperationsRevokeCalendarFeedMutation(),
		meta: softErrorMeta,
		onMutate: () => {
			resetMint.current();
		},
		onSuccess: () => {
			setMintedUrl("");
			invalidate();
		},
	});

	const mintMutation = useMutation({
		...calendarDetailOperationsPutCalendarFeedMutation(),
		meta: softErrorMeta,
		// The answer to this write is the plaintext token. Nothing may hold it
		// once the surface showing it lets go, so it is collected the moment the
		// observer detaches — on dismissal, and on leaving the page — instead of
		// sitting in the mutation cache for the default five minutes.
		gcTime: 0,
		onMutate: () => {
			revokeMutation.reset();
		},
		onSuccess: (data) => {
			setMintedUrl(calendarFeedUrl(window.location.host, data.feedToken));
			invalidate();
		},
	});

	resetMint.current = mintMutation.reset;

	const { mutate: mintFeed, reset: resetMintMutation } = mintMutation;
	const { mutate: revokeFeed } = revokeMutation;

	const mint = useCallback(() => {
		mintFeed({ path: { calendarId } });
	}, [calendarId, mintFeed]);

	const revoke = useCallback(() => {
		revokeFeed({ path: { calendarId } });
	}, [calendarId, revokeFeed]);

	// Resetting the mutation drops the answer that carried the plaintext token,
	// which otherwise sits in the mutation cache for its whole gcTime after the
	// reader has said they saved it.
	const dismissMinted = useCallback(() => {
		setMintedUrl("");
		resetMintMutation();
	}, [resetMintMutation]);

	const { refetch } = query;
	const retry = useCallback(() => {
		refetch();
	}, [refetch]);

	return {
		state: readState(query),
		mintedUrl,
		isBusy: mintMutation.isPending || revokeMutation.isPending,
		actionError: mintMutation.error ?? revokeMutation.error,
		mint,
		revoke,
		dismissMinted,
		retry,
	};
}

interface FeedQuery {
	data?: { createdAt: number; rotatedAt: number };
	error: unknown;
	isPending: boolean;
}

function readState(query: FeedQuery): CalendarFeedState {
	if (query.error) {
		if (isNotFound(query.error)) return { status: "absent" };
		return { status: "unreadable", error: query.error };
	}
	if (query.isPending) return { status: "loading" };
	if (!query.data) return { status: "absent" };
	return {
		status: "active",
		createdAt: query.data.createdAt,
		rotatedAt: query.data.rotatedAt,
	};
}
