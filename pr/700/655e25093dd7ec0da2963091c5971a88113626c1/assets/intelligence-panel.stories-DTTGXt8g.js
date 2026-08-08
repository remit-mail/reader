import{j as f}from"./iframe-fAVmrNjG.js";import{I as k}from"./intelligence-panel-Jnjku8Bd.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";import"./avatar-CaxZOEiX.js";import"./badge-CS1LQW7q.js";import"./button-C4vqyepI.js";import"./x-CiqSzl9P.js";import"./createLucideIcon-E7hVbHyY.js";import"./star-DbXDvn6U.js";import"./bell-off-Aa9kf2Qp.js";import"./sparkles-DroEPvOz.js";import"./shield-check-DfJr7dAZ.js";import"./shield-alert-C2HtGUTP.js";const e={sender:{name:"Alex Rivera",email:"alex@example.com",trust:"wellknown",firstSeenLabel:"Jan 2025"},authenticity:{verdict:"aligned",fromDomain:"example.com",dkimDomain:"example.com",summary:"This message was signed by example.com."},category:{value:"Personal"},similar:[]},T={title:"Screens/Kit/IntelligencePanel",component:k,parameters:{layout:"centered"}},i={args:{data:e}},o={args:{data:{...e,sender:{name:"Notifications",email:"no-reply@unknown-source.example",trust:"unknown",firstSeenLabel:"today"},authenticity:{verdict:"caution",fromDomain:"unknown-source.example",summary:"We can't verify the sender of this email, which could mean it's from an insecure source."}}}},m={args:{data:{...e,sender:{name:"InfoMedics",email:"jira@serviceupdatebank.atlassian.net",trust:"unknown",firstSeenLabel:"today"},category:{value:"Automated"},authenticity:{verdict:"caution",fromDomain:"serviceupdatebank.atlassian.net",dkimDomain:"custmx.one.com",claimedBrand:"InfoMedics",summary:'The name it shows, "InfoMedics", has nothing to do with serviceupdatebank.atlassian.net. Its links go to betaal-vordering.example.'}}}},d={args:{data:{...e,sender:{name:"InfoMedics",email:"billing@1nfomedics.nl",trust:"unknown",firstSeenLabel:"today"},category:{value:"Transactional"},authenticity:{verdict:"caution",fromDomain:"1nfomedics.nl",dkimDomain:"1nfomedics.nl",claimedBrand:"InfoMedics",summary:'The name it shows, "InfoMedics", only looks like 1nfomedics.nl.'}}}},c={args:{data:{...e,sender:{name:"Your Bank",email:"security@your-bank.example",trust:"unknown",firstSeenLabel:"today"},category:{value:"Phishing"},authenticity:{verdict:"mismatch",fromDomain:"your-bank.example",dkimDomain:"mailer.suspicious.example",claimedBrand:"Your Bank",summary:'The display name claims "Your Bank", but this message was actually sent from mailer.suspicious.example — not your-bank.example. Real senders use their own address.',similarCount:4}}}},l={args:{data:{...e,sender:{name:"Mailbox Admin",email:"missing_mailbox@missing_domain",trust:"unknown",firstSeenLabel:"today",addressUnverified:!0},category:{value:"Phishing"},authenticity:{verdict:"mismatch",fromDomain:"",addressUnreadable:!0,summary:"We couldn't read this sender's address, so we can't confirm who really sent this message."}}}},u={args:{similarLinkComponent:({mailboxId:p,messageId:h,className:g,ariaLabel:b,children:y})=>f.jsx("a",{href:`/mail/${p}?selectedMessageId=${h}`,className:g,"aria-label":b,children:y}),data:{...e,similar:[{id:"msg-1",mailboxId:"mbx-1",fromName:"Alex Rivera",subject:"Re: Q3 planning notes",timeLabel:"Jan 17",matched:"subject"},{id:"msg-2",mailboxId:"mbx-1",fromName:"Billing",subject:"Your invoice is ready",timeLabel:"Yesterday",matched:"body"},{id:"msg-3",mailboxId:"mbx-2",fromName:"",subject:"(No subject)",timeLabel:"Dec 4, 2024",matched:"sender"}]}}},a={args:{data:e,actions:{onReportSpam:()=>{}}}},s={args:{data:e,actions:{onNotSpam:()=>{}}}},n={args:{data:e,actions:{}}},r={args:{data:e,actions:{onReportSpam:()=>{}},reportSpamPending:!0}},t={args:{data:e,actions:{onNotSpam:()=>{}},notSpamPending:!0}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    data: base
  }
}`,...i.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
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
}`,...o.parameters?.docs?.source}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
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
        value: "Automated"
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
}`,...m.parameters?.docs?.source}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
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
        value: "Transactional"
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
}`,...d.parameters?.docs?.source}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
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
        value: "Phishing"
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
}`,...c.parameters?.docs?.source}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
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
        value: "Phishing"
      },
      authenticity: {
        verdict: "mismatch",
        fromDomain: "",
        addressUnreadable: true,
        summary: "We couldn't read this sender's address, so we can't confirm who really sent this message."
      }
    }
  }
}`,...l.parameters?.docs?.source}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  args: {
    similarLinkComponent: ({
      mailboxId,
      messageId,
      className,
      ariaLabel,
      children
    }) => <a href={\`/mail/\${mailboxId}?selectedMessageId=\${messageId}\`} className={className} aria-label={ariaLabel}>
                {children}
            </a>,
    data: {
      ...base,
      similar: [{
        id: "msg-1",
        mailboxId: "mbx-1",
        fromName: "Alex Rivera",
        subject: "Re: Q3 planning notes",
        timeLabel: "Jan 17",
        matched: "subject"
      }, {
        id: "msg-2",
        mailboxId: "mbx-1",
        fromName: "Billing",
        subject: "Your invoice is ready",
        timeLabel: "Yesterday",
        matched: "body"
      }, {
        id: "msg-3",
        mailboxId: "mbx-2",
        fromName: "",
        subject: "(No subject)",
        timeLabel: "Dec 4, 2024",
        matched: "sender"
      }]
    }
  }
}`,...u.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    data: base,
    actions: {
      onReportSpam: () => {}
    }
  }
}`,...a.parameters?.docs?.source},description:{story:`The spam quick actions are a contextual pair, decided by whether the message
carries a spam report — never by the mailbox it happens to sit in, since a
report on a message already in Junk (the provider's own filter put it there)
is a real, no-op-move case (issue #648). A reportable message offers
"Report spam".`,...a.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    data: base,
    actions: {
      onNotSpam: () => {}
    }
  }
}`,...s.parameters?.docs?.source},description:{story:'Already reported: "Not spam" (the undo) is offered instead of "Report\nspam", and the panel names the message as reported. Driven by\n`actions.onNotSpam` being present, not by `flags.blocked` — a sender can be\nblocked manually, with no report on this particular message, and that must\nnot read as "you reported this" (issue #648 review).',...s.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    data: base,
    actions: {}
  }
}`,...n.parameters?.docs?.source},description:{story:`Neither action is offered. The panel hides the pair rather than disabling
it — unlike VIP/Mute/Unsubscribe, which always render and go visibly
unavailable with no handler (issue #51). The host's own wiring never
actually reaches this: \`resolveSpamAction\` always returns one of the two,
since every message either carries a spam report or doesn't. Kept as a
defensive state for a host that doesn't wire the pair at all.`,...n.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    data: base,
    actions: {
      onReportSpam: () => {}
    },
    reportSpamPending: true
  }
}`,...r.parameters?.docs?.source},description:{story:`A "Report spam" press in flight. There's no optimistic update for this
action (a report against a message already in Junk is a real no-op-move,
issue #648), so without a pending label the button gives no visible
response at all until the request lands — the dead-button failure the
coding standards call the worst outcome. The button is disabled for the
duration: the server dedupes message ids only within a single request, so
a second press mid-flight would fire a second, concurrent request rather
than join the first (issue #648 review). Still visibly a button, never
dead — the "Reporting…" label carries that.`,...r.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    data: base,
    actions: {
      onNotSpam: () => {}
    },
    notSpamPending: true
  }
}`,...t.parameters?.docs?.source},description:{story:'The undo direction\'s equivalent — "Undoing…" while `notSpam` is in flight.',...t.parameters?.docs?.description}}};const U=["Aligned","CautionNoSignal","SignedButUnrecognised","SignedButLookalikeName","Impersonation","UnreadableSender","WithSimilarMessages","Reportable","Reported","SpamActionUnavailable","ReportSpamPending","NotSpamPending"];export{i as Aligned,o as CautionNoSignal,c as Impersonation,t as NotSpamPending,r as ReportSpamPending,a as Reportable,s as Reported,d as SignedButLookalikeName,m as SignedButUnrecognised,n as SpamActionUnavailable,l as UnreadableSender,u as WithSimilarMessages,U as __namedExportsOrder,T as default};
