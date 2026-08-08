import{r as m,j as i}from"./iframe-uTafckjr.js";import{R as x}from"./role-appointment-list-Cbu8lHOM.js";import"./preload-helper-PPVm8Dsz.js";import"./button-DCXIHjmE.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./folder-role-BpOHddiw.js";import"./inbox-BkJxHO7O.js";import"./createLucideIcon-DLYy-DY-.js";import"./mails-Da7sTTz2.js";import"./send-BQNBpU1Y.js";import"./octagon-alert-CMw1lVMf.js";import"./trash-2-CHrpvC8V.js";import"./star-Dxpw9m1E.js";import"./input-KNBszVtY.js";import"./select-DyrE6Z7X.js";import"./chevron-down-BKKk_GEi.js";import"./folder-B8XGFRcf.js";import"./check-CM0cWxPP.js";const p=[{mailboxId:"mb-inbox",providerPath:"INBOX",messageCount:4821},{mailboxId:"mb-archive",providerPath:"INBOX/Archive",messageCount:19243},{mailboxId:"mb-concepten",providerPath:"INBOX/Concepten",messageCount:340},{mailboxId:"mb-deleted",providerPath:"INBOX/Deleted Messages",messageCount:512},{mailboxId:"mb-drafts",providerPath:"INBOX/Drafts",messageCount:0},{mailboxId:"mb-news",providerPath:"INBOX/Nieuwsbrieven",messageCount:2870},{mailboxId:"mb-sent",providerPath:"INBOX/Sent",messageCount:0},{mailboxId:"mb-sent-messages",providerPath:"INBOX/Sent Messages",messageCount:6105},{mailboxId:"mb-spam",providerPath:"INBOX/Spam",messageCount:88}];function v({folders:d,initial:c}){const[b,l]=m.useState(c),[h,u]=m.useState({}),f=(r,e)=>{l(o=>{const n={...o,[r]:e};if(e)for(const a of Object.keys(n))a!==r&&n[a]===e&&(n[a]=null);return n})},g=(r,e)=>u(o=>({...o,[r]:e.trim()}));return i.jsx("div",{className:"max-w-3xl p-8",children:i.jsx(x,{accountEmail:"440737+mvhenten@users.noreply.github.com",folders:d,appointments:b,displayNames:h,onAppoint:f,onRename:g})})}const F={title:"Settings/RoleAppointmentList",component:v},t={args:{folders:p,initial:{inbox:"mb-inbox",drafts:"mb-concepten",sent:"mb-sent-messages",archive:"mb-archive",junk:"mb-spam",trash:"mb-deleted"}}},s={args:{folders:p,initial:{inbox:"mb-inbox",drafts:"mb-drafts",sent:"mb-sent",archive:"mb-archive",junk:"mb-spam",trash:"mb-deleted"}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    folders: HOSTNET_FOLDERS,
    initial: {
      inbox: "mb-inbox",
      drafts: "mb-concepten",
      sent: "mb-sent-messages",
      archive: "mb-archive",
      junk: "mb-spam",
      trash: "mb-deleted"
    }
  }
}`,...t.parameters?.docs?.source},description:{story:'The intended end state: each role points at the folder that holds the mail —\nDrafts → Concepten · 340, not the empty `INBOX/Drafts`; Sent → Sent Messages.\nThe empty look-alikes drop to "Other folders".',...t.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    folders: HOSTNET_FOLDERS,
    initial: {
      inbox: "mb-inbox",
      drafts: "mb-drafts",
      sent: "mb-sent",
      archive: "mb-archive",
      junk: "mb-spam",
      trash: "mb-deleted"
    }
  }
}`,...s.parameters?.docs?.source},description:{story:"Flag-first proposal before the user corrects it: detection appointed the\n`\\Drafts`-flagged but empty `INBOX/Drafts` (0) and the empty `INBOX/Sent`.\nThe picker counts reveal the real folders so the user can re-appoint.",...s.parameters?.docs?.description}}};const w=["Hostnet","ProposedDefaults"];export{t as Hostnet,s as ProposedDefaults,w as __namedExportsOrder,F as default};
