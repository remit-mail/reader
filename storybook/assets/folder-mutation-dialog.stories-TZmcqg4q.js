import{F as m}from"./folder-mutation-dialog-BwefdW78.js";import"./iframe-DS5xN_9u.js";import"./preload-helper-PPVm8Dsz.js";import"./button-D5VdN6KM.js";import"./cn-d2XQ1MEC.js";import"./dialog-DVqRaD8m.js";import"./overlay-scope-BDkw0-iB.js";import"./keymap-dispatch-DTaqnLKC.js";import"./use-modal-focus-BzRR042d.js";import"./dialog-backdrop-Nj8MqML8.js";import"./loader-circle-BUYpZ_2j.js";import"./createLucideIcon-C2HcSaX7.js";import"./triangle-alert-WlZ9QUbm.js";const w={title:"Design System/Mail/FolderMutationDialog",tags:["proposed"],component:m,parameters:{layout:"fullscreen"},args:{open:!0,folderName:"Receipts",targetName:"Q3 Receipts",onRetry:()=>{},onRefresh:()=>{},onClose:()=>{}}},e={name:"Rename — waiting",args:{intent:"rename",phase:{kind:"waiting"}}},n={name:"Rename — timed out",args:{intent:"rename",phase:{kind:"timed-out"}}},a={name:"Rename — failed",args:{intent:"rename",phase:{kind:"failed",serverMessage:"Mailbox already exists at that path."}}},t={name:"Rename — conflict",args:{intent:"rename",phase:{kind:"conflict"}}},r={name:"Delete — waiting",args:{intent:"delete",phase:{kind:"waiting"}}},s={name:"Delete — timed out",args:{intent:"delete",phase:{kind:"timed-out"}}},i={name:"Delete — failed",args:{intent:"delete",phase:{kind:"failed",serverMessage:"The mailbox has folders inside it."}}},o={name:"Delete — conflict",args:{intent:"delete",phase:{kind:"conflict"}}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  name: "Rename — waiting",
  args: {
    intent: "rename",
    phase: {
      kind: "waiting"
    }
  }
}`,...e.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "Rename — timed out",
  args: {
    intent: "rename",
    phase: {
      kind: "timed-out"
    }
  }
}`,...n.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  name: "Rename — failed",
  args: {
    intent: "rename",
    phase: {
      kind: "failed",
      serverMessage: "Mailbox already exists at that path."
    }
  }
}`,...a.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  name: "Rename — conflict",
  args: {
    intent: "rename",
    phase: {
      kind: "conflict"
    }
  }
}`,...t.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  name: "Delete — waiting",
  args: {
    intent: "delete",
    phase: {
      kind: "waiting"
    }
  }
}`,...r.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  name: "Delete — timed out",
  args: {
    intent: "delete",
    phase: {
      kind: "timed-out"
    }
  }
}`,...s.parameters?.docs?.source}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  name: "Delete — failed",
  args: {
    intent: "delete",
    phase: {
      kind: "failed",
      serverMessage: "The mailbox has folders inside it."
    }
  }
}`,...i.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  name: "Delete — conflict",
  args: {
    intent: "delete",
    phase: {
      kind: "conflict"
    }
  }
}`,...o.parameters?.docs?.source}}};const x=["RenameWaiting","RenameTimedOut","RenameFailed","RenameConflict","DeleteWaiting","DeleteTimedOut","DeleteFailed","DeleteConflict"];export{o as DeleteConflict,i as DeleteFailed,s as DeleteTimedOut,r as DeleteWaiting,t as RenameConflict,a as RenameFailed,n as RenameTimedOut,e as RenameWaiting,x as __namedExportsOrder,w as default};
