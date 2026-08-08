import{C as t}from"./compose-action-bar-Cp1VPIFE.js";import"./iframe-fAVmrNjG.js";import"./preload-helper-PPVm8Dsz.js";import"./button-C4vqyepI.js";import"./cn-yMAG7bfM.js";import"./loader-circle-tGqNKIei.js";import"./createLucideIcon-E7hVbHyY.js";import"./send-B0c-OZLl.js";import"./trash-2-Dodc-R2m.js";const v={title:"Mail/ComposeActionBar",component:t,parameters:{layout:"padded"},args:{onSend:()=>{},onDiscard:()=>{},sending:!1,canSend:!0,saveStatus:"idle"}},e={},a={args:{saveStatus:"saving"}},s={args:{saveStatus:"saved"}},r={args:{saveStatus:"error"}},n={name:"Sending — also while the pending draft is written",args:{sending:!0}},o={name:"Cannot send — stays pressable",args:{canSend:!1,unavailableReason:"SMTP not configured",onUnavailable:()=>{}}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:"{}",...e.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    saveStatus: "saving"
  }
}`,...a.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    saveStatus: "saved"
  }
}`,...s.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    saveStatus: "error"
  }
}`,...r.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
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
}`,...o.parameters?.docs?.source}}};const f=["Ready","Saving","Saved","SaveFailed","Sending","CannotSend"];export{o as CannotSend,e as Ready,r as SaveFailed,s as Saved,a as Saving,n as Sending,f as __namedExportsOrder,v as default};
