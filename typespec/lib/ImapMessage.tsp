

model MailBox {
    lastSyncDate: utcDateTime;
    maildirName: string;
    user: string;
    password: string;
    host: string;
    port: int32;
    tls: boolean;
}

enum ImapMessageFlags {
    SEEN: "\\Seen",
    UNSEEN: "\\Unseen",
    IMPORTANT: "\\Important",
    ANSWERED: "\\Answered",
    DELETED: "\\Deleted",
    RECENT: "\\Recent"
}

model ImapMessage {
    attributes: {
        date: utcDateTime;
        flags: ImapMessageFlags;
        uid: int64;
        modseq: int64;
        extendedAttributes: Record<string | string[]>
    },
    body: string;
}


