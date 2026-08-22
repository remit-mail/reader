import{r as T,j as d}from"./iframe-BxLfZl0d.js";import{C}from"./compose-language-chip-qvHTikQz.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./compose-language-B4uv5zOH.js";import"./roving-focus-C9a9OTc4.js";import"./button-y3nctzTP.js";const{expect:n,userEvent:E,within:t}=__STORYBOOK_MODULE_TEST__,f=["nl","en","de"],m="Chrome checks every language you add under Settings, then Languages. Adding one there checks it alongside the others.",y="macOS decides this under Keyboard, then Text Input, then Spelling. Automatic by Language covers every language enabled there.",w="Firefox uses this setting. Right-click the message to add a dictionary for it.",H=({initial:e="nl",source:a="account",helpText:v})=>{const[h,x]=T.useState(e);return d.jsx("div",{className:"flex w-[360px] justify-end rounded-md border border-line bg-canvas p-2",children:d.jsx(C,{language:h,languages:f,source:h===e?a:"manual",onSelect:x,helpText:v})})},R={title:"Mail/ComposeLanguageChip",component:H,parameters:{layout:"centered",docs:{description:{component:`The language control at the right of the compose toolbar. Two letters, the
language in full to a screen reader, and a menu of the account's languages
over one sentence naming the browser setting that actually fixes spelling.

The sentence is the only part of this feature that fixes anything for a
Chrome or Safari user, and it says whose setting it is.`}}}},i={name:"The chip — the account's own language",args:{}},s={name:"Detected — a message in another language",args:{initial:"de",source:"detected"},play:async({canvasElement:e})=>{const a=t(e).getByTestId("compose-language-chip");await n(a).toHaveAttribute("data-language-source","detected"),await n(a.getAttribute("aria-label")).toContain("detected from what you wrote")}},u={name:"Chosen — detection stops for this message",args:{initial:"de",source:"manual"},play:async({canvasElement:e})=>{const a=t(e).getByTestId("compose-language-chip");await n(a).toHaveAttribute("data-language-source","manual"),await n(a.getAttribute("aria-label")).toContain("chosen for this message")}},c=async e=>{await E.click(t(e).getByRole("button",{name:/^Message language:/}))},g={name:"Open, on Chrome",args:{helpText:m},play:async({canvasElement:e})=>{await c(e),await n(t(e).getByTestId("compose-language-help")).toHaveTextContent(m)}},p={name:"Open, on Safari",args:{helpText:y},play:async({canvasElement:e})=>{await c(e),await n(t(e).getByTestId("compose-language-help")).toHaveTextContent(y)}},l={name:"Open, on Firefox",args:{helpText:w},play:async({canvasElement:e})=>{await c(e),await n(t(e).getByTestId("compose-language-help")).toHaveTextContent(w)}},o={name:"The current language is checked",args:{initial:"de",helpText:m},play:async({canvasElement:e})=>{await c(e);const a=t(e);await n(a.getByRole("menuitemradio",{name:/Deutsch/})).toHaveAttribute("aria-checked","true"),await n(a.getByRole("menuitemradio",{name:/Nederlands/})).toHaveAttribute("aria-checked","false")}},r={name:"Escape closes and returns focus",args:{helpText:m},play:async({canvasElement:e})=>{await c(e),await E.keyboard("{Escape}"),await n(t(e).queryByTestId("compose-language-menu")).toBeNull();const a=t(e).getByRole("button",{name:/^Message language:/});await n(a).toHaveFocus(),await n(a).toHaveTextContent("NL")}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  name: "The chip — the account's own language",
  args: {}
}`,...i.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  name: "Detected — a message in another language",
  args: {
    initial: "de",
    source: "detected"
  },
  play: async ({
    canvasElement
  }) => {
    const chip = within(canvasElement).getByTestId("compose-language-chip");
    await expect(chip).toHaveAttribute("data-language-source", "detected");
    await expect(chip.getAttribute("aria-label")).toContain("detected from what you wrote");
  }
}`,...s.parameters?.docs?.source},description:{story:`The control changes under the user while they type, so the value alone does
not say where it came from. The tint marks a message that is not going out in
the account's own language, and the accessible name says whether the tag was
guessed, chosen or inherited.`,...s.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  name: "Chosen — detection stops for this message",
  args: {
    initial: "de",
    source: "manual"
  },
  play: async ({
    canvasElement
  }) => {
    const chip = within(canvasElement).getByTestId("compose-language-chip");
    await expect(chip).toHaveAttribute("data-language-source", "manual");
    await expect(chip.getAttribute("aria-label")).toContain("chosen for this message");
  }
}`,...u.parameters?.docs?.source}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
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
}`,...g.parameters?.docs?.source}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
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
}`,...p.parameters?.docs?.source}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
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
}`,...l.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
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
}`,...o.parameters?.docs?.source},description:{story:"Each row is a radio: the current language is the checked one, and every row\ncarries its own `lang`, so a screen reader reads `Nederlands` in Dutch rather\nthan sounding it out in the reader's own voice.",...o.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
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
}`,...r.parameters?.docs?.source},description:{story:"Escape leaves without changing anything, and hands focus back to the chip.",...r.parameters?.docs?.description}}};const I=["Closed","NotTheAccountLanguage","ChosenByHand","MenuOnChrome","MenuOnSafari","MenuOnFirefox","MenuMarksTheCurrentLanguage","EscapeReturnsFocus"];export{u as ChosenByHand,i as Closed,r as EscapeReturnsFocus,o as MenuMarksTheCurrentLanguage,g as MenuOnChrome,l as MenuOnFirefox,p as MenuOnSafari,s as NotTheAccountLanguage,I as __namedExportsOrder,R as default};
