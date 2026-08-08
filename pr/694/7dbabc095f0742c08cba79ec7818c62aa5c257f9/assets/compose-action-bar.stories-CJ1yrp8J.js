import{C as t}from"./compose-action-bar-CD0-MxZy.js";import"./iframe-uTafckjr.js";import"./preload-helper-PPVm8Dsz.js";import"./button-DCXIHjmE.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./loader-circle-BjZYR62R.js";import"./createLucideIcon-DLYy-DY-.js";import"./send-BQNBpU1Y.js";import"./trash-2-CHrpvC8V.js";const f={title:"Mail/ComposeActionBar",component:t,parameters:{layout:"padded"},args:{onSend:()=>{},onDiscard:()=>{},sending:!1,canSend:!0,saveStatus:"idle"}},e={},a={args:{saveStatus:"saving"}},r={args:{saveStatus:"saved"}},s={args:{saveStatus:"error"}},n={name:"Sending — also while the pending draft is written",args:{sending:!0}},o={name:"Cannot send — stays pressable",args:{canSend:!1,unavailableReason:"SMTP not configured",onUnavailable:()=>{}}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:"{}",...e.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    saveStatus: "saving"
  }
}`,...a.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    saveStatus: "saved"
  }
}`,...r.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    saveStatus: "error"
  }
}`,...s.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "Sending — also while the pending draft is written",
  args: {
    sending: true
  }
}`,...n.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  name: "Cannot send — stays pressable",
  args: {
    canSend: false,
    unavailableReason: "SMTP not configured",
    onUnavailable: () => undefined
  }
}`,...o.parameters?.docs?.source}}};const C=["Ready","Saving","Saved","SaveFailed","Sending","CannotSend"];export{o as CannotSend,e as Ready,s as SaveFailed,r as Saved,a as Saving,n as Sending,C as __namedExportsOrder,f as default};
