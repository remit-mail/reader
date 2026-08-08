import{C as o}from"./ConfirmDialog-CsMqqNSl.js";import"./iframe-uTafckjr.js";import"./preload-helper-PPVm8Dsz.js";import"./utils-BLNPqUX_.js";import"./bundle-mjs-DeRmtv56.js";const m={title:"Screens/WebClient/ConfirmDialog",component:o,parameters:{layout:"centered"},args:{isOpen:!0,title:"Move 3,412 messages to Trash?",description:"You can restore them from Trash later.",confirmLabel:"Move to Trash",destructive:!0,onConfirm:()=>{},onCancel:()=>{}}},e={},t={args:{title:"Move 1 message to Trash?"}},r={args:{isBusy:!0}},s={args:{title:"Archive 12 messages?",description:void 0,confirmLabel:"Archive",destructive:!1}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:"{}",...e.parameters?.docs?.source},description:{story:`A single corner tap on the bar's delete icon used to fall straight through
to a delete with nothing in between — this is what now sits in the way.
Wording says "Move … to Trash", not "Delete": the operation is reversible
(IMAP delete moves to Trash), and the confirmation copy says so rather than
reading as final.`,...e.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    title: "Move 1 message to Trash?"
  }
}`,...t.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    isBusy: true
  }
}`,...r.parameters?.docs?.source},description:{story:`The mutation is in flight: the confirm button disables rather than
 allowing a second concurrent delete request.`,...r.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    title: "Archive 12 messages?",
    description: undefined,
    confirmLabel: "Archive",
    destructive: false
  }
}`,...s.parameters?.docs?.source},description:{story:"A non-destructive confirmation (no `destructive`) uses the accent\n affirmative styling instead of danger.",...s.parameters?.docs?.description}}};const p=["Default","OneMessage","Busy","NonDestructive"];export{r as Busy,e as Default,s as NonDestructive,t as OneMessage,p as __namedExportsOrder,m as default};
