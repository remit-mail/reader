import{r as E,j as g}from"./iframe-fAVmrNjG.js";import{C as x}from"./compose-language-chip-DWloZnix.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";import"./compose-language-CBWlIzAC.js";import"./roving-focus-BJjVMA6b.js";import"./button-C4vqyepI.js";const{expect:a,userEvent:h,within:t}=__STORYBOOK_MODULE_TEST__,v=["nl","en","de"],l="Chrome checks every language you add under Settings, then Languages. Adding one there checks it alongside the others.",m="macOS decides this under Keyboard, then Text Input, then Spelling. Automatic by Language covers every language enabled there.",d="Firefox uses this setting. Right-click the message to add a dictionary for it.",T=({initial:e="nl",helpText:n})=>{const[y,w]=E.useState(e);return g.jsx("div",{className:"flex w-[360px] justify-end rounded-md border border-line bg-canvas p-2",children:g.jsx(x,{language:y,languages:v,onSelect:w,helpText:n})})},S={title:"Mail/ComposeLanguageChip",component:T,parameters:{layout:"centered",docs:{description:{component:`The language control at the right of the compose toolbar. Two letters, the
language in full to a screen reader, and a menu of the account's languages
over one sentence naming the browser setting that actually fixes spelling.

The sentence is the only part of this feature that fixes anything for a
Chrome or Safari user, and it says whose setting it is.`}}}},c={name:"The chip",args:{}},r=async e=>{await h.click(t(e).getByRole("button",{name:/^Message language:/}))},i={name:"Open, on Chrome",args:{helpText:l},play:async({canvasElement:e})=>{await r(e),await a(t(e).getByTestId("compose-language-help")).toHaveTextContent(l)}},p={name:"Open, on Safari",args:{helpText:m},play:async({canvasElement:e})=>{await r(e),await a(t(e).getByTestId("compose-language-help")).toHaveTextContent(m)}},u={name:"Open, on Firefox",args:{helpText:d},play:async({canvasElement:e})=>{await r(e),await a(t(e).getByTestId("compose-language-help")).toHaveTextContent(d)}},s={name:"The current language is checked",args:{initial:"de",helpText:l},play:async({canvasElement:e})=>{await r(e);const n=t(e);await a(n.getByRole("menuitemradio",{name:/Deutsch/})).toHaveAttribute("aria-checked","true"),await a(n.getByRole("menuitemradio",{name:/Nederlands/})).toHaveAttribute("aria-checked","false")}},o={name:"Escape closes and returns focus",args:{helpText:l},play:async({canvasElement:e})=>{await r(e),await h.keyboard("{Escape}"),await a(t(e).queryByTestId("compose-language-menu")).toBeNull();const n=t(e).getByRole("button",{name:/^Message language:/});await a(n).toHaveFocus(),await a(n).toHaveTextContent("NL")}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  name: "The chip",
  args: {}
}`,...c.parameters?.docs?.source}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  name: "Open, on Chrome",
  args: {
    helpText: CHROME_HELP
  },
  play: async ({
    canvasElement
  }) => {
    await openMenu(canvasElement);
    await expect(within(canvasElement).getByTestId("compose-language-help")).toHaveTextContent(CHROME_HELP);
  }
}`,...i.parameters?.docs?.source}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  name: "Open, on Safari",
  args: {
    helpText: SAFARI_HELP
  },
  play: async ({
    canvasElement
  }) => {
    await openMenu(canvasElement);
    await expect(within(canvasElement).getByTestId("compose-language-help")).toHaveTextContent(SAFARI_HELP);
  }
}`,...p.parameters?.docs?.source}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  name: "Open, on Firefox",
  args: {
    helpText: FIREFOX_HELP
  },
  play: async ({
    canvasElement
  }) => {
    await openMenu(canvasElement);
    await expect(within(canvasElement).getByTestId("compose-language-help")).toHaveTextContent(FIREFOX_HELP);
  }
}`,...u.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  name: "The current language is checked",
  args: {
    initial: "de",
    helpText: CHROME_HELP
  },
  play: async ({
    canvasElement
  }) => {
    await openMenu(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("menuitemradio", {
      name: /Deutsch/
    })).toHaveAttribute("aria-checked", "true");
    await expect(canvas.getByRole("menuitemradio", {
      name: /Nederlands/
    })).toHaveAttribute("aria-checked", "false");
  }
}`,...s.parameters?.docs?.source},description:{story:"Each row is a radio: the current language is the checked one, and every row\ncarries its own `lang`, so a screen reader reads `Nederlands` in Dutch rather\nthan sounding it out in the reader's own voice.",...s.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  name: "Escape closes and returns focus",
  args: {
    helpText: CHROME_HELP
  },
  play: async ({
    canvasElement
  }) => {
    await openMenu(canvasElement);
    await userEvent.keyboard("{Escape}");
    await expect(within(canvasElement).queryByTestId("compose-language-menu")).toBeNull();
    const chip = within(canvasElement).getByRole("button", {
      name: /^Message language:/
    });
    await expect(chip).toHaveFocus();
    await expect(chip).toHaveTextContent("NL");
  }
}`,...o.parameters?.docs?.source},description:{story:"Escape leaves without changing anything, and hands focus back to the chip.",...o.parameters?.docs?.description}}};const _=["Closed","MenuOnChrome","MenuOnSafari","MenuOnFirefox","MenuMarksTheCurrentLanguage","EscapeReturnsFocus"];export{c as Closed,o as EscapeReturnsFocus,s as MenuMarksTheCurrentLanguage,i as MenuOnChrome,u as MenuOnFirefox,p as MenuOnSafari,_ as __namedExportsOrder,S as default};
