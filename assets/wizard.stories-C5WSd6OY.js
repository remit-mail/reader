import{j as e,r as a}from"./iframe-zw88L4Mq.js";import{C as c,S as x}from"./wizard-DcAuqQgy.js";import{A as l}from"./at-sign-C7Ac3Ioz.js";import{S as v}from"./server-CEzV2oed.js";import{I as h}from"./inbox-xh3kJz_j.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";import"./badge-Ee126ieB.js";import"./security-select-BL9hFDAo.js";import"./select-B6Imrwed.js";import"./chevron-down-D70ORMFZ.js";import"./createLucideIcon-AdIgPHc_.js";import"./field-label-CWEwu_wo.js";import"./input-Cji_nj0c.js";import"./check-DQN2CS7b.js";const I={title:"Components/Wizard"};function m({children:o}){return e.jsx("div",{className:"grid max-w-xl grid-cols-1 gap-3 p-6 sm:grid-cols-3",children:o})}const s={render:()=>{const[o,n]=a.useState("imap");return e.jsxs(m,{children:[e.jsx(c,{name:"IMAP / SMTP",description:"Any mail provider — Fastmail, iCloud, your own server.",icon:e.jsx(v,{className:"size-5"}),selected:o==="imap",onSelect:()=>n("imap")}),e.jsx(c,{name:"Outlook / Microsoft 365",description:"Sign in with Microsoft. Works with Outlook.com and work accounts.",icon:e.jsx(h,{className:"size-5"}),selected:o==="microsoft",onSelect:()=>n("microsoft")}),e.jsx(c,{name:"Gmail",description:"Sign in with Google. No app passwords.",icon:e.jsx(l,{className:"size-5"}),comingSoon:!0})]})}},r={render:()=>e.jsx(m,{children:e.jsx(c,{name:"Gmail",description:"Sign in with Google. No app passwords.",icon:e.jsx(l,{className:"size-5"}),comingSoon:!0})})};function d(){const[o,n]=a.useState("imap.fastmail.example"),[p,S]=a.useState("993"),[u,g]=a.useState("tls");return e.jsx("div",{className:"max-w-xl p-6",children:e.jsx(x,{legend:"IMAP — incoming",badge:{label:"detected",tone:"positive"},host:o,port:p,security:u,onHostChange:n,onPortChange:S,onSecurityChange:g,hostPlaceholder:"imap.example.com",portPlaceholder:"993"})})}const t={name:"ServerFields",render:()=>e.jsx(d,{})},i={name:"ServerFields — phone",globals:{viewport:{value:"mobile"}},render:()=>e.jsx(d,{})};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [selected, setSelected] = useState("imap");
    return <TileRow>
                <ConnectorTile name="IMAP / SMTP" description="Any mail provider — Fastmail, iCloud, your own server." icon={<Server className="size-5" />} selected={selected === "imap"} onSelect={() => setSelected("imap")} />
                <ConnectorTile name="Outlook / Microsoft 365" description="Sign in with Microsoft. Works with Outlook.com and work accounts." icon={<Inbox className="size-5" />} selected={selected === "microsoft"} onSelect={() => setSelected("microsoft")} />
                <ConnectorTile name="Gmail" description="Sign in with Google. No app passwords." icon={<AtSign className="size-5" />} comingSoon />
            </TileRow>;
  }
}`,...s.parameters?.docs?.source},description:{story:'Selectable connectors: one active, one selected, one "soon".',...s.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <TileRow>
            <ConnectorTile name="Gmail" description="Sign in with Google. No app passwords." icon={<AtSign className="size-5" />} comingSoon />
        </TileRow>
}`,...r.parameters?.docs?.source},description:{story:`A "soon" tile is muted but never disabled: pressing it surfaces a one-line
explainer instead of going dead (never-disable tenet, #798).`,...r.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  name: "ServerFields",
  render: () => <ServerFieldsDemo />
}`,...t.parameters?.docs?.source},description:{story:"Host / port / security for one protocol.",...t.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  name: "ServerFields — phone",
  globals: {
    viewport: {
      value: "mobile"
    }
  },
  render: () => <ServerFieldsDemo />
}`,...i.parameters?.docs?.source},description:{story:"Phone width: the grid stacks so the Security select stays reachable (#780).",...i.parameters?.docs?.description}}};const R=["Connectors","ComingSoonTilePressable","ServerFieldsStory","ServerFieldsPhone"];export{r as ComingSoonTilePressable,s as Connectors,i as ServerFieldsPhone,t as ServerFieldsStory,R as __namedExportsOrder,I as default};
