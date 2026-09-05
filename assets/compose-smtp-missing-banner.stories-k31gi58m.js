import{C as s}from"./compose-smtp-missing-banner-COvlTvxk.js";import"./iframe-uufGNBEn.js";import"./preload-helper-PPVm8Dsz.js";import"./triangle-alert-BMnL-Txz.js";import"./createLucideIcon-Bn-Stmx4.js";import"./arrow-right-ydrVB1r2.js";const{expect:r,fn:n,userEvent:i,within:c}=__STORYBOOK_MODULE_TEST__,f={title:"Mail/ComposeSmtpMissingBanner",component:s,parameters:{layout:"padded",docs:{description:{component:`The selected account has no SMTP host. Send stays pressable and explains
itself; this says the same thing before the user reaches for it, and carries
the way out rather than leaving them to find Settings.`}}},args:{onConfigure:n().mockName("onConfigure")}},e={},a={args:{onConfigure:n()},play:async({args:t,canvasElement:o})=>{await i.click(c(o).getByRole("button",{name:/Configure SMTP/})),await r(t.onConfigure).toHaveBeenCalled()}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:"{}",...e.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    onConfigure: fn()
  },
  play: async ({
    args,
    canvasElement
  }) => {
    await userEvent.click(within(canvasElement).getByRole("button", {
      name: /Configure SMTP/
    }));
    await expect(args.onConfigure).toHaveBeenCalled();
  }
}`,...a.parameters?.docs?.source}}};const h=["Default","TheWayOutIsReachable"];export{e as Default,a as TheWayOutIsReachable,h as __namedExportsOrder,f as default};
