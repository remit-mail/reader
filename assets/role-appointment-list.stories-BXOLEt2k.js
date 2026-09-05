import{r as g,j as S}from"./iframe-uufGNBEn.js";import{R as N}from"./role-appointment-list-DVn4yR9V.js";import"./preload-helper-PPVm8Dsz.js";import"./folder-tree-ZE9Jqoy_.js";import"./banner-D7bQEtJc.js";import"./cn-d2XQ1MEC.js";import"./button-Wi0n0Lyz.js";import"./x-CuwWA0oJ.js";import"./createLucideIcon-Bn-Stmx4.js";import"./folder-role-DLEscJf7.js";import"./inbox-CimnAjxx.js";import"./file-text-wmSXByn2.js";import"./send-Auw0BsZV.js";import"./mails-DEIX_BNC.js";import"./octagon-alert-jmFTGl01.js";import"./trash-2-RI1RlAl9.js";import"./star-Cwq7Iobx.js";import"./input-Cs8KaoXd.js";import"./select-jAwdmlAP.js";import"./chevron-down-CGnGYV2L.js";import"./folder-C4FA7sra.js";import"./check-BSgP79ub.js";const e=[{mailboxId:"mb-inbox",providerPath:"INBOX",hierarchyDelimiter:"/",messageCount:4821},{mailboxId:"mb-archive",providerPath:"INBOX/Archive",hierarchyDelimiter:"/",messageCount:19243},{mailboxId:"mb-concepten",providerPath:"INBOX/Concepten",hierarchyDelimiter:"/",messageCount:340},{mailboxId:"mb-deleted",providerPath:"INBOX/Deleted Messages",hierarchyDelimiter:"/",messageCount:512},{mailboxId:"mb-drafts",providerPath:"INBOX/Drafts",hierarchyDelimiter:"/",messageCount:0},{mailboxId:"mb-news",providerPath:"INBOX/Nieuwsbrieven",hierarchyDelimiter:"/",messageCount:2870},{mailboxId:"mb-sent",providerPath:"INBOX/Sent",hierarchyDelimiter:"/",messageCount:0},{mailboxId:"mb-sent-messages",providerPath:"INBOX/Sent Messages",hierarchyDelimiter:"/",messageCount:6105},{mailboxId:"mb-spam",providerPath:"INBOX/Spam",hierarchyDelimiter:"/",messageCount:88}],o=p=>({mailboxId:p,source:"Appointed"}),r={inbox:{mailboxId:"mb-inbox",source:"Reserved"},drafts:o("mb-concepten"),sent:o("mb-sent-messages"),archive:o("mb-archive"),junk:o("mb-spam"),trash:o("mb-deleted")};function O({folders:p,initial:f}){const[x,I]=g.useState(f),[E,T]=g.useState({}),v=(u,h)=>{I(b=>({...b,[u]:{mailboxId:h,source:"Appointed"}}))},D=(u,h)=>T(b=>({...b,[u]:h.trim()}));return S.jsx("div",{className:"max-w-3xl p-8",children:S.jsx(N,{accountEmail:"440737+mvhenten@users.noreply.github.com",folders:p,appointments:x,displayNames:E,onAppoint:v,onRename:D})})}const V={title:"Settings/RoleAppointmentList",component:O},s={args:{folders:e,initial:r}},a={args:{folders:e,initial:{...r,drafts:{mailboxId:"mb-drafts",source:"Flagged"},sent:{mailboxId:"mb-sent",source:"Flagged"}}}},n={name:"appointed",args:{folders:e,initial:r}},t={name:"flagged",args:{folders:e,initial:{...r,trash:{mailboxId:"mb-deleted",source:"Flagged"}}}},i={name:"reserved",args:{folders:e,initial:{...r,inbox:{mailboxId:"mb-inbox",source:"Reserved"}}}},d={name:"proposed",args:{folders:e,initial:{...r,trash:{mailboxId:"mb-deleted",source:"Proposed"}}}},m={name:"proposed throughout",args:{folders:e,initial:{inbox:{mailboxId:"mb-inbox",source:"Reserved"},drafts:{mailboxId:"mb-concepten",source:"Proposed"},sent:{mailboxId:"mb-sent-messages",source:"Proposed"},archive:{mailboxId:"mb-archive",source:"Proposed"},junk:{mailboxId:"mb-spam",source:"Proposed"},trash:{mailboxId:"mb-deleted",source:"Proposed"}}}},c={name:"stale",args:{folders:e,initial:{...r,trash:{mailboxId:null,source:"Stale",staleFolderPath:"INBOX/Prullenbak"}}}},l={name:"none",args:{folders:e,initial:{...r,trash:{mailboxId:null,source:"None"},archive:{mailboxId:null,source:"None"}}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    folders: HOSTNET_FOLDERS,
    initial: SETTLED
  }
}`,...s.parameters?.docs?.source},description:{story:'The intended end state: each role points at the folder that holds the mail —\nDrafts → Concepten · 340, not the empty `INBOX/Drafts`; Sent → Sent Messages.\nThe empty look-alikes drop to "Other folders".',...s.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    folders: HOSTNET_FOLDERS,
    initial: {
      ...SETTLED,
      drafts: {
        mailboxId: "mb-drafts",
        source: "Flagged"
      },
      sent: {
        mailboxId: "mb-sent",
        source: "Flagged"
      }
    }
  }
}`,...a.parameters?.docs?.source},description:{story:"Flag-first proposal before the user corrects it: detection appointed the\n`\\Drafts`-flagged but empty `INBOX/Drafts` (0) and the empty `INBOX/Sent`.\nThe picker counts reveal the real folders so the user can re-appoint.",...a.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "appointed",
  args: {
    folders: HOSTNET_FOLDERS,
    initial: SETTLED
  }
}`,...n.parameters?.docs?.source},description:{story:"`Appointed` — a person decided, and the row says so. Every picker offers\nfolders only: a canonical role is mandatory, so a wrong choice is fixed by\nnaming another folder, never by clearing the row.",...n.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  name: "flagged",
  args: {
    folders: HOSTNET_FOLDERS,
    initial: {
      ...SETTLED,
      trash: {
        mailboxId: "mb-deleted",
        source: "Flagged"
      }
    }
  }
}`,...t.parameters?.docs?.source},description:{story:"`Flagged` — the mail server's own SPECIAL-USE flag, not a guess.",...t.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  name: "reserved",
  args: {
    folders: HOSTNET_FOLDERS,
    initial: {
      ...SETTLED,
      inbox: {
        mailboxId: "mb-inbox",
        source: "Reserved"
      }
    }
  }
}`,...i.parameters?.docs?.source},description:{story:"`Reserved` — INBOX is the one role the protocol names for us.",...i.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  name: "proposed",
  args: {
    folders: HOSTNET_FOLDERS,
    initial: {
      ...SETTLED,
      trash: {
        mailboxId: "mb-deleted",
        source: "Proposed"
      }
    }
  }
}`,...d.parameters?.docs?.source},description:{story:"`Proposed` — a name matched. Nobody confirmed it, and the row does not\npretend otherwise. `Set as Trash` commits the folder the picker already\nshows, which re-picking that same option cannot do.",...d.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  name: "proposed throughout",
  args: {
    folders: HOSTNET_FOLDERS,
    initial: {
      inbox: {
        mailboxId: "mb-inbox",
        source: "Reserved"
      },
      drafts: {
        mailboxId: "mb-concepten",
        source: "Proposed"
      },
      sent: {
        mailboxId: "mb-sent-messages",
        source: "Proposed"
      },
      archive: {
        mailboxId: "mb-archive",
        source: "Proposed"
      },
      junk: {
        mailboxId: "mb-spam",
        source: "Proposed"
      },
      trash: {
        mailboxId: "mb-deleted",
        source: "Proposed"
      }
    }
  }
}`,...m.parameters?.docs?.source},description:{story:`Density check: a server that advertises no SPECIAL-USE flags, so every role
but INBOX rests on a name match alone. Each row carries its own commit, so
the screen stays a list rather than five stacked callouts.`,...m.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  name: "stale",
  args: {
    folders: HOSTNET_FOLDERS,
    initial: {
      ...SETTLED,
      trash: {
        mailboxId: null,
        source: "Stale",
        staleFolderPath: "INBOX/Prullenbak"
      }
    }
  }
}`,...c.parameters?.docs?.source},description:{story:"`Stale` — the folder the user chose is gone from the mail server. The one row\nrepresenting a broken decision, so it is a callout with its repair rather\nthan a subtitle. Deleting mail is stopped until Trash is repaired.",...c.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  name: "none",
  args: {
    folders: HOSTNET_FOLDERS,
    initial: {
      ...SETTLED,
      trash: {
        mailboxId: null,
        source: "None"
      },
      archive: {
        mailboxId: null,
        source: "None"
      }
    }
  }
}`,...l.parameters?.docs?.source},description:{story:'`None` — a decision waiting to be made. No icon, no danger colour. Trash and\nArchive show the disabled "Choose a folder" placeholder; the settled rows\naround them have no such option left to fall back to.',...l.parameters?.docs?.description}}};const W=["Hostnet","ProposedDefaults","AppointedSource","FlaggedSource","ReservedSource","ProposedSource","ProposedThroughout","StaleSource","NoneSource"];export{n as AppointedSource,t as FlaggedSource,s as Hostnet,l as NoneSource,a as ProposedDefaults,d as ProposedSource,m as ProposedThroughout,i as ReservedSource,c as StaleSource,W as __namedExportsOrder,V as default};
