import{j as e,r as y}from"./iframe-BxLfZl0d.js";import{S as C}from"./search-chip-input-BNVUlIsB.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./search-token-chip-Dz97Zxy_.js";import"./x-BYZsfpI2.js";import"./createLucideIcon-DDkWk8mg.js";import"./search-B2ZXIDXt.js";const P={title:"Mail/SearchChipInput",component:C,parameters:{layout:"padded"}},r=({initialChips:f=[],initialValue:v="",size:S="sm",offer:F=[]})=>{const[b,u]=y.useState(f),[O,x]=y.useState(v),g=F.filter(a=>!b.some(o=>o.id===a.id));return e.jsxs("div",{className:"flex w-full max-w-2xl flex-col gap-3",children:[e.jsx(C,{chips:b,onRemoveChip:a=>u(o=>o.filter(E=>E.id!==a)),value:O,onChange:x,onClear:()=>{x(""),u([])},onClearQuery:()=>x(""),globalFocusKey:!1,size:S}),g.length>0&&e.jsxs("div",{className:"flex flex-wrap items-center gap-2",children:[e.jsx("span",{className:"text-2xs text-fg-subtle",children:"Add filter:"}),g.map(a=>e.jsx("button",{type:"button",onClick:()=>u(o=>[...o,a]),className:"rounded-full border border-line px-2 py-0.5 text-2xs text-fg-muted hover:bg-surface",children:a.label},a.id))]}),e.jsx("p",{className:"max-w-prose text-2xs leading-relaxed text-fg-subtle",children:"One tab stop. From the text: Backspace or ArrowLeft at the very start moves onto the last chip, Shift+Tab steps back into the chips. On a chip: Backspace or Delete removes it, Left/Right walk the chips, ArrowRight past the last one returns to the text. After a removal focus lands on the chip that took its place, else the previous one, else the text."})]})},s={id:"in:spam",label:"in:spam",tone:"scope"},t=[{id:"from:acme",label:"from:acme"},{id:"has:attachment",label:"has:attachment"},{id:"is:unread",label:"is:unread"},{id:"before:2026-01-01",label:"before:2026-01-01"}],i={render:()=>e.jsx(r,{offer:[s,...t]})},n={render:()=>e.jsx(r,{initialChips:[s],offer:t})},c={render:()=>e.jsx(r,{initialChips:[s],initialValue:"invoice",offer:t})},p={render:()=>e.jsx(r,{initialChips:[s,{id:"from:acme",label:"from:acme"},{id:"has:attachment",label:"has:attachment"},{id:"before:2026-01-01",label:"before:2026-01-01"}],initialValue:"refund",offer:t})},l={render:()=>e.jsx(r,{initialChips:[s],initialValue:"from:bob receipt",offer:t})},d={render:()=>e.jsx(r,{initialChips:[{id:"from:long",label:"from:notifications-noreply@some-very-long-domain.example.com"}],offer:t})},m={render:()=>e.jsx(r,{size:"lg",initialChips:[s],offer:t})},h={render:()=>e.jsx(r,{initialChips:[s],offer:t}),play:async({canvasElement:f})=>{f.querySelector('[role="row"] button')?.focus()}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive offer={[SCOPE, ...OFFER]} />
}`,...i.parameters?.docs?.source},description:{story:"Unscoped — the daily brief's state: no chips, search reads across everything.",...i.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive initialChips={[SCOPE]} offer={OFFER} />
}`,...n.parameters?.docs?.source},description:{story:`One narrowing chip: the view the user navigated into. A scope carries a
different tint from a filter the user added, because it came from where they
are rather than from something they typed.`,...n.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive initialChips={[SCOPE]} initialValue="invoice" offer={OFFER} />
}`,...c.parameters?.docs?.source},description:{story:"A chip and free text together — one expression, read left to right.",...c.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive initialChips={[SCOPE, {
    id: "from:acme",
    label: "from:acme"
  }, {
    id: "has:attachment",
    label: "has:attachment"
  }, {
    id: "before:2026-01-01",
    label: "before:2026-01-01"
  }]} initialValue="refund" offer={OFFER} />
}`,...p.parameters?.docs?.source},description:{story:"Several chips: they wrap onto the next line rather than clipping.",...p.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive initialChips={[SCOPE]} initialValue="from:bob receipt" offer={OFFER} />
}`,...l.parameters?.docs?.source},description:{story:`A typed operator stays plain text. Chipping only what the product committed
keeps the typed query honest — the text is exactly what the user typed, and
the field never has to guess what was meant as an operator.`,...l.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive initialChips={[{
    id: "from:long",
    label: "from:notifications-noreply@some-very-long-domain.example.com"
  }]} offer={OFFER} />
}`,...d.parameters?.docs?.source},description:{story:"A long chip label truncates; its remove control stays reachable.",...d.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive size="lg" initialChips={[SCOPE]} offer={OFFER} />
}`,...m.parameters?.docs?.source},description:{story:"The taller field the global top bar uses.",...m.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive initialChips={[SCOPE]} offer={OFFER} />,
  play: async ({
    canvasElement
  }) => {
    canvasElement.querySelector<HTMLButtonElement>('[role="row"] button')?.focus();
  }
}`,...h.parameters?.docs?.source},description:{story:`Focus resting on a chip — the state the first Backspace leaves the field in,
from which a second Backspace removes it.`,...h.parameters?.docs?.description}}};const B=["Unscoped","OneChip","ChipWithText","MultipleChips","TypedOperatorStaysText","LongChipLabel","LargeForTopBar","ChipFocused"];export{h as ChipFocused,c as ChipWithText,m as LargeForTopBar,d as LongChipLabel,p as MultipleChips,n as OneChip,l as TypedOperatorStaysText,i as Unscoped,B as __namedExportsOrder,P as default};
