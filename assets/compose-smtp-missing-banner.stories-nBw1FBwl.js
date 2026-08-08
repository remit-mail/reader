import{C as o}from"./compose-smtp-missing-banner-BA6xCoxJ.js";import"./iframe-zw88L4Mq.js";import"./preload-helper-PPVm8Dsz.js";import"./triangle-alert-DvQXczKn.js";import"./createLucideIcon-AdIgPHc_.js";import"./arrow-right-C4bXCahH.js";const{expect:s,fn:r,userEvent:i,within:c}=__STORYBOOK_MODULE_TEST__,h={title:"Mail/ComposeSmtpMissingBanner",component:o,parameters:{layout:"padded",docs:{description:{component:`The selected account has no SMTP host. Send stays pressable and explains
itself; this says the same thing before the user reaches for it, and carries
the way out rather than leaving them to find Settings.`}}},args:{onConfigure:()=>{}}},e={},a={args:{onConfigure:r()},play:async({args:n,canvasElement:t})=>{await i.click(c(t).getByRole("button",{name:/Configure SMTP/})),await s(n.onConfigure).toHaveBeenCalled()}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:"{}",...e.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
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
}`,...a.parameters?.docs?.source}}};const f=["Default","TheWayOutIsReachable"];export{e as Default,a as TheWayOutIsReachable,f as __namedExportsOrder,h as default};
