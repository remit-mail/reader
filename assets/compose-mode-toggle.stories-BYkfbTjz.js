import{j as s,r as l}from"./iframe-BxLfZl0d.js";import{C as c}from"./compose-mode-toggle-BDvKH0Zt.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./button-y3nctzTP.js";const{expect:n,userEvent:d,within:m}=__STORYBOOK_MODULE_TEST__,w={title:"Mail/ComposeModeToggle",component:c,parameters:{layout:"centered",docs:{description:{component:'The control that swaps the writing surface. It reads "Plain text" in both\nstates — the label names the mode it offers, and `aria-pressed` carries\nwhich one is up, so the control never changes under the finger.'}}}},i=({start:o})=>{const[e,p]=l.useState(o);return s.jsx(c,{mode:e,onToggle:()=>p(e==="plain"?"rich":"plain")})},t={name:"Rich text — plain text on offer",render:()=>s.jsx(i,{start:"rich"})},a={name:"Plain text — the mode is on",render:()=>s.jsx(i,{start:"plain"})},r={render:()=>s.jsx(i,{start:"rich"}),play:async({canvasElement:o})=>{const e=m(o).getByTestId("compose-mode-toggle");await n(e).toHaveAttribute("aria-pressed","false"),await d.click(e),await n(e).toHaveAttribute("aria-pressed","true"),await n(e).toHaveTextContent("Plain text")}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  name: "Rich text — plain text on offer",
  render: () => <Harness start="rich" />
}`,...t.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  name: "Plain text — the mode is on",
  render: () => <Harness start="plain" />
}`,...a.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <Harness start="rich" />,
  play: async ({
    canvasElement
  }) => {
    const toggle = within(canvasElement).getByTestId("compose-mode-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveTextContent("Plain text");
  }
}`,...r.parameters?.docs?.source}}};const f=["RichText","PlainText","PressedStateFollowsTheMode"];export{a as PlainText,r as PressedStateFollowsTheMode,t as RichText,f as __namedExportsOrder,w as default};
