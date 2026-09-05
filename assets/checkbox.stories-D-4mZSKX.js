import{r as l,j as e}from"./iframe-uufGNBEn.js";import{C as c}from"./checkbox-Dp2a0wRA.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./check-BSgP79ub.js";import"./createLucideIcon-Bn-Stmx4.js";import"./minus-WgJswgYh.js";const g={title:"Components/Checkbox",component:c,parameters:{layout:"padded"},decorators:[t=>e.jsx("div",{className:"mx-auto max-w-sm rounded-xl border border-line bg-surface p-4",children:e.jsx(t,{})})]},s={render:()=>{const[t,r]=l.useState(!0);return e.jsx(c,{label:"Move these out of Spam",description:"You can undo this later",checked:t,onChange:a=>r(a.target.checked)})}},n={render:()=>{const[t,r]=l.useState(!1);return e.jsx(c,{label:"Keep me posted",checked:t,onChange:a=>r(a.target.checked)})}},o={render:()=>e.jsx(c,{label:"Some selected",description:"Tri-state, e.g. a select-all header",indeterminate:!0,checked:!1,onChange:()=>{}})},d={name:"Bare control (no label)",render:()=>{const[t,r]=l.useState(!0);return e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsx(c,{"aria-label":"Select row",checked:t,onChange:a=>r(a.target.checked)}),e.jsx("span",{className:"text-sm text-fg-muted",children:"Embedded in a row that owns the touch target"})]})}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [checked, setChecked] = useState(true);
    return <Checkbox label="Move these out of Spam" description="You can undo this later" checked={checked} onChange={e => setChecked(e.target.checked)} />;
  }
}`,...s.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [checked, setChecked] = useState(false);
    return <Checkbox label="Keep me posted" checked={checked} onChange={e => setChecked(e.target.checked)} />;
  }
}`,...n.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <Checkbox label="Some selected" description="Tri-state, e.g. a select-all header" indeterminate checked={false} onChange={() => {}} />
}`,...o.parameters?.docs?.source}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  name: "Bare control (no label)",
  render: () => {
    const [checked, setChecked] = useState(true);
    return <div className="flex items-center gap-3">
                <Checkbox aria-label="Select row" checked={checked} onChange={e => setChecked(e.target.checked)} />
                <span className="text-sm text-fg-muted">
                    Embedded in a row that owns the touch target
                </span>
            </div>;
  }
}`,...d.parameters?.docs?.source}}};const C=["Labelled","Unchecked","Indeterminate","BareControl"];export{d as BareControl,o as Indeterminate,s as Labelled,n as Unchecked,C as __namedExportsOrder,g as default};
