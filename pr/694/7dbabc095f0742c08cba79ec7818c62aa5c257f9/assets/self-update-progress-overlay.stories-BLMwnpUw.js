import{j as t}from"./iframe-uTafckjr.js";import{d as i,a as p}from"./self-update-sRZdiOBg.js";import{S as d,a as m}from"./self-update-progress-overlay-BBNf9nJB.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./button-DCXIHjmE.js";import"./check-CM0cWxPP.js";import"./createLucideIcon-DLYy-DY-.js";import"./loader-circle-BjZYR62R.js";import"./octagon-alert-CMw1lVMf.js";const x={title:"Settings/Self-update restart",component:d,parameters:{layout:"fullscreen"},args:{target:i.version},decorators:[c=>t.jsxs("div",{className:"h-dvh w-full bg-canvas p-6",children:[t.jsx("p",{className:"text-sm text-fg-subtle",children:"Settings sits here. The overlay is fixed to the window, so this stays covered and out of tab order."}),t.jsx(c,{})]})]},e={args:{phase:"preparing",elapsedSeconds:6}},s={args:{phase:"restarting",elapsedSeconds:24}},r={args:{phase:"reconnecting",elapsedSeconds:48}},n={args:{phase:"reconnecting",elapsedSeconds:200}},a={args:{phase:"reconnecting",elapsedSeconds:300}},o={render:()=>t.jsx(m,{attemptedVersion:i.version,previousVersion:"0.9.3",elapsedSeconds:420,logsCommand:p,onRetryConnection:()=>{}})};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    phase: "preparing",
    elapsedSeconds: 6
  }
}`,...e.parameters?.docs?.source},description:{story:`The new version is being put in place; the running server has not gone away
yet.`,...e.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    phase: "restarting",
    elapsedSeconds: 24
  }
}`,...s.parameters?.docs?.source},description:{story:"The server is going down. From here the page has nothing to talk to.",...s.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    phase: "reconnecting",
    elapsedSeconds: 48
  }
}`,...r.parameters?.docs?.source},description:{story:`Polling for a server that is not answering yet. This is the normal middle of
an update, so it reads as waiting, not as failure.`,...r.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    phase: "reconnecting",
    elapsedSeconds: 200
  }
}`,...n.parameters?.docs?.source},description:{story:`Past the point where "about a minute" is still true. The copy stops making
that promise rather than repeating it.`,...n.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    phase: "reconnecting",
    elapsedSeconds: 300
  }
}`,...a.parameters?.docs?.source},description:{story:`Long silence. The copy still describes only what the client can observe —
how long it has been quiet — and never what the server is doing about it.`,...a.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <SelfUpdateUnreachableScreen attemptedVersion={demoRelease.version} previousVersion="0.9.3" elapsedSeconds={420} logsCommand={demoLogsCommand} onRetryConnection={() => {}} />
}`,...o.parameters?.docs?.source},description:{story:`The server never came back. The client cannot see the rollback from here, so
it says what it knows and points at the machine that can answer.`,...o.parameters?.docs?.description}}};const T=["Preparing","Restarting","Reconnecting","ReconnectingTakingLong","ReconnectingStillSilent","NeverCameBack"];export{o as NeverCameBack,e as Preparing,r as Reconnecting,a as ReconnectingStillSilent,n as ReconnectingTakingLong,s as Restarting,T as __namedExportsOrder,x as default};
