import{j as e,r as n}from"./iframe-zw88L4Mq.js";import{C as p}from"./compose-address-field-B0niO3UV.js";import{C as b,a as E,c as A}from"./compose-subject-field-DMHBbmpU.js";import"./preload-helper-PPVm8Dsz.js";import"./suggest-list-DVXPmXkz.js";import"./cn-yMAG7bfM.js";import"./address-tag-BT5yL9-U.js";import"./x-BLGUIrqQ.js";import"./createLucideIcon-AdIgPHc_.js";const{expect:c,userEvent:y,within:H}=__STORYBOOK_MODULE_TEST__,O=({email:t})=>e.jsxs("div",{className:"flex items-start gap-2",children:[e.jsx("label",{className:"text-sm text-fg-muted shrink-0 w-12 pt-1.5",children:"From:"}),e.jsx("div",{className:"text-sm py-1.5",children:t})]}),K={title:"Mail/ComposeHeader",component:b,parameters:{layout:"padded",docs:{description:{component:`Who the message is going to and what it is about. Cc and Bcc are not there
until they are asked for — the common message has one recipient line, and
three empty ones push the writing surface off a phone.`}}}},s=({initialTo:t=[],initialCc:a,initialBcc:u,initialSubject:B="",collapsed:C=!1})=>{const[h,v]=n.useState(t),[x,j]=n.useState(a??[]),[g,S]=n.useState(u??[]),[T,f]=n.useState(a!==void 0),[R,N]=n.useState(u!==void 0),[w,L]=n.useState(B);return e.jsx("div",{className:"w-[560px] border border-line bg-surface",children:e.jsx(b,{collapsed:C,summary:A({to:h,cc:x,bcc:g,subject:w}),from:e.jsx(O,{email:"alice@northwind.example"}),to:e.jsx(p,{label:"To",addresses:h,onChange:v,placeholder:"Recipients"}),cc:T?e.jsx(p,{label:"Cc",addresses:x,onChange:j}):void 0,bcc:R?e.jsx(p,{label:"Bcc",addresses:g,onChange:S}):void 0,subject:e.jsx(E,{value:w,onChange:L}),onShowCc:()=>f(!0),onShowBcc:()=>N(!0)})})},i={name:"New message — nothing filled in",render:()=>e.jsx(s,{})},l={render:()=>e.jsx(s,{initialTo:[{email:"ada@northwind.example",displayName:"Ada"}],initialSubject:"Re: Q3 planning"})},d={render:()=>e.jsx(s,{initialTo:[{email:"ada@northwind.example",displayName:"Ada"}],initialCc:[{email:"grace@northwind.example"}],initialBcc:[],initialSubject:"Re: Q3 planning"})},r={render:()=>e.jsx(s,{collapsed:!0,initialTo:[{email:"ada@northwind.example",displayName:"Ada Lovelace"}],initialCc:[{email:"grace@northwind.example"}],initialSubject:"Re: Q3 planning"})},o={render:()=>e.jsx(s,{collapsed:!0})},m={render:()=>e.jsx(s,{}),play:async({canvasElement:t})=>{const a=H(t);await c(a.queryByLabelText("Cc:")).not.toBeInTheDocument(),await y.click(a.getByRole("button",{name:"Cc"})),await c(a.getByLabelText("Cc:")).toBeVisible(),await c(a.queryByLabelText("Bcc:")).not.toBeInTheDocument(),await y.click(a.getByRole("button",{name:"Bcc"})),await c(a.getByLabelText("Bcc:")).toBeVisible()}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  name: "New message — nothing filled in",
  render: () => <Harness />
}`,...i.parameters?.docs?.source}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialTo={[{
    email: "ada@northwind.example",
    displayName: "Ada"
  }]} initialSubject="Re: Q3 planning" />
}`,...l.parameters?.docs?.source}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialTo={[{
    email: "ada@northwind.example",
    displayName: "Ada"
  }]} initialCc={[{
    email: "grace@northwind.example"
  }]} initialBcc={[]} initialSubject="Re: Q3 planning" />
}`,...d.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <Harness collapsed initialTo={[{
    email: "ada@northwind.example",
    displayName: "Ada Lovelace"
  }]} initialCc={[{
    email: "grace@northwind.example"
  }]} initialSubject="Re: Q3 planning" />
}`,...r.parameters?.docs?.source},description:{story:`The software keyboard is up on a phone. The header gives its space to the
writing surface and keeps one line of what is already filled in.`,...r.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <Harness collapsed />
}`,...o.parameters?.docs?.source},description:{story:"Collapsed before anything is typed: an ellipsis, not an empty bar.",...o.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  render: () => <Harness />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByLabelText("Cc:")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", {
      name: "Cc"
    }));
    await expect(canvas.getByLabelText("Cc:")).toBeVisible();
    await expect(canvas.queryByLabelText("Bcc:")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", {
      name: "Bcc"
    }));
    await expect(canvas.getByLabelText("Bcc:")).toBeVisible();
  }
}`,...m.parameters?.docs?.source}}};const U=["NewMessage","Reply","CcAndBccRevealed","Collapsed","CollapsedAndEmpty","RevealingCcLeavesBccOnOffer"];export{d as CcAndBccRevealed,r as Collapsed,o as CollapsedAndEmpty,i as NewMessage,l as Reply,m as RevealingCcLeavesBccOnOffer,U as __namedExportsOrder,K as default};
