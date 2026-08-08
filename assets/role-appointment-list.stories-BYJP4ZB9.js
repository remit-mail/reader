import{r as m,j as i}from"./iframe-zw88L4Mq.js";import{R as x}from"./role-appointment-list-CwX1tHJF.js";import"./preload-helper-PPVm8Dsz.js";import"./button-B3Yk1mOK.js";import"./cn-yMAG7bfM.js";import"./folder-role-CkcK2HB8.js";import"./inbox-xh3kJz_j.js";import"./createLucideIcon-AdIgPHc_.js";import"./mails-FLpZPIdm.js";import"./send-BN5Q90Ut.js";import"./octagon-alert-Bt3CD9jY.js";import"./trash-2-Du3oCQXI.js";import"./star-Dn8uDbft.js";import"./input-Cji_nj0c.js";import"./select-B6Imrwed.js";import"./chevron-down-D70ORMFZ.js";import"./folder-DVZhL6g4.js";import"./check-DQN2CS7b.js";const p=[{mailboxId:"mb-inbox",providerPath:"INBOX",messageCount:4821},{mailboxId:"mb-archive",providerPath:"INBOX/Archive",messageCount:19243},{mailboxId:"mb-concepten",providerPath:"INBOX/Concepten",messageCount:340},{mailboxId:"mb-deleted",providerPath:"INBOX/Deleted Messages",messageCount:512},{mailboxId:"mb-drafts",providerPath:"INBOX/Drafts",messageCount:0},{mailboxId:"mb-news",providerPath:"INBOX/Nieuwsbrieven",messageCount:2870},{mailboxId:"mb-sent",providerPath:"INBOX/Sent",messageCount:0},{mailboxId:"mb-sent-messages",providerPath:"INBOX/Sent Messages",messageCount:6105},{mailboxId:"mb-spam",providerPath:"INBOX/Spam",messageCount:88}];function v({folders:d,initial:c}){const[b,l]=m.useState(c),[h,u]=m.useState({}),f=(n,e)=>{l(o=>{const r={...o,[n]:e};if(e)for(const a of Object.keys(r))a!==n&&r[a]===e&&(r[a]=null);return r})},g=(n,e)=>u(o=>({...o,[n]:e.trim()}));return i.jsx("div",{className:"max-w-3xl p-8",children:i.jsx(x,{accountEmail:"440737+mvhenten@users.noreply.github.com",folders:d,appointments:b,displayNames:h,onAppoint:f,onRename:g})})}const _={title:"Settings/RoleAppointmentList",component:v},t={args:{folders:p,initial:{inbox:"mb-inbox",drafts:"mb-concepten",sent:"mb-sent-messages",archive:"mb-archive",junk:"mb-spam",trash:"mb-deleted"}}},s={args:{folders:p,initial:{inbox:"mb-inbox",drafts:"mb-drafts",sent:"mb-sent",archive:"mb-archive",junk:"mb-spam",trash:"mb-deleted"}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
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
}`,...s.parameters?.docs?.source},description:{story:"Flag-first proposal before the user corrects it: detection appointed the\n`\\Drafts`-flagged but empty `INBOX/Drafts` (0) and the empty `INBOX/Sent`.\nThe picker counts reveal the real folders so the user can re-appoint.",...s.parameters?.docs?.description}}};const F=["Hostnet","ProposedDefaults"];export{t as Hostnet,s as ProposedDefaults,F as __namedExportsOrder,_ as default};
