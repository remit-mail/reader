import{j as e}from"./iframe-BxLfZl0d.js";import{R as s}from"./refresh-button-D7hUJJBO.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./button-y3nctzTP.js";import"./circle-alert-dyRtukXU.js";import"./createLucideIcon-DDkWk8mg.js";import"./circle-check-big-lx686hz5.js";import"./refresh-cw-CTFJpCrS.js";const v={title:"Mail/RefreshButton",component:s,args:{label:"Refresh inbox",onRefresh:()=>{}}},r={args:{state:"idle"}},a={args:{state:"idle",hasUpdate:!0}},o={args:{state:"refreshing"}},c={args:{state:"success"}},i={args:{state:"error",errorMessage:"Couldn't reach the server — check your connection"}},n={render:t=>e.jsxs("div",{className:"flex items-center gap-4 p-4",children:[e.jsxs("div",{className:"flex flex-col items-center gap-1 text-2xs text-fg-muted",children:[e.jsx(s,{...t,state:"idle"}),"Idle"]}),e.jsxs("div",{className:"flex flex-col items-center gap-1 text-2xs text-fg-muted",children:[e.jsx(s,{...t,state:"idle",hasUpdate:!0}),"New mail"]}),e.jsxs("div",{className:"flex flex-col items-center gap-1 text-2xs text-fg-muted",children:[e.jsx(s,{...t,state:"refreshing"}),"Refreshing"]}),e.jsxs("div",{className:"flex flex-col items-center gap-1 text-2xs text-fg-muted",children:[e.jsx(s,{...t,state:"success"}),"Success"]}),e.jsxs("div",{className:"flex flex-col items-center gap-1 text-2xs text-fg-muted",children:[e.jsx(s,{...t,state:"error",errorMessage:"Couldn't reach the server"}),"Failed"]})]})};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    state: "idle"
  }
}`,...r.parameters?.docs?.source},description:{story:"At rest, nothing to report.",...r.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    state: "idle",
    hasUpdate: true
  }
}`,...a.parameters?.docs?.source},description:{story:`The background poll found new mail; the dot is the whole message — nothing
reloads until this is clicked.`,...a.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    state: "refreshing"
  }
}`,...o.parameters?.docs?.source},description:{story:`A sync round is in flight — the glyph spins and the button won't stack a
second click on top of it.`,...o.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: {
    state: "success"
  }
}`,...c.parameters?.docs?.source},description:{story:"Confirms the refresh landed with nothing left unresolved.",...c.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    state: "error",
    errorMessage: "Couldn't reach the server — check your connection"
  }
}`,...i.parameters?.docs?.source},description:{story:`The refresh could not be confirmed — a real reason in the tooltip and the
accessible name, and clicking retries the same action.`,...i.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: args => <div className="flex items-center gap-4 p-4">
            <div className="flex flex-col items-center gap-1 text-2xs text-fg-muted">
                <RefreshButton {...args} state="idle" />
                Idle
            </div>
            <div className="flex flex-col items-center gap-1 text-2xs text-fg-muted">
                <RefreshButton {...args} state="idle" hasUpdate />
                New mail
            </div>
            <div className="flex flex-col items-center gap-1 text-2xs text-fg-muted">
                <RefreshButton {...args} state="refreshing" />
                Refreshing
            </div>
            <div className="flex flex-col items-center gap-1 text-2xs text-fg-muted">
                <RefreshButton {...args} state="success" />
                Success
            </div>
            <div className="flex flex-col items-center gap-1 text-2xs text-fg-muted">
                <RefreshButton {...args} state="error" errorMessage="Couldn't reach the server" />
                Failed
            </div>
        </div>
}`,...n.parameters?.docs?.source},description:{story:"All four states side by side.",...n.parameters?.docs?.description}}};const N=["Idle","NewMailAvailable","Refreshing","Success","Failed","AllStates"];export{n as AllStates,i as Failed,r as Idle,a as NewMailAvailable,o as Refreshing,c as Success,N as __namedExportsOrder,v as default};
