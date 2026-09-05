import{j as e,r as c}from"./iframe-uufGNBEn.js";import{B as d}from"./button-Wi0n0Lyz.js";import{C as p,S as f,W as y}from"./wizard-CUrxlFti.js";import{A as m}from"./at-sign-BqWf1Oxv.js";import{S as b}from"./server-CylP0bI9.js";import{I as j}from"./inbox-CimnAjxx.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./badge-DS2l7jE5.js";import"./security-select-BlwE66qt.js";import"./select-jAwdmlAP.js";import"./chevron-down-CGnGYV2L.js";import"./createLucideIcon-Bn-Stmx4.js";import"./field-label-Bp6oPTgY.js";import"./input-Cs8KaoXd.js";import"./check-BSgP79ub.js";const E={title:"Components/Wizard"};function S({children:o}){return e.jsx("div",{className:"grid max-w-xl grid-cols-1 gap-3 p-6 sm:grid-cols-3",children:o})}const s={render:()=>{const[o,r]=c.useState("imap");return e.jsxs(S,{children:[e.jsx(p,{name:"IMAP / SMTP",description:"Any mail provider — Fastmail, iCloud, your own server.",icon:e.jsx(b,{className:"size-5"}),selected:o==="imap",onSelect:()=>r("imap")}),e.jsx(p,{name:"Outlook / Microsoft 365",description:"Sign in with Microsoft. Works with Outlook.com and work accounts.",icon:e.jsx(j,{className:"size-5"}),selected:o==="microsoft",onSelect:()=>r("microsoft")}),e.jsx(p,{name:"Gmail",description:"Sign in with Google. No app passwords.",icon:e.jsx(m,{className:"size-5"}),comingSoon:!0})]})}},t={render:()=>e.jsx(S,{children:e.jsx(p,{name:"Gmail",description:"Sign in with Google. No app passwords.",icon:e.jsx(m,{className:"size-5"}),comingSoon:!0})})};function h(){const[o,r]=c.useState("imap.fastmail.example"),[g,v]=c.useState("993"),[w,x]=c.useState("tls");return e.jsx("div",{className:"max-w-xl p-6",children:e.jsx(f,{legend:"IMAP — incoming",badge:{label:"detected",tone:"positive"},host:o,port:g,security:w,onHostChange:r,onPortChange:v,onSecurityChange:x,hostPlaceholder:"imap.example.com",portPlaceholder:"993"})})}const n={name:"ServerFields",render:()=>e.jsx(h,{})},i={name:"ServerFields — phone",globals:{viewport:{value:"mobile"}},render:()=>e.jsx(h,{})},C=Array.from({length:60},(o,r)=>`Row ${r+1} of a report nobody sized the box for`);function u(){return e.jsx(y,{steps:["File","Review","Credentials","Folders"],activeStep:1,title:"What this file will change",subtitle:"A step whose content runs well past the bottom of the screen.",footer:e.jsxs(e.Fragment,{children:[e.jsx(d,{variant:"ghost",children:"Back"}),e.jsx(d,{variant:"primary",children:"Continue"})]}),children:e.jsx("ul",{className:"divide-y divide-line",children:C.map(o=>e.jsx("li",{className:"py-2 text-sm text-fg",children:o},o))})})}const a={name:"WizardShell — long step, short viewport",parameters:{layout:"fullscreen"},globals:{viewport:{value:"laptopShort"}},render:()=>e.jsx(u,{})},l={name:"WizardShell — long step, short phone",parameters:{layout:"fullscreen"},globals:{viewport:{value:"mobileShort"}},render:()=>e.jsx(u,{})};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [selected, setSelected] = useState("imap");
    return <TileRow>
                <ConnectorTile name="IMAP / SMTP" description="Any mail provider — Fastmail, iCloud, your own server." icon={<Server className="size-5" />} selected={selected === "imap"} onSelect={() => setSelected("imap")} />
                <ConnectorTile name="Outlook / Microsoft 365" description="Sign in with Microsoft. Works with Outlook.com and work accounts." icon={<Inbox className="size-5" />} selected={selected === "microsoft"} onSelect={() => setSelected("microsoft")} />
                <ConnectorTile name="Gmail" description="Sign in with Google. No app passwords." icon={<AtSign className="size-5" />} comingSoon />
            </TileRow>;
  }
}`,...s.parameters?.docs?.source},description:{story:'Selectable connectors: one active, one selected, one "soon".',...s.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <TileRow>
            <ConnectorTile name="Gmail" description="Sign in with Google. No app passwords." icon={<AtSign className="size-5" />} comingSoon />
        </TileRow>
}`,...t.parameters?.docs?.source},description:{story:`A "soon" tile is muted but never disabled: pressing it surfaces a one-line
explainer instead of going dead (never-disable tenet, #798).`,...t.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "ServerFields",
  render: () => <ServerFieldsDemo />
}`,...n.parameters?.docs?.source},description:{story:"Host / port / security for one protocol.",...n.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  name: "ServerFields — phone",
  globals: {
    viewport: {
      value: "mobile"
    }
  },
  render: () => <ServerFieldsDemo />
}`,...i.parameters?.docs?.source},description:{story:"Phone width: the grid stacks so the Security select stays reachable (#780).",...i.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  name: "WizardShell — long step, short viewport",
  parameters: {
    layout: "fullscreen"
  },
  globals: {
    viewport: {
      value: "laptopShort"
    }
  },
  render: () => <LongStep />
}`,...a.parameters?.docs?.source},description:{story:`A step taller than the viewport, on the 1512×827 laptop the config import
wizard was found unusable on (#1021). The rows scroll inside the card; the
title and the Continue button stay on screen.`,...a.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  name: "WizardShell — long step, short phone",
  parameters: {
    layout: "fullscreen"
  },
  globals: {
    viewport: {
      value: "mobileShort"
    }
  },
  render: () => <LongStep />
}`,...l.parameters?.docs?.source},description:{story:"The same step on a phone with the address bar and system nav showing.",...l.parameters?.docs?.description}}};const H=["Connectors","ComingSoonTilePressable","ServerFieldsStory","ServerFieldsPhone","ShellLongStepShortViewport","ShellLongStepPhoneShort"];export{t as ComingSoonTilePressable,s as Connectors,i as ServerFieldsPhone,n as ServerFieldsStory,l as ShellLongStepPhoneShort,a as ShellLongStepShortViewport,H as __namedExportsOrder,E as default};
