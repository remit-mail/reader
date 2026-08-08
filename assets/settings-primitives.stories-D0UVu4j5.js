import{j as e,r}from"./iframe-zw88L4Mq.js";import{B as m}from"./button-B3Yk1mOK.js";import{D as u,S as d}from"./sender-group-switch-CuIy9ITu.js";import{S as l}from"./segmented-control-WM6knAuG.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";import"./triangle-alert-DvQXczKn.js";import"./createLucideIcon-AdIgPHc_.js";const f={title:"Settings/Primitives"},t={render:()=>{const[o,s]=r.useState("comfortable"),[i,c]=r.useState("system");return e.jsxs("div",{className:"flex flex-col gap-6 p-8",children:[e.jsx(l,{name:"density","aria-label":"Density",value:o,onChange:s,options:[{value:"comfortable",label:"Comfortable"},{value:"compact",label:"Compact"}]}),e.jsx(l,{name:"theme","aria-label":"Theme",value:i,onChange:c,options:[{value:"system",label:"System"},{value:"light",label:"Light"},{value:"dark",label:"Dark"}]})]})}},n={render:()=>{const[o,s]=r.useState("vip");return e.jsx("div",{className:"flex h-96 p-8",children:e.jsx(d,{active:o,onSelect:s,options:[{id:"vip",label:"VIPs",count:12},{id:"muted",label:"Muted",count:null},{id:"blocked",label:"Blocked",count:null}]})})}},a={render:()=>e.jsx("div",{className:"max-w-2xl p-8",children:e.jsx(u,{title:"Delete your Remit account",description:"Disconnects every account and erases Remit's copy of your mail, insights and preferences. Your mail at the providers is untouched.",action:e.jsx(m,{variant:"danger",size:"sm",children:"Delete your Remit account"})})})};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [density, setDensity] = useState("comfortable");
    const [theme, setTheme] = useState("system");
    return <div className="flex flex-col gap-6 p-8">
                <SegmentedControl name="density" aria-label="Density" value={density} onChange={setDensity} options={[{
        value: "comfortable",
        label: "Comfortable"
      }, {
        value: "compact",
        label: "Compact"
      }]} />
                <SegmentedControl name="theme" aria-label="Theme" value={theme} onChange={setTheme} options={[{
        value: "system",
        label: "System"
      }, {
        value: "light",
        label: "Light"
      }, {
        value: "dark",
        label: "Dark"
      }]} />
            </div>;
  }
}`,...t.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [active, setActive] = useState("vip");
    return <div className="flex h-96 p-8">
                <SenderGroupSwitch active={active} onSelect={setActive} options={[{
        id: "vip",
        label: "VIPs",
        count: 12
      }, {
        id: "muted",
        label: "Muted",
        count: null
      }, {
        id: "blocked",
        label: "Blocked",
        count: null
      }]} />
            </div>;
  }
}`,...n.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <div className="max-w-2xl p-8">
            <DangerZoneSection title="Delete your Remit account" description="Disconnects every account and erases Remit's copy of your mail, insights and preferences. Your mail at the providers is untouched." action={<Button variant="danger" size="sm">
                        Delete your Remit account
                    </Button>} />
        </div>
}`,...a.parameters?.docs?.source}}};const D=["SegmentedControls","SenderGroupSwitchRail","DangerZone"];export{a as DangerZone,t as SegmentedControls,n as SenderGroupSwitchRail,D as __namedExportsOrder,f as default};
