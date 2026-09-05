import{j as e,r as u}from"./iframe-uufGNBEn.js";import{c,b}from"./popover-menu-B7ne2TDp.js";import{M as g}from"./mail-open-MzOq669C.js";import{T as m}from"./tag-S8AT5Pzu.js";import{M as f}from"./mail-DXm5QBOT.js";import"./preload-helper-PPVm8Dsz.js";import"./index-kPMH9ZlQ.js";import"./index-8Sr_-kjb.js";import"./cn-d2XQ1MEC.js";import"./overlay-scope-DDGgBdDi.js";import"./keymap-dispatch-DTaqnLKC.js";import"./button-Wi0n0Lyz.js";import"./createLucideIcon-Bn-Stmx4.js";const P={title:"Kit/PopoverMenu",component:c,parameters:{layout:"centered"},render:r=>e.jsx("div",{className:"flex h-64 w-72 items-start justify-end p-4",children:e.jsx(c,{...r})})},o={args:{triggerLabel:"More actions",items:[{key:"read",label:"Mark as read",icon:e.jsx(g,{className:"size-4"}),onSelect:()=>{}},{key:"label",label:"Add label",icon:e.jsx(m,{className:"size-4"}),onSelect:()=>{}}]}},i={args:{triggerLabel:"More actions",items:[{key:"unread",label:"Mark as unread",icon:e.jsx(f,{className:"size-4"}),onSelect:()=>{}}]}},a={args:{triggerLabel:"More actions",items:[]}},s={args:{triggerLabel:"More actions",items:Array.from({length:24},(r,t)=>({key:`label-${t}`,label:`Label ${t+1}`,icon:e.jsx(m,{className:"size-4"}),onSelect:()=>{}}))}};function h(){const[r,t]=u.useState(2);return e.jsx("div",{className:"flex h-screen items-end justify-end p-4",children:e.jsx(c,{triggerLabel:"More actions",items:Array.from({length:r},(d,p)=>({key:`label-${p}`,label:`Label ${p+1}`,icon:e.jsx(m,{className:"size-4"}),onSelect:()=>{}})),children:e.jsx(b,{label:"Show more",onSelect:()=>t(d=>d+10)})})})}const n={name:"Panel grows after it opens",parameters:{layout:"fullscreen"},render:()=>e.jsx(h,{}),play:async({canvasElement:r})=>{r.querySelector('[aria-label="More actions"]')?.click(),await new Promise(t=>setTimeout(t,60)),Array.from(document.body.querySelectorAll("button")).find(t=>t.textContent?.trim()==="Show more")?.click()}},l={args:{triggerLabel:"More actions",items:[{key:"read",label:"Mark read",icon:e.jsx(g,{className:"size-4"}),onSelect:()=>{}}],children:e.jsx(c,{triggerLabel:"Apply label to selected messages",triggerIcon:e.jsx(m,{className:"size-4 text-fg-subtle"}),triggerText:"Apply label",align:"start",nested:!0,touch:!1,triggerClassName:"min-h-11 w-full justify-start gap-3 px-4 py-2.5 text-sm font-normal text-fg",items:[{key:"work",label:"Work",onSelect:()=>{}},{key:"receipts",label:"Receipts",onSelect:()=>{}}]})}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
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
}`,...o.parameters?.docs?.source}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    triggerLabel: "More actions",
    items: [{
      key: "unread",
      label: "Mark as unread",
      icon: <Mail className="size-4" />,
      onSelect: () => undefined
    }]
  }
}`,...i.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    triggerLabel: "More actions",
    items: []
  }
}`,...a.parameters?.docs?.source},description:{story:`With no items the kebab is dead weight, so it renders nothing rather than a
 disabled control.`,...a.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
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
}`,...s.parameters?.docs?.source},description:{story:`A nested picker at the foot of the menu, for a list that belongs to the
account rather than to the bar — the selection bar's apply-label trigger.
Its own trigger is a worded row, so it reads as one of the menu's actions
rather than a stray glyph.
A list longer than the viewport. The panel scrolls within its own bounds, so
the last row is reachable on a phone instead of running off the bottom.`,...s.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "Panel grows after it opens",
  parameters: {
    layout: "fullscreen"
  },
  render: () => <GrowingMenu />,
  play: async ({
    canvasElement
  }) => {
    canvasElement.querySelector<HTMLButtonElement>('[aria-label="More actions"]')?.click();
    await new Promise(resolve => setTimeout(resolve, 60));
    // The panel is portalled onto the body, so it is outside the canvas.
    Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.trim() === "Show more")?.click();
  }
}`,...n.parameters?.docs?.source},description:{story:`A panel that grows after it has been placed — a list arriving from a fetch,
a confirmation bar appearing on a pick. It stays anchored to its trigger as
it grows, rather than keeping the position it was given at its opening size
and running off the bottom of the screen.`,...n.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
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
}`,...l.parameters?.docs?.source}}};const E=["Default","SingleItem","Empty","ManyItems","GrowsAfterOpening","WithNestedPicker"];export{o as Default,a as Empty,n as GrowsAfterOpening,s as ManyItems,i as SingleItem,l as WithNestedPicker,E as __namedExportsOrder,P as default};
