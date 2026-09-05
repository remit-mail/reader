import{r as m,j as S}from"./iframe-uufGNBEn.js";import{R as I}from"./role-appointment-prompt-BD8lrFID.js";import"./preload-helper-PPVm8Dsz.js";import"./banner-D7bQEtJc.js";import"./cn-d2XQ1MEC.js";import"./button-Wi0n0Lyz.js";import"./x-CuwWA0oJ.js";import"./createLucideIcon-Bn-Stmx4.js";import"./dialog-DIXzXjmg.js";import"./overlay-scope-DDGgBdDi.js";import"./keymap-dispatch-DTaqnLKC.js";import"./use-initial-focus-BI_G8RKS.js";import"./dialog-backdrop-Cp-aOj13.js";import"./folder-tree-picker-DOwT19mg.js";import"./folder-tree-ZE9Jqoy_.js";import"./folder-row-DSUXG5tk.js";import"./chevron-right-B0dowht5.js";import"./check-BSgP79ub.js";import"./folder-C4FA7sra.js";import"./input-Cs8KaoXd.js";import"./new-folder-action-7vwcC7A5.js";import"./new-folder-form-5lRSXSZZ.js";import"./field-label-Bp6oPTgY.js";import"./search-DT0jdmVi.js";import"./loader-circle-qkSTSuP1.js";import"./triangle-alert-BMnL-Txz.js";const w=[{id:"mb-inbox",label:"INBOX",path:"INBOX",messageCount:4821},{id:"mb-archive",label:"Archive",path:"Archive",messageCount:19243},{id:"mb-deleted",label:"Deleted Messages",path:"Deleted Messages",messageCount:512},{id:"mb-prullenbak",label:"Prullenbak",path:"Prullenbak",messageCount:0},{id:"mb-spam",label:"Spam",path:"Spam",messageCount:88}];function x({initialSelectedId:u,phaseCycle:e,...p}){const[h,g]=m.useState(u),[b,f]=m.useState(0);return m.useEffect(()=>{if(!e||e.length<2)return;const k=setInterval(()=>f(y=>(y+1)%e.length),2200);return()=>clearInterval(k)},[e]),S.jsx(I,{...p,open:!0,folders:w,delimiter:"/",phase:e?.[b]??p.phase,selectedId:h,onSelect:g,onConfirm:()=>{},onCancel:()=>{}})}const W={title:"Mail/RoleAppointmentPrompt",component:x},l={kind:"choosing"},n={name:"none",args:{reason:"none",action:{kind:"delete",count:12},phase:l,accountEmail:"440737+mvhenten@users.noreply.github.com"}},t={name:"stale",args:{reason:"stale",action:{kind:"delete",count:12},staleFolderLabel:"Prullenbak",phase:l}},a={name:"unconfirmed",args:{reason:"unconfirmed",action:{kind:"emptyTrash"},trashFolderLabel:"Deleted Messages",initialSelectedId:"mb-deleted",phase:l}},r={name:"unconfirmed — delete in place",args:{reason:"unconfirmed",action:{kind:"delete",count:3},trashFolderLabel:"Deleted Messages",guessedMailboxId:"mb-deleted",initialSelectedId:"mb-deleted",phase:l}},s={name:"unconfirmed — delete into another folder",args:{reason:"unconfirmed",action:{kind:"delete",count:3},trashFolderLabel:"Deleted Messages",guessedMailboxId:"mb-deleted",initialSelectedId:"mb-prullenbak",phase:l}},o={name:"unconfirmed — delete in place, acting",args:{reason:"unconfirmed",action:{kind:"delete",count:3},trashFolderLabel:"Deleted Messages",guessedMailboxId:"mb-deleted",initialSelectedId:"mb-deleted",phase:{kind:"acting"}}},i={name:"pending",args:{reason:"none",action:{kind:"delete",count:12},initialSelectedId:"mb-prullenbak",phase:{kind:"appointing"},phaseCycle:[{kind:"appointing"},{kind:"acting"}]}},d={name:"appoint-failed",args:{reason:"none",action:{kind:"delete",count:12},initialSelectedId:"mb-prullenbak",phase:{kind:"appoint-failed",cause:"generic"}}},c={name:"appoint-refused-pending-mailbox",args:{reason:"none",action:{kind:"delete",count:12},initialSelectedId:"mb-prullenbak",phase:{kind:"appoint-failed",cause:"mailbox-pending"}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "none",
  args: {
    reason: "none",
    action: {
      kind: "delete",
      count: 12
    },
    phase: choosing,
    accountEmail: "440737+mvhenten@users.noreply.github.com"
  }
}`,...n.parameters?.docs?.source},description:{story:"A delete refused because the account has no Trash at all. A first choice.",...n.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  name: "stale",
  args: {
    reason: "stale",
    action: {
      kind: "delete",
      count: 12
    },
    staleFolderLabel: "Prullenbak",
    phase: choosing
  }
}`,...t.parameters?.docs?.source},description:{story:`A delete refused because the folder the user chose is gone. The description
names it, so a rename (pick the renamed one) is told from a deletion.`,...t.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  name: "unconfirmed",
  args: {
    reason: "unconfirmed",
    action: {
      kind: "emptyTrash"
    },
    trashFolderLabel: "Deleted Messages",
    initialSelectedId: "mb-deleted",
    phase: choosing
  }
}`,...a.parameters?.docs?.source},description:{story:`Empty Trash on a folder reader only matched by name. The guess starts
selected, so the common case is one tap, and the confirm is the danger
variant — this is the only framing whose confirm expunges.`,...a.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  name: "unconfirmed — delete in place",
  args: {
    reason: "unconfirmed",
    action: {
      kind: "delete",
      count: 3
    },
    trashFolderLabel: "Deleted Messages",
    guessedMailboxId: "mb-deleted",
    initialSelectedId: "mb-deleted",
    phase: choosing
  }
}`,...r.parameters?.docs?.source},description:{story:`A delete refused because the rows are already inside the folder reader only
matched by name: confirming it expunges them where they sit, so the copy says
"delete", never "empty", and the confirm is the danger variant.`,...r.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  name: "unconfirmed — delete into another folder",
  args: {
    reason: "unconfirmed",
    action: {
      kind: "delete",
      count: 3
    },
    trashFolderLabel: "Deleted Messages",
    guessedMailboxId: "mb-deleted",
    initialSelectedId: "mb-prullenbak",
    phase: choosing
  }
}`,...s.parameters?.docs?.source},description:{story:`The same refusal answered with a different folder. The rows are not in that
one, so the delete moves them there and the confirm is not destructive.`,...s.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  name: "unconfirmed — delete in place, acting",
  args: {
    reason: "unconfirmed",
    action: {
      kind: "delete",
      count: 3
    },
    trashFolderLabel: "Deleted Messages",
    guessedMailboxId: "mb-deleted",
    initialSelectedId: "mb-deleted",
    phase: {
      kind: "acting"
    }
  }
}`,...o.parameters?.docs?.source},description:{story:`That confirm in flight. It says the rows are being erased where they sit —
"moving them to Deleted Messages" would narrate the opposite.`,...o.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  name: "pending",
  args: {
    reason: "none",
    action: {
      kind: "delete",
      count: 12
    },
    initialSelectedId: "mb-prullenbak",
    phase: {
      kind: "appointing"
    },
    phaseCycle: [{
      kind: "appointing"
    }, {
      kind: "acting"
    }]
  }
}`,...i.parameters?.docs?.source},description:{story:`Two writes behind one press, and the story steps through both: the
appointment, then the delete it unblocks. Neither has a way out — the write
has left, and cancelling a half-applied ceremony is worse than waiting.`,...i.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  name: "appoint-failed",
  args: {
    reason: "none",
    action: {
      kind: "delete",
      count: 12
    },
    initialSelectedId: "mb-prullenbak",
    phase: {
      kind: "appoint-failed",
      cause: "generic"
    }
  }
}`,...d.parameters?.docs?.source},description:{story:"The write failed. The picker stays, the selection stays, the confirm stays pressable.",...d.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  name: "appoint-refused-pending-mailbox",
  args: {
    reason: "none",
    action: {
      kind: "delete",
      count: 12
    },
    initialSelectedId: "mb-prullenbak",
    phase: {
      kind: "appoint-failed",
      cause: "mailbox-pending"
    }
  }
}`,...c.parameters?.docs?.source},description:{story:`The folder was made in the picker and the mail server has not confirmed it
yet. A different sentence with a different remedy from a network failure —
waiting fixes this one, retrying does not.`,...c.parameters?.docs?.description}}};const Y=["None","Stale","Unconfirmed","UnconfirmedDelete","UnconfirmedDeleteElsewhere","UnconfirmedDeleteInFlight","Pending","AppointFailed","AppointRefusedPendingMailbox"];export{d as AppointFailed,c as AppointRefusedPendingMailbox,n as None,i as Pending,t as Stale,a as Unconfirmed,r as UnconfirmedDelete,s as UnconfirmedDeleteElsewhere,o as UnconfirmedDeleteInFlight,Y as __namedExportsOrder,W as default};
