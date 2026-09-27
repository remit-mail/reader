import { useCallback } from "react";
import { useOpenReply } from "@/routing";
import { useCompose } from "./ComposeProvider";

export interface AnsweredMessage {
	threadId: string;
	messageId: string;
}

export type ReplyWithText = (message: AnsweredMessage, text: string) => void;

export function useReplyWithText(): ReplyWithText {
	const { insertIntoOpenReply } = useCompose();
	const openReply = useOpenReply();
	return useCallback(
		(message: AnsweredMessage, text: string) => {
			if (insertIntoOpenReply(message.messageId, text)) return;
			openReply({ ...message, mode: "reply" }, { body: text });
		},
		[insertIntoOpenReply, openReply],
	);
}
