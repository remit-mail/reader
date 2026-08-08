import{j as e}from"./iframe-uTafckjr.js";import{P as o}from"./popover-menu-BOGvKoIZ.js";import{M as m}from"./mail-open-DYhYkh1Y.js";import{T as i}from"./tag-DKUqhL_7.js";import{M as d}from"./mail-L6Y6Rsvz.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./button-DCXIHjmE.js";import"./createLucideIcon-DLYy-DY-.js";const S={title:"Kit/PopoverMenu",component:o,parameters:{layout:"centered"},render:l=>e.jsx("div",{className:"flex h-64 w-72 items-start justify-end p-4",children:e.jsx(o,{...l})})},s={args:{triggerLabel:"More actions",items:[{key:"read",label:"Mark as read",icon:e.jsx(m,{className:"size-4"}),onSelect:()=>{}},{key:"label",label:"Add label",icon:e.jsx(i,{className:"size-4"}),onSelect:()=>{}}]}},t={args:{triggerLabel:"More actions",items:[{key:"unread",label:"Mark as unread",icon:e.jsx(d,{className:"size-4"}),onSelect:()=>{}}]}},a={args:{triggerLabel:"More actions",items:[]}},r={args:{triggerLabel:"More actions",items:Array.from({length:24},(l,c)=>({key:`label-${c}`,label:`Label ${c+1}`,icon:e.jsx(i,{className:"size-4"}),onSelect:()=>{}}))}},n={args:{triggerLabel:"More actions",items:[{key:"read",label:"Mark read",icon:e.jsx(m,{className:"size-4"}),onSelect:()=>{}}],children:e.jsx(o,{triggerLabel:"Apply label to selected messages",triggerIcon:e.jsx(i,{className:"size-4 text-fg-subtle"}),triggerText:"Apply label",align:"start",nested:!0,touch:!1,triggerClassName:"min-h-11 w-full justify-start gap-3 px-4 py-2.5 text-sm font-normal text-fg",items:[{key:"work",label:"Work",onSelect:()=>{}},{key:"receipts",label:"Receipts",onSelect:()=>{}}]})}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    triggerLabel: "More actions",
    items: [{
      key: "read",
      label: "Mark as read",
      icon: <MailOpen className="size-4" />,
      onSelect: () => undefined
    }, {
      key: "label",
      label: "Add label",
      icon: <Tag className="size-4" />,
      onSelect: () => undefined
    }]
  }
}`,...s.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    triggerLabel: "More actions",
    items: [{
      key: "unread",
      label: "Mark as unread",
      icon: <Mail className="size-4" />,
      onSelect: () => undefined
    }]
  }
}`,...t.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    triggerLabel: "More actions",
    items: []
  }
}`,...a.parameters?.docs?.source},description:{story:`With no items the kebab is dead weight, so it renders nothing rather than a
 disabled control.`,...a.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    triggerLabel: "More actions",
    items: Array.from({
      length: 24
    }, (_, i) => ({
      key: \`label-\${i}\`,
      label: \`Label \${i + 1}\`,
      icon: <Tag className="size-4" />,
      onSelect: () => undefined
    }))
  }
}`,...r.parameters?.docs?.source},description:{story:`A nested picker at the foot of the menu, for a list that belongs to the
account rather than to the bar — the selection bar's apply-label trigger.
Its own trigger is a worded row, so it reads as one of the menu's actions
rather than a stray glyph.
A list longer than the viewport. The panel scrolls within its own bounds, so
the last row is reachable on a phone instead of running off the bottom.`,...r.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    triggerLabel: "More actions",
    items: [{
      key: "read",
      label: "Mark read",
      icon: <MailOpen className="size-4" />,
      onSelect: () => undefined
    }],
    children: <PopoverMenu triggerLabel="Apply label to selected messages" triggerIcon={<Tag className="size-4 text-fg-subtle" />} triggerText="Apply label" align="start" nested touch={false} triggerClassName="min-h-11 w-full justify-start gap-3 px-4 py-2.5 text-sm font-normal text-fg" items={[{
      key: "work",
      label: "Work",
      onSelect: () => undefined
    }, {
      key: "receipts",
      label: "Receipts",
      onSelect: () => undefined
    }]} />
  }
}`,...n.parameters?.docs?.source}}};const N=["Default","SingleItem","Empty","ManyItems","WithNestedPicker"];export{s as Default,a as Empty,r as ManyItems,t as SingleItem,n as WithNestedPicker,N as __namedExportsOrder,S as default};
