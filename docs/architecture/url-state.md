# URL state rules

URL state is anything the app reads back out of the address bar: the path, the query string and the fragment. No fact lives in more than one of the three, and which tier holds it is decided by what the fact does, not by what is convenient at the call site. The path decides which components mount, so "opened" and "rendered" are one fact and no code arbitrates between them.

## R1. Path: which view

Which list, which thread, which message, which surface. A path matches one thing at a time, so two surfaces cannot both claim the same pane. Choosing a view is a navigation, and the route mounts the component.

## R2. Query: sub-state that modifies the current view

`q`, filters, the wizard step (`wizard` / `wizardFrom`). Test: if this changed and the mounted component set stayed identical, it is query.

## R3. Fragment: panel and pane visibility, nothing else

No identity, no payload, no selection, no focus target. A closed literal union.

## R4. One owner per fact

If it is in the path it is not in the query, and anything derivable from the path is not stored at all. A query param that compensates for a missing path segment is the smell, and the segment is the fix.

## R5. Path for exclusive state, blob for the last mile

Anything mutually exclusive is a path segment, because sibling routes cannot both match. Fine-grained sub-state that genuinely combines may travel as a zod-validated JSON blob in the query, such as a saved search's filter set. The blob never names the surface on screen; the moment it decides what gets mounted, the arbiter is back.

## R6. A transient selection is never URL state

A modal carrying a transient selection never goes in the fragment: `#confirm-delete` reloads into "Move 12 messages to Trash" with an empty selection. Test: if the overlay's own copy is computed from in-memory data, it is not URL state at any tier.

Qualifies for the fragment: the intelligence rail, the nav slide-over, the shortcuts sheet, and the filter sheet's open/closed state (its values are query). Does not qualify: the bulk-delete confirm, the move picker, row action menus, the selection wizard's selection, the self-update overlay, the fatal-error and quarantine dialogs, the delete-account, folder and label confirms, and the compose discard confirm.

## R7. One schema

Any JSON in the URL validates against the same zod schema its domain already uses: import it and `z.infer` the type. Never hand-write a second shape for the URL, because a URL-only copy drifts from the domain it mirrors and the read site pays for it with a cast.

## The route shape

`/mail/<list>/<thread>/<message>`, where the first segment is the list you are browsing, not the thread's home folder. `/mail/brief/<thread>/<message>` is legal, because threads are opened from the brief and from search while living in another folder.

Lists are `brief`, `flagged`, `outbox` and `<mailboxId>`. Mailbox ids are UUIDs and TanStack matches literals first, so there is no collision.

Each list is a layout route whose component renders the list plus `AppShellSlotted` with `reading={<Outlet/>}`. The detail surface is a child route of the list it was opened from, so co-location comes from the router.

```
/mail                         redirect to /mail/brief
/mail/brief                   list layout, reading={<Outlet/>}
  $threadId                   thread open
    $messageId                that message expanded and scrolled to
      $mode                   reply | reply-all | forward
  compose                     new message
/mail/flagged
/mail/outbox
/mail/$mailboxId
  $threadId                   thread open
    $messageId                that message expanded and scrolled to
      $mode                   reply | reply-all | forward
  compose                     new message
  draft/$outboxMessageId      under $mailboxId and outbox only
```

`compose` is a sibling of the thread route, so navigating there unmatches the thread in the same transition. No clearing code, no ordering, and a composer over an open thread is unrepresentable.

`$mode` sits under the message, so a reply cannot exist without a source and the thread stays matched behind it. That is what "the reply at the head of the conversation" is. Validate the mode as a path param, not as three literal routes.

## FAQ

**Why not `?action=compose&compose:replyTo=<messageId>`?** A query param combines with anything, so compose open and thread open become expressible at once and something has to choose between them. The `compose:` namespacing is itself the tell that the query is carrying hierarchy. With reply as a child route, `replyTo` disappears and the source is the path.

**Why not an optional `{-$mailboxId}` segment?** The installed router supports it, but it collapses the brief and a mailbox into one route with one component, and the component branches on whether it received a mailboxId: the arbiter, one level down.

**Is `?data={...}` allowed anywhere?** For last-mile detail that legitimately combines, validated against the domain's own zod schema. Never to name what is on screen: a bag holds any combination, so illegal states become representable again and the app has to parse and branch to decide what mounts.
