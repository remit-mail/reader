import{j as n,r as l}from"./iframe-fAVmrNjG.js";import{C as i}from"./compose-mode-toggle-CWTFTwpF.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";import"./button-C4vqyepI.js";const{expect:s,userEvent:p,within:m}=__STORYBOOK_MODULE_TEST__,w={title:"Mail/ComposeModeToggle",component:i,parameters:{layout:"centered",docs:{description:{component:'The control that swaps the writing surface. It reads "Plain text" in both\nstates — the label names the mode it offers, and `aria-pressed` carries\nwhich one is up, so the control never changes under the finger.'}}},args:{onToggle:()=>{}}},t={name:"Rich text — plain text on offer",args:{mode:"rich"}},a={name:"Plain text — the mode is on",args:{mode:"plain"}},d=({start:r})=>{const[e,c]=l.useState(r);return n.jsx(i,{mode:e,onToggle:()=>c(e==="plain"?"rich":"plain")})},o={render:()=>n.jsx(d,{start:"rich"}),play:async({canvasElement:r})=>{const e=m(r).getByTestId("compose-mode-toggle");await s(e).toHaveAttribute("aria-pressed","false"),await p.click(e),await s(e).toHaveAttribute("aria-pressed","true"),await s(e).toHaveTextContent("Plain text")}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  name: "Rich text — plain text on offer",
  args: {
    mode: "rich"
  }
}`,...t.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  name: "Plain text — the mode is on",
  args: {
    mode: "plain"
  }
}`,...a.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
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
}`,...o.parameters?.docs?.source}}};const f=["RichText","PlainText","PressedStateFollowsTheMode"];export{a as PlainText,o as PressedStateFollowsTheMode,t as RichText,f as __namedExportsOrder,w as default};
