/**
 * Authentication is its own kind because it is the one class that never
 * resolves itself: an expired grant or a changed password fails identically
 * forever, and it is the most common way a self-hosted mailbox goes quiet.
 */
export type MailFailureKind = "auth" | "network" | "other";
