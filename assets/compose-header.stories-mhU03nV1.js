import{j as e,r as s}from"./iframe-BxLfZl0d.js";import{C as u}from"./compose-address-field-BRnXbcUj.js";import{C as B,a as O,c as Q}from"./compose-subject-field-DYmArI7z.js";import"./preload-helper-PPVm8Dsz.js";import"./suggest-list-BMzgWPLj.js";import"./cn-d2XQ1MEC.js";import"./address-tag-BKpYEEBZ.js";import"./x-BYZsfpI2.js";import"./createLucideIcon-DDkWk8mg.js";import"./chevron-down-DBsC1ZFK.js";const{expect:c,userEvent:h,within:v}=__STORYBOOK_MODULE_TEST__,_=({email:n})=>e.jsxs("div",{className:"flex items-start gap-2",children:[e.jsx("label",{className:"text-sm text-fg-muted shrink-0 w-12 pt-1.5",children:"From:"}),e.jsx("div",{className:"text-sm py-1.5",children:n})]}),Y={title:"Mail/ComposeHeader",component:B,parameters:{layout:"padded",docs:{description:{component:`Who the message is going to and what it is about. Cc and Bcc are not there
until they are asked for — the common message has one recipient line, and
three empty ones push the writing surface off a phone.`}}}},t=({initialTo:n=[],initialCc:a,initialBcc:x,initialSubject:C="",collapsed:j=!1})=>{const[y,S]=s.useState(n),[b,T]=s.useState(a??[]),[g,f]=s.useState(x??[]),[R,E]=s.useState(a!==void 0),[L,N]=s.useState(x!==void 0),[w,k]=s.useState(C),[A,H]=s.useState(j);return e.jsx("div",{className:"w-[560px] border border-line bg-surface",children:e.jsx(B,{collapsed:A,onExpand:()=>H(!1),summary:Q({to:y,cc:b,bcc:g,subject:w}),from:e.jsx(_,{email:"alice@northwind.example"}),to:e.jsx(u,{label:"To",addresses:y,onChange:S,placeholder:"Recipients"}),cc:R?e.jsx(u,{label:"Cc",addresses:b,onChange:T}):void 0,bcc:L?e.jsx(u,{label:"Bcc",addresses:g,onChange:f}):void 0,subject:e.jsx(O,{value:w,onChange:k}),onShowCc:()=>E(!0),onShowBcc:()=>N(!0)})})},l={name:"New message — nothing filled in",render:()=>e.jsx(t,{})},d={render:()=>e.jsx(t,{initialTo:[{email:"ada@northwind.example",displayName:"Ada"}],initialSubject:"Re: Q3 planning"})},p={render:()=>e.jsx(t,{initialTo:[{email:"ada@northwind.example",displayName:"Ada"}],initialCc:[{email:"grace@northwind.example"}],initialBcc:[],initialSubject:"Re: Q3 planning"})},o={render:()=>e.jsx(t,{collapsed:!0,initialTo:[{email:"ada@northwind.example",displayName:"Ada Lovelace"}],initialCc:[{email:"grace@northwind.example"}],initialSubject:"Re: Q3 planning"})},i={render:()=>e.jsx(t,{collapsed:!0})},r={render:()=>e.jsx(t,{collapsed:!0,initialTo:[{email:"ada@northwind.example",displayName:"Ada Lovelace"}],initialSubject:"Re: Q3 planning"}),play:async({canvasElement:n})=>{const a=v(n);await h.click(a.getByRole("button",{name:"Show recipients and subject"})),await c(a.getByLabelText("To:")).toBeVisible()}},m={render:()=>e.jsx(t,{}),play:async({canvasElement:n})=>{const a=v(n);await c(a.queryByLabelText("Cc:")).not.toBeInTheDocument(),await h.click(a.getByRole("button",{name:"Cc"})),await c(a.getByLabelText("Cc:")).toBeVisible(),await c(a.queryByLabelText("Bcc:")).not.toBeInTheDocument(),await h.click(a.getByRole("button",{name:"Bcc"})),await c(a.getByLabelText("Bcc:")).toBeVisible()}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  name: "New message — nothing filled in",
  render: () => <Harness />
}`,...l.parameters?.docs?.source}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialTo={[{
    email: "ada@northwind.example",
    displayName: "Ada"
  }]} initialSubject="Re: Q3 planning" />
}`,...d.parameters?.docs?.source}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialTo={[{
    email: "ada@northwind.example",
    displayName: "Ada"
  }]} initialCc={[{
    email: "grace@northwind.example"
  }]} initialBcc={[]} initialSubject="Re: Q3 planning" />
}`,...p.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <Harness collapsed initialTo={[{
    email: "ada@northwind.example",
    displayName: "Ada Lovelace"
  }]} initialCc={[{
    email: "grace@northwind.example"
  }]} initialSubject="Re: Q3 planning" />
}`,...o.parameters?.docs?.source},description:{story:`The software keyboard is up on a phone. The header gives its space to the
writing surface and keeps one line of what is already filled in.`,...o.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  render: () => <Harness collapsed />
}`,...i.parameters?.docs?.source},description:{story:"Collapsed before anything is typed: an ellipsis, not an empty bar.",...i.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <Harness collapsed initialTo={[{
    email: "ada@northwind.example",
    displayName: "Ada Lovelace"
  }]} initialSubject="Re: Q3 planning" />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", {
      name: "Show recipients and subject"
    }));
    await expect(canvas.getByLabelText("To:")).toBeVisible();
  }
}`,...r.parameters?.docs?.source},description:{story:`The collapsed line is the way back. Pressing it puts the recipient rows
back — with the keyboard up it is the only route to Cc, Bcc and the subject,
and a bar that looks pressable and is not reads as a broken app.`,...r.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
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
}`,...m.parameters?.docs?.source}}};const z=["NewMessage","Reply","CcAndBccRevealed","Collapsed","CollapsedAndEmpty","CollapsedExpandsOnPress","RevealingCcLeavesBccOnOffer"];export{p as CcAndBccRevealed,o as Collapsed,i as CollapsedAndEmpty,r as CollapsedExpandsOnPress,l as NewMessage,d as Reply,m as RevealingCcLeavesBccOnOffer,z as __namedExportsOrder,Y as default};
