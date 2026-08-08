import{j as n}from"./iframe-zw88L4Mq.js";import{L as t,l as c}from"./label-chip-DCJIAgrz.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";const b={title:"Primitives/LabelChip",component:t,parameters:{layout:"padded"}},a={render:()=>n.jsx("div",{className:"flex flex-wrap gap-2",children:c.map(e=>n.jsx(t,{label:{labelId:`lbl-${e}`,name:e,color:e}},e))})},r={name:"All Colors (dark)",parameters:{theme:"dark"},render:()=>n.jsx("div",{className:"flex flex-wrap gap-2",children:c.map(e=>n.jsx(t,{label:{labelId:`lbl-${e}`,name:e,color:e}},e))})},o={args:{label:{labelId:"lbl-long",name:"Quarterly compliance filings that need a second look",color:"Purple"},className:"max-w-40"}},l={args:{label:{labelId:"lbl-receipts",name:"Receipts",color:"Blue"},onRemove:()=>{}}},s={name:"Removable (dark)",parameters:{theme:"dark"},args:{label:{labelId:"lbl-receipts",name:"Receipts",color:"Blue"},onRemove:()=>{}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex flex-wrap gap-2">
            {labelColorOptions.map(color => <LabelChip key={color} label={{
      labelId: \`lbl-\${color}\`,
      name: color,
      color
    }} />)}
        </div>
}`,...a.parameters?.docs?.source},description:{story:"A chip in each color the picker offers — the dot is the only thing that varies.",...a.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  name: "All Colors (dark)",
  parameters: {
    theme: "dark"
  },
  render: () => <div className="flex flex-wrap gap-2">
            {labelColorOptions.map(color => <LabelChip key={color} label={{
      labelId: \`lbl-\${color}\`,
      name: color,
      color
    }} />)}
        </div>
}`,...r.parameters?.docs?.source},description:{story:"Same colors against the dark theme, so the dot keeps contrast either way.",...r.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    label: {
      labelId: "lbl-long",
      name: "Quarterly compliance filings that need a second look",
      color: "Purple"
    },
    className: "max-w-40"
  }
}`,...o.parameters?.docs?.source},description:{story:"A long name truncates rather than growing the chip.",...o.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  args: {
    label: {
      labelId: "lbl-receipts",
      name: "Receipts",
      color: "Blue"
    },
    onRemove: () => undefined
  }
}`,...l.parameters?.docs?.source},description:{story:'The removable variant — the manual "just these" unlabel action.',...l.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  name: "Removable (dark)",
  parameters: {
    theme: "dark"
  },
  args: {
    label: {
      labelId: "lbl-receipts",
      name: "Receipts",
      color: "Blue"
    },
    onRemove: () => undefined
  }
}`,...s.parameters?.docs?.source},description:{story:"Removable, on the dark theme.",...s.parameters?.docs?.description}}};const h=["AllColors","AllColorsDark","LongName","Removable","RemovableDark"];export{a as AllColors,r as AllColorsDark,o as LongName,l as Removable,s as RemovableDark,h as __namedExportsOrder,b as default};
