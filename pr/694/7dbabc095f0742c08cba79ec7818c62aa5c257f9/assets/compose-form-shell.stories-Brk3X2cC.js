import{j as e}from"./iframe-uTafckjr.js";import{C as m}from"./compose-action-bar-CD0-MxZy.js";import{C as n,c as a}from"./compose-form-shell-DqHWrb5B.js";import"./preload-helper-PPVm8Dsz.js";import"./button-DCXIHjmE.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./loader-circle-BjZYR62R.js";import"./createLucideIcon-DLYy-DY-.js";import"./send-BQNBpU1Y.js";import"./trash-2-CHrpvC8V.js";const N={title:"Mail/ComposeForm",component:n,parameters:{layout:"fullscreen"}},l=({title:i})=>e.jsxs("div",{className:"space-y-1 border-b border-line px-3 py-2",children:[e.jsx("div",{className:"text-xs font-semibold text-fg-muted",children:i}),e.jsxs("div",{className:"flex items-center gap-2 text-sm",children:[e.jsx("span",{className:"w-12 text-fg-muted",children:"To"}),e.jsx("span",{children:"alex@example.com"})]}),e.jsxs("div",{className:"flex items-center gap-2 text-sm",children:[e.jsx("span",{className:"w-12 text-fg-muted",children:"Subject"}),e.jsx("span",{children:"Q3 planning notes"})]})]}),d=()=>e.jsx("div",{className:"min-h-[120px] px-3 py-2 text-sm",children:"Hi Alex, here are the notes from today…"}),t=e.jsx(m,{onSend:()=>{},onDiscard:()=>{},sending:!1,canSend:!0,saveStatus:"saved"}),r={name:"Desktop — full compose",render:()=>e.jsx("div",{className:"h-[560px] w-[560px] border border-line bg-canvas",children:e.jsx(n,{header:e.jsx(l,{title:a.new}),actionBar:t,children:e.jsx(d,{})})})},s={name:"Inline reply",render:()=>e.jsx("div",{className:"flex h-[400px] w-[640px] max-h-[400px] flex-col border-t border-line bg-canvas",children:e.jsx(n,{header:e.jsx(l,{title:a.reply}),quoted:e.jsx("div",{className:"border-l-2 border-line pl-3 text-xs text-fg-muted",children:"On Tuesday, Alex wrote: …"}),actionBar:t,children:e.jsx(d,{})})})},o={name:"Mobile sheet — Send within viewport",globals:{viewport:{value:"mobile"}},render:()=>e.jsxs("div",{className:"flex h-[95dvh] w-[390px] flex-col rounded-t-lg border border-line bg-canvas",children:[e.jsx("div",{className:"mx-auto mt-2 mb-1 h-1.5 w-12 rounded-full bg-fg-muted/30"}),e.jsx("div",{className:"border-b border-line px-4 py-2 text-base font-semibold",children:a.new}),e.jsx("div",{className:"min-h-0 flex-1",children:e.jsx(n,{header:e.jsx(l,{title:a.new}),actionBar:t,children:e.jsx(d,{})})})]})};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  name: "Desktop — full compose",
  render: () => <div className="h-[560px] w-[560px] border border-line bg-canvas">
            <ComposeFormShell header={<Header title={composeModeLabels.new} />} actionBar={bar}>
                <Body />
            </ComposeFormShell>
        </div>
}`,...r.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  name: "Inline reply",
  render: () => <div className="flex h-[400px] w-[640px] max-h-[400px] flex-col border-t border-line bg-canvas">
            <ComposeFormShell header={<Header title={composeModeLabels.reply} />} quoted={<div className="border-l-2 border-line pl-3 text-xs text-fg-muted">
                        On Tuesday, Alex wrote: …
                    </div>} actionBar={bar}>
                <Body />
            </ComposeFormShell>
        </div>
}`,...s.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  name: "Mobile sheet — Send within viewport",
  globals: {
    viewport: {
      value: "mobile"
    }
  },
  render: () => <div className="flex h-[95dvh] w-[390px] flex-col rounded-t-lg border border-line bg-canvas">
            <div className="mx-auto mt-2 mb-1 h-1.5 w-12 rounded-full bg-fg-muted/30" />
            <div className="border-b border-line px-4 py-2 text-base font-semibold">
                {composeModeLabels.new}
            </div>
            <div className="min-h-0 flex-1">
                <ComposeFormShell header={<Header title={composeModeLabels.new} />} actionBar={bar}>
                    <Body />
                </ComposeFormShell>
            </div>
        </div>
}`,...o.parameters?.docs?.source}}};const y=["DesktopFull","InlineReply","MobileSheet"];export{r as DesktopFull,s as InlineReply,o as MobileSheet,y as __namedExportsOrder,N as default};
