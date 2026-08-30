/**
 * A calendar's secret subscription address, as the settings surface holds it
 * (issue #1067).
 *
 * The plaintext token exists in exactly one place: the answer to the write that
 * minted it. It is kept here until the reader dismisses it and is never read
 * back — the server stores a hash, so a lost address is rotated rather than
 * recovered.
 *
 * The read owns its 404 and nothing else. "This calendar has no feed" is a
 * legitimate answer to it, but a 401 or a 403 there is a session or a scope
 * problem, and a card that drew "not shared yet" for either would tell the
 * reader their calendar is private when nobody actually asked the server.
 */
import {
	calendarDetailOperationsGetCalendarFeedOptions,
	calendarDetailOperationsGetCalendarFeedQueryKey,
	calendarDetailOperationsPutCalendarFeedMutation,
	calendarDetailOperationsRevokeCalendarFeedMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
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
		meta: softErrorStatuses(404),
		retry: false,
	});

	const invalidate = () => {
		queryClient.invalidateQueries({ queryKey });
	};

	const mintMutation = useMutation({
		...calendarDetailOperationsPutCalendarFeedMutation(),
		meta: softErrorMeta,
		onSuccess: (data) => {
			setMintedUrl(calendarFeedUrl(window.location.host, data.feedToken));
			invalidate();
		},
	});

	const revokeMutation = useMutation({
		...calendarDetailOperationsRevokeCalendarFeedMutation(),
		meta: softErrorMeta,
		onSuccess: () => {
			setMintedUrl("");
			invalidate();
		},
	});

	const { mutate: mintFeed } = mintMutation;
	const { mutate: revokeFeed } = revokeMutation;

	const mint = useCallback(() => {
		mintFeed({ path: { calendarId } });
	}, [calendarId, mintFeed]);

	const revoke = useCallback(() => {
		revokeFeed({ path: { calendarId } });
	}, [calendarId, revokeFeed]);

	const dismissMinted = useCallback(() => setMintedUrl(""), []);

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
