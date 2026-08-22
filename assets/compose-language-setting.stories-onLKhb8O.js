import{r as m,j as g}from"./iframe-BxLfZl0d.js";import{C as d}from"./compose-language-setting-Be59pwN4.js";import"./preload-helper-PPVm8Dsz.js";import"./compose-language-B4uv5zOH.js";import"./button-y3nctzTP.js";import"./cn-d2XQ1MEC.js";import"./star-BnMPyPKH.js";import"./createLucideIcon-DDkWk8mg.js";import"./x-BYZsfpI2.js";const{expect:s,userEvent:l,within:c}=__STORYBOOK_MODULE_TEST__,u=({initial:e=["nl","en"]})=>{const[a,o]=m.useState(e);return g.jsx("div",{className:"w-[420px] rounded-md border border-line bg-canvas p-4",children:g.jsx(d,{value:a,onChange:o})})},x={title:"Settings/ComposeLanguages",component:u,parameters:{layout:"centered",docs:{description:{component:`The account's writing languages, in settings. One list doing two jobs: the
menu the composer's chip offers, and the set detection chooses inside — which
is what keeps detection accurate on a single sentence.`}}}},r={name:"Two configured languages",args:{}},n={name:"The last language stays",args:{initial:["nl"]},play:async({canvasElement:e})=>{await s(c(e).getByRole("button",{name:"Remove Nederlands"})).toBeDisabled()}},i={name:"Adding one from the list",args:{initial:["nl"]},play:async({canvasElement:e})=>{const a=c(e);await l.selectOptions(a.getByRole("combobox",{name:"Add a language"}),"de"),await s(a.getByTestId("compose-language-row-de")).toBeVisible(),await s(a.getByRole("button",{name:"Remove Nederlands"})).toBeEnabled()}},t={name:"Promoting a language to the default",args:{initial:["nl","en","de"]},play:async({canvasElement:e})=>{const a=c(e);await l.click(a.getByRole("button",{name:"Write new messages in English by default"}));const o=e.querySelectorAll("[data-testid^=compose-language-row-]");await s(o[0]).toHaveAttribute("data-testid","compose-language-row-en"),await s(o[0]).toHaveTextContent("Default")}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  name: "Two configured languages",
  args: {}
}`,...r.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "The last language stays",
  args: {
    initial: ["nl"]
  },
  play: async ({
    canvasElement
  }) => {
    await expect(within(canvasElement).getByRole("button", {
      name: "Remove Nederlands"
    })).toBeDisabled();
  }
}`,...n.parameters?.docs?.source},description:{story:"The last language cannot be removed: an empty list is a chip with no menu.",...n.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  name: "Adding one from the list",
  args: {
    initial: ["nl"]
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(canvas.getByRole("combobox", {
      name: "Add a language"
    }), "de");
    await expect(canvas.getByTestId("compose-language-row-de")).toBeVisible();
    await expect(canvas.getByRole("button", {
      name: "Remove Nederlands"
    })).toBeEnabled();
  }
}`,...i.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  name: "Promoting a language to the default",
  args: {
    initial: ["nl", "en", "de"]
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", {
      name: "Write new messages in English by default"
    }));
    const rows = canvasElement.querySelectorAll("[data-testid^=compose-language-row-]");
    await expect(rows[0]).toHaveAttribute("data-testid", "compose-language-row-en");
    await expect(rows[0]).toHaveTextContent("Default");
  }
}`,...t.parameters?.docs?.source},description:{story:"The first entry is what a new message opens on, and it can be moved.",...t.parameters?.docs?.description}}};const T=["TwoLanguages","OneLanguageCannotBeEmptied","AddingALanguage","ChangingTheDefault"];export{i as AddingALanguage,t as ChangingTheDefault,n as OneLanguageCannotBeEmptied,r as TwoLanguages,T as __namedExportsOrder,x as default};
