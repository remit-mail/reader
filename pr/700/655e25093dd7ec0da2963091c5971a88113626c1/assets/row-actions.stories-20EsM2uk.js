import{j as e}from"./iframe-fAVmrNjG.js";import{R as i}from"./row-actions-D_oZsm3m.js";import{T as t}from"./trash-2-Dodc-R2m.js";import{R as r}from"./rotate-ccw-BjS9qhDp.js";import{S as s}from"./send-B0c-OZLl.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";import"./button-C4vqyepI.js";import"./loader-circle-tGqNKIei.js";import"./createLucideIcon-E7hVbHyY.js";const R={title:"Primitives/RowActions",component:i,parameters:{layout:"padded"}},n={name:"Secondary + destructive confirm",args:{actions:[{label:"Manage",onClick:()=>{}}],destructive:{label:"Delete",icon:e.jsx(t,{className:"size-3.5"}),iconOnly:!0,onClick:()=>{},confirm:{prompt:"Delete this account?",confirmLabel:"Delete account"}}}},o={args:{actions:[{label:"Reconnect",variant:"secondary",onClick:()=>{}}],destructive:{label:"Delete",icon:e.jsx(t,{className:"size-3.5"}),iconOnly:!0,onClick:()=>{},confirm:{prompt:"Delete this account?",confirmLabel:"Delete account"}}}},a={args:{actions:[{label:"Reconnect",variant:"secondary",busy:!0,busyLabel:"Redirecting…",onClick:()=>{}}]}},c={name:"Outbox — failed row",args:{actions:[{label:"Retry sending",icon:e.jsx(r,{className:"size-3.5"}),iconOnly:!0,onClick:()=>{}},{label:"Edit as draft",icon:e.jsx(s,{className:"size-3.5"}),iconOnly:!0,onClick:()=>{}}],destructive:{label:"Delete message",icon:e.jsx(t,{className:"size-3.5"}),iconOnly:!0,onClick:()=>{}}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "Secondary + destructive confirm",
  args: {
    actions: [{
      label: "Manage",
      onClick: () => undefined
    }],
    destructive: {
      label: "Delete",
      icon: <Trash2 className="size-3.5" />,
      iconOnly: true,
      onClick: () => undefined,
      confirm: {
        prompt: "Delete this account?",
        confirmLabel: "Delete account"
      }
    }
  }
}`,...n.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    actions: [{
      label: "Reconnect",
      variant: "secondary",
      onClick: () => undefined
    }],
    destructive: {
      label: "Delete",
      icon: <Trash2 className="size-3.5" />,
      iconOnly: true,
      onClick: () => undefined,
      confirm: {
        prompt: "Delete this account?",
        confirmLabel: "Delete account"
      }
    }
  }
}`,...o.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    actions: [{
      label: "Reconnect",
      variant: "secondary",
      busy: true,
      busyLabel: "Redirecting…",
      onClick: () => undefined
    }]
  }
}`,...a.parameters?.docs?.source}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  name: "Outbox — failed row",
  args: {
    actions: [{
      label: "Retry sending",
      icon: <RotateCcw className="size-3.5" />,
      iconOnly: true,
      onClick: () => undefined
    }, {
      label: "Edit as draft",
      icon: <Send className="size-3.5" />,
      iconOnly: true,
      onClick: () => undefined
    }],
    destructive: {
      label: "Delete message",
      icon: <Trash2 className="size-3.5" />,
      iconOnly: true,
      onClick: () => undefined
    }
  }
}`,...c.parameters?.docs?.source}}};const C=["SecondaryWithDestructiveConfirm","Reconnect","Reconnecting","OutboxFailedRow"];export{c as OutboxFailedRow,o as Reconnect,a as Reconnecting,n as SecondaryWithDestructiveConfirm,C as __namedExportsOrder,R as default};
