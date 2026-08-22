import{r as i,j as f}from"./iframe-BxLfZl0d.js";import{R as k}from"./role-appointment-prompt-D2zD7uW3.js";import"./preload-helper-PPVm8Dsz.js";import"./banner-DLDN0WMz.js";import"./cn-d2XQ1MEC.js";import"./button-y3nctzTP.js";import"./x-BYZsfpI2.js";import"./createLucideIcon-DDkWk8mg.js";import"./dialog-eylec2KB.js";import"./dialog-backdrop-Bi3FaUL6.js";import"./folder-tree-picker-BBwmFFvh.js";import"./folder-tree-DmcSGgXr.js";import"./folder-row-B7bqIcao.js";import"./chevron-right-C4q9meQG.js";import"./check-DP9bkLrx.js";import"./folder-BIbRcK0i.js";import"./input-2W6pRlc_.js";import"./new-folder-action-CYLRlXtB.js";import"./new-folder-form-CF2Ldd7M.js";import"./field-label-7InU1Onk.js";import"./search-B2ZXIDXt.js";import"./loader-circle-tcZ5ujJC.js";import"./triangle-alert-C1LDOpRR.js";const S=[{id:"mb-inbox",label:"INBOX",path:"INBOX",messageCount:4821},{id:"mb-archive",label:"Archive",path:"Archive",messageCount:19243},{id:"mb-deleted",label:"Deleted Messages",path:"Deleted Messages",messageCount:512},{id:"mb-prullenbak",label:"Prullenbak",path:"Prullenbak",messageCount:0},{id:"mb-spam",label:"Spam",path:"Spam",messageCount:88}];function y({initialSelectedId:c,phaseCycle:e,...p}){const[l,m]=i.useState(c),[u,h]=i.useState(0);return i.useEffect(()=>{if(!e||e.length<2)return;const g=setInterval(()=>h(b=>(b+1)%e.length),2200);return()=>clearInterval(g)},[e]),f.jsx(k,{...p,open:!0,folders:S,delimiter:"/",phase:e?.[u]??p.phase,selectedId:l,onSelect:m,onConfirm:()=>{},onCancel:()=>{}})}const z={title:"Mail/RoleAppointmentPrompt",component:y},d={kind:"choosing"},n={name:"none",args:{reason:"none",action:{kind:"delete",count:12},phase:d,accountEmail:"440737+mvhenten@users.noreply.github.com"}},t={name:"stale",args:{reason:"stale",action:{kind:"delete",count:12},staleFolderLabel:"Prullenbak",phase:d}},a={name:"unconfirmed",args:{reason:"unconfirmed",action:{kind:"emptyTrash"},trashFolderLabel:"Deleted Messages",initialSelectedId:"mb-deleted",phase:d}},o={name:"pending",args:{reason:"none",action:{kind:"delete",count:12},initialSelectedId:"mb-prullenbak",phase:{kind:"appointing"},phaseCycle:[{kind:"appointing"},{kind:"acting"}]}},s={name:"appoint-failed",args:{reason:"none",action:{kind:"delete",count:12},initialSelectedId:"mb-prullenbak",phase:{kind:"appoint-failed",cause:"generic"}}},r={name:"appoint-refused-pending-mailbox",args:{reason:"none",action:{kind:"delete",count:12},initialSelectedId:"mb-prullenbak",phase:{kind:"appoint-failed",cause:"mailbox-pending"}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
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
variant — this is the only framing whose confirm expunges.`,...a.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
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
}`,...o.parameters?.docs?.source},description:{story:`Two writes behind one press, and the story steps through both: the
appointment, then the delete it unblocks. Neither has a way out — the write
has left, and cancelling a half-applied ceremony is worse than waiting.`,...o.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
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
}`,...s.parameters?.docs?.source},description:{story:"The write failed. The picker stays, the selection stays, the confirm stays pressable.",...s.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
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
}`,...r.parameters?.docs?.source},description:{story:`The folder was made in the picker and the mail server has not confirmed it
yet. A different sentence with a different remedy from a network failure —
waiting fixes this one, retrying does not.`,...r.parameters?.docs?.description}}};const G=["None","Stale","Unconfirmed","Pending","AppointFailed","AppointRefusedPendingMailbox"];export{s as AppointFailed,r as AppointRefusedPendingMailbox,n as None,o as Pending,t as Stale,a as Unconfirmed,G as __namedExportsOrder,z as default};
