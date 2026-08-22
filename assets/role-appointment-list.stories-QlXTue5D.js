import{r as S,j as f}from"./iframe-BxLfZl0d.js";import{R as v}from"./role-appointment-list-BD5CCVOc.js";import"./preload-helper-PPVm8Dsz.js";import"./folder-tree-DmcSGgXr.js";import"./banner-DLDN0WMz.js";import"./cn-d2XQ1MEC.js";import"./button-y3nctzTP.js";import"./x-BYZsfpI2.js";import"./createLucideIcon-DDkWk8mg.js";import"./folder-role-dmq7aBm0.js";import"./inbox-DwY9RJbq.js";import"./mails-Dvt-mx6n.js";import"./send-DMtwrNan.js";import"./octagon-alert-CBmLBGXA.js";import"./trash-2-DGdeO5MV.js";import"./star-BnMPyPKH.js";import"./input-2W6pRlc_.js";import"./select-CYvsvKoV.js";import"./chevron-down-DBsC1ZFK.js";import"./folder-BIbRcK0i.js";import"./check-DP9bkLrx.js";const e=[{mailboxId:"mb-inbox",providerPath:"INBOX",hierarchyDelimiter:"/",messageCount:4821},{mailboxId:"mb-archive",providerPath:"INBOX/Archive",hierarchyDelimiter:"/",messageCount:19243},{mailboxId:"mb-concepten",providerPath:"INBOX/Concepten",hierarchyDelimiter:"/",messageCount:340},{mailboxId:"mb-deleted",providerPath:"INBOX/Deleted Messages",hierarchyDelimiter:"/",messageCount:512},{mailboxId:"mb-drafts",providerPath:"INBOX/Drafts",hierarchyDelimiter:"/",messageCount:0},{mailboxId:"mb-news",providerPath:"INBOX/Nieuwsbrieven",hierarchyDelimiter:"/",messageCount:2870},{mailboxId:"mb-sent",providerPath:"INBOX/Sent",hierarchyDelimiter:"/",messageCount:0},{mailboxId:"mb-sent-messages",providerPath:"INBOX/Sent Messages",hierarchyDelimiter:"/",messageCount:6105},{mailboxId:"mb-spam",providerPath:"INBOX/Spam",hierarchyDelimiter:"/",messageCount:88}],s=h=>({mailboxId:h,source:"Appointed"}),r={inbox:{mailboxId:"mb-inbox",source:"Reserved"},drafts:s("mb-concepten"),sent:s("mb-sent-messages"),archive:s("mb-archive"),junk:s("mb-spam"),trash:s("mb-deleted")};function y({folders:h,initial:x}){const[E,I]=S.useState(x),[T,N]=S.useState({}),D=(p,o)=>{I(g=>{const u={...g,[p]:o?{mailboxId:o,source:"Appointed"}:{mailboxId:null,source:"None"}};if(o)for(const b of Object.keys(u))b!==p&&u[b]?.mailboxId===o&&(u[b]={mailboxId:null,source:"None"});return u})},O=(p,o)=>N(g=>({...g,[p]:o.trim()}));return f.jsx("div",{className:"max-w-3xl p-8",children:f.jsx(v,{accountEmail:"440737+mvhenten@users.noreply.github.com",folders:h,appointments:E,displayNames:T,onAppoint:D,onRename:O})})}const V={title:"Settings/RoleAppointmentList",component:y},t={args:{folders:e,initial:r}},a={args:{folders:e,initial:{...r,drafts:{mailboxId:"mb-drafts",source:"Flagged"},sent:{mailboxId:"mb-sent",source:"Flagged"}}}},n={name:"appointed",args:{folders:e,initial:r}},i={name:"flagged",args:{folders:e,initial:{...r,trash:{mailboxId:"mb-deleted",source:"Flagged"}}}},d={name:"reserved",args:{folders:e,initial:{...r,inbox:{mailboxId:"mb-inbox",source:"Reserved"}}}},m={name:"proposed",args:{folders:e,initial:{...r,trash:{mailboxId:"mb-deleted",source:"Proposed"}}}},c={name:"stale",args:{folders:e,initial:{...r,trash:{mailboxId:null,source:"Stale",staleFolderPath:"INBOX/Prullenbak"}}}},l={name:"none",args:{folders:e,initial:{...r,trash:{mailboxId:null,source:"None"},archive:{mailboxId:null,source:"None"}}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    folders: HOSTNET_FOLDERS,
    initial: SETTLED
  }
}`,...t.parameters?.docs?.source},description:{story:'The intended end state: each role points at the folder that holds the mail —\nDrafts → Concepten · 340, not the empty `INBOX/Drafts`; Sent → Sent Messages.\nThe empty look-alikes drop to "Other folders".',...t.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
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
}`,...n.parameters?.docs?.source},description:{story:"`Appointed` — a person decided, and the row says so.",...n.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
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
}`,...i.parameters?.docs?.source},description:{story:"`Flagged` — the mail server's own SPECIAL-USE flag, not a guess.",...i.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
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
}`,...d.parameters?.docs?.source},description:{story:"`Reserved` — INBOX is the one role the protocol names for us.",...d.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
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
}`,...m.parameters?.docs?.source},description:{story:"`Proposed` — a name matched. Nobody confirmed it, and the row does not pretend otherwise.",...m.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
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
}`,...l.parameters?.docs?.source},description:{story:"`None` — a decision waiting to be made. No icon, no danger colour.",...l.parameters?.docs?.description}}};const W=["Hostnet","ProposedDefaults","AppointedSource","FlaggedSource","ReservedSource","ProposedSource","StaleSource","NoneSource"];export{n as AppointedSource,i as FlaggedSource,t as Hostnet,l as NoneSource,a as ProposedDefaults,m as ProposedSource,d as ReservedSource,c as StaleSource,W as __namedExportsOrder,V as default};
