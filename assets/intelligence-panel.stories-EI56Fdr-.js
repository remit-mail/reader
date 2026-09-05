import{j as k}from"./iframe-uufGNBEn.js";import{I as w}from"./intelligence-panel-D1iqemFc.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./semantic-off-D8uH6i9k.js";import"./app-shell-types--0yhHeoL.js";import"./avatar-B5mDLuXx.js";import"./badge-DS2l7jE5.js";import"./button-Wi0n0Lyz.js";import"./calendar-event-chip-0RvRJ_3A.js";import"./calendar-event-chip-content-B1wiJu2l.js";import"./calendar-color-CqvBY603.js";import"./repeat-BnlNct4V.js";import"./createLucideIcon-Bn-Stmx4.js";import"./mail-DXm5QBOT.js";import"./globe-axgt3PNC.js";import"./calendar-invite-card-Bsrui_DD.js";import"./attendee-row-DkgrLHvh.js";import"./minus-WgJswgYh.js";import"./x-CuwWA0oJ.js";import"./clock-Cx4gZNlA.js";import"./check-BSgP79ub.js";import"./calendar-clash-strip-D9om_lyL.js";import"./triangle-alert-BMnL-Txz.js";import"./calendar-parse-badge-CoW4c8u0.js";import"./file-text-wmSXByn2.js";import"./map-pin-DUH0Cs8a.js";import"./trash-2-RI1RlAl9.js";import"./calendar-slot-offers-CJbGrqsR.js";import"./calendar-suggestion-deck-B4abb1UG.js";import"./sparkles-CHnxu8zM.js";import"./event-suggestion-card-qc4GCypU.js";import"./blocked-reason-C4Upi9m5.js";import"./plus-ZS84sF7u.js";import"./calendar-days-58zuD6Ac.js";import"./segmented-control-Cjrb0mMe.js";import"./star-Cwq7Iobx.js";import"./shield-check-Bbdlr8b9.js";import"./shield-alert-CwV1s3Qj.js";const e={sender:{name:"Alex Rivera",email:"alex@example.com",trust:"wellknown",firstSeenLabel:"Jan 2025"},authenticity:{verdict:"aligned",fromDomain:"example.com",dkimDomain:"example.com",summary:"This message was signed by example.com."},category:{value:"personal"},similar:[]},me={title:"Screens/Kit/IntelligencePanel",component:w,parameters:{layout:"centered"}},m={args:{data:e}},d={args:{data:{...e,sender:{name:"Notifications",email:"no-reply@unknown-source.example",trust:"unknown",firstSeenLabel:"today"},authenticity:{verdict:"caution",fromDomain:"unknown-source.example",summary:"We can't verify the sender of this email, which could mean it's from an insecure source."}}}},c={args:{data:{...e,sender:{name:"InfoMedics",email:"jira@serviceupdatebank.atlassian.net",trust:"unknown",firstSeenLabel:"today"},category:{value:"automated"},authenticity:{verdict:"caution",fromDomain:"serviceupdatebank.atlassian.net",dkimDomain:"custmx.one.com",claimedBrand:"InfoMedics",summary:'The name it shows, "InfoMedics", has nothing to do with serviceupdatebank.atlassian.net. Its links go to betaal-vordering.example.'}}}},l={args:{data:{...e,sender:{name:"InfoMedics",email:"billing@1nfomedics.nl",trust:"unknown",firstSeenLabel:"today"},category:{value:"transactional"},authenticity:{verdict:"caution",fromDomain:"1nfomedics.nl",dkimDomain:"1nfomedics.nl",claimedBrand:"InfoMedics",summary:'The name it shows, "InfoMedics", only looks like 1nfomedics.nl.'}}}},p={args:{data:{...e,sender:{name:"Your Bank",email:"security@your-bank.example",trust:"unknown",firstSeenLabel:"today"},category:{value:"automated"},authenticity:{verdict:"mismatch",fromDomain:"your-bank.example",dkimDomain:"mailer.suspicious.example",claimedBrand:"Your Bank",summary:'The display name claims "Your Bank", but this message was actually sent from mailer.suspicious.example — not your-bank.example. Real senders use their own address.',similarCount:4}}}},u={args:{data:{...e,sender:{name:"Mailbox Admin",email:"missing_mailbox@missing_domain",trust:"unknown",firstSeenLabel:"today",addressUnverified:!0},category:{value:"uncategorized"},authenticity:{verdict:"mismatch",fromDomain:"",addressUnreadable:!0,summary:"We couldn't read this sender's address, so we can't confirm who really sent this message."}}}},h={args:{similarLinkComponent:({mailboxId:g,threadId:b,messageId:f,className:y,ariaLabel:S,children:v})=>k.jsx("a",{href:`/mail/${g}/${b}/${f}`,className:y,"aria-label":S,children:v}),data:{...e,similar:[{id:"msg-1",mailboxId:"mbx-1",threadId:"thr-msg-1",fromName:"Alex Rivera",subject:"Re: Q3 planning notes",timeLabel:"Jan 17",matched:"subject"},{id:"msg-2",mailboxId:"mbx-1",threadId:"thr-msg-2",fromName:"Billing",subject:"Your invoice is ready",timeLabel:"Yesterday",matched:"body"},{id:"msg-3",mailboxId:"mbx-2",threadId:"thr-msg-3",fromName:"",subject:"(No subject)",timeLabel:"Dec 4, 2024",matched:"sender"}]}}},a={args:{data:e,similarState:"off"}},s={args:{data:e,similarState:"error"}},r={args:{data:e,actions:{onReportSpam:()=>{}}}},t={args:{data:e,actions:{onNotSpam:()=>{}}}},n={args:{data:e,actions:{}}},i={args:{data:e,actions:{onReportSpam:()=>{}},reportSpamPending:!0}},o={args:{data:e,actions:{onNotSpam:()=>{}},notSpamPending:!0}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  args: {
    data: base
  }
}`,...m.parameters?.docs?.source}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: {
    data: {
      ...base,
      sender: {
        name: "Notifications",
        email: "no-reply@unknown-source.example",
        trust: "unknown",
        firstSeenLabel: "today"
      },
      authenticity: {
        verdict: "caution",
        fromDomain: "unknown-source.example",
        summary: "We can't verify the sender of this email, which could mean it's from an insecure source."
      }
    }
  }
}`,...d.parameters?.docs?.source}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: {
    data: {
      ...base,
      sender: {
        name: "InfoMedics",
        email: "jira@serviceupdatebank.atlassian.net",
        trust: "unknown",
        firstSeenLabel: "today"
      },
      category: {
        value: "automated"
      },
      authenticity: {
        verdict: "caution",
        fromDomain: "serviceupdatebank.atlassian.net",
        // Deliberately a different domain than fromDomain: the display-name
        // check compared "InfoMedics" against the sender's own domain, never
        // this one, so the summary must name serviceupdatebank.atlassian.net.
        dkimDomain: "custmx.one.com",
        claimedBrand: "InfoMedics",
        summary: 'The name it shows, "InfoMedics", has nothing to do with serviceupdatebank.atlassian.net. Its links go to betaal-vordering.example.'
      }
    }
  }
}`,...c.parameters?.docs?.source}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  args: {
    data: {
      ...base,
      sender: {
        name: "InfoMedics",
        email: "billing@1nfomedics.nl",
        trust: "unknown",
        firstSeenLabel: "today"
      },
      category: {
        value: "transactional"
      },
      authenticity: {
        verdict: "caution",
        fromDomain: "1nfomedics.nl",
        dkimDomain: "1nfomedics.nl",
        claimedBrand: "InfoMedics",
        summary: 'The name it shows, "InfoMedics", only looks like 1nfomedics.nl.'
      }
    }
  }
}`,...l.parameters?.docs?.source}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  args: {
    data: {
      ...base,
      sender: {
        name: "Your Bank",
        email: "security@your-bank.example",
        trust: "unknown",
        firstSeenLabel: "today"
      },
      category: {
        value: "automated"
      },
      authenticity: {
        verdict: "mismatch",
        fromDomain: "your-bank.example",
        dkimDomain: "mailer.suspicious.example",
        claimedBrand: "Your Bank",
        summary: 'The display name claims "Your Bank", but this message was actually sent from mailer.suspicious.example — not your-bank.example. Real senders use their own address.',
        similarCount: 4
      }
    }
  }
}`,...p.parameters?.docs?.source}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  args: {
    data: {
      ...base,
      sender: {
        name: "Mailbox Admin",
        email: "missing_mailbox@missing_domain",
        trust: "unknown",
        firstSeenLabel: "today",
        addressUnverified: true
      },
      category: {
        value: "uncategorized"
      },
      authenticity: {
        verdict: "mismatch",
        fromDomain: "",
        addressUnreadable: true,
        summary: "We couldn't read this sender's address, so we can't confirm who really sent this message."
      }
    }
  }
}`,...u.parameters?.docs?.source}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  args: {
    similarLinkComponent: ({
      mailboxId,
      threadId,
      messageId,
      className,
      ariaLabel,
      children
    }) => <a href={\`/mail/\${mailboxId}/\${threadId}/\${messageId}\`} className={className} aria-label={ariaLabel}>
                {children}
            </a>,
    data: {
      ...base,
      similar: [{
        id: "msg-1",
        mailboxId: "mbx-1",
        threadId: "thr-msg-1",
        fromName: "Alex Rivera",
        subject: "Re: Q3 planning notes",
        timeLabel: "Jan 17",
        matched: "subject"
      }, {
        id: "msg-2",
        mailboxId: "mbx-1",
        threadId: "thr-msg-2",
        fromName: "Billing",
        subject: "Your invoice is ready",
        timeLabel: "Yesterday",
        matched: "body"
      }, {
        id: "msg-3",
        mailboxId: "mbx-2",
        threadId: "thr-msg-3",
        fromName: "",
        subject: "(No subject)",
        timeLabel: "Dec 4, 2024",
        matched: "sender"
      }]
    }
  }
}`,...h.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    data: base,
    similarState: "off"
  }
}`,...a.parameters?.docs?.source},description:{story:`Semantic search is off on this instance (#1068). The section states the
setting, what turning it on buys — the Organize widen and semantic filters —
and the command, rather than rendering nothing and reading as a sender
nothing resembles.`,...a.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    data: base,
    similarState: "error"
  }
}`,...s.parameters?.docs?.source},description:{story:"The runtime failure, for contrast: a retry might work, so it says no more.",...s.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    data: base,
    actions: {
      onReportSpam: () => {}
    }
  }
}`,...r.parameters?.docs?.source},description:{story:`The spam quick actions are a contextual pair, decided by whether the message
carries a spam report — never by the mailbox it happens to sit in, since a
report on a message already in Junk (the provider's own filter put it there)
is a real, no-op-move case (issue #648). A reportable message offers
"Report spam".`,...r.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    data: base,
    actions: {
      onNotSpam: () => {}
    }
  }
}`,...t.parameters?.docs?.source},description:{story:'Already reported: "Not spam" (the undo) is offered instead of "Report\nspam", and the panel names the message as reported. Driven by\n`actions.onNotSpam` being present, not by `flags.blocked` — a sender can be\nblocked manually, with no report on this particular message, and that must\nnot read as "you reported this" (issue #648 review).',...t.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    data: base,
    actions: {}
  }
}`,...n.parameters?.docs?.source},description:{story:`Neither action is offered. The panel hides the pair rather than disabling
it — unlike VIP/Mute/Unsubscribe, which always render and go visibly
unavailable with no handler (issue #51). The host's own wiring never
actually reaches this: \`resolveSpamAction\` always returns one of the two,
since every message either carries a spam report or doesn't. Kept as a
defensive state for a host that doesn't wire the pair at all.`,...n.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    data: base,
    actions: {
      onReportSpam: () => {}
    },
    reportSpamPending: true
  }
}`,...i.parameters?.docs?.source},description:{story:`A "Report spam" press in flight. There's no optimistic update for this
action (a report against a message already in Junk is a real no-op-move,
issue #648), so without a pending label the button gives no visible
response at all until the request lands — the dead-button failure the
coding standards call the worst outcome. The button is disabled for the
duration: the server dedupes message ids only within a single request, so
a second press mid-flight would fire a second, concurrent request rather
than join the first (issue #648 review). Still visibly a button, never
dead — the "Reporting…" label carries that.`,...i.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    data: base,
    actions: {
      onNotSpam: () => {}
    },
    notSpamPending: true
  }
}`,...o.parameters?.docs?.source},description:{story:'The undo direction\'s equivalent — "Undoing…" while `notSpam` is in flight.',...o.parameters?.docs?.description}}};const de=["Aligned","CautionNoSignal","SignedButUnrecognised","SignedButLookalikeName","Impersonation","UnreadableSender","WithSimilarMessages","SimilarMessagesOff","SimilarMessagesUnavailable","Reportable","Reported","SpamActionUnavailable","ReportSpamPending","NotSpamPending"];export{m as Aligned,d as CautionNoSignal,p as Impersonation,o as NotSpamPending,i as ReportSpamPending,r as Reportable,t as Reported,l as SignedButLookalikeName,c as SignedButUnrecognised,a as SimilarMessagesOff,s as SimilarMessagesUnavailable,n as SpamActionUnavailable,u as UnreadableSender,h as WithSimilarMessages,de as __namedExportsOrder,me as default};
