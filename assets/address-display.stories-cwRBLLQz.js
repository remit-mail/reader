import{A as m}from"./address-display-CpfbqH3-.js";import"./iframe-zw88L4Mq.js";import"./preload-helper-PPVm8Dsz.js";import"./chevron-down-D70ORMFZ.js";import"./createLucideIcon-AdIgPHc_.js";import"./chevron-right-CJC1fTbb.js";const g={title:"Mail/AddressList",component:m,parameters:{layout:"padded"}},e=(s,n)=>({displayName:s,normalizedEmail:n}),t={...e("Ada Lovelace","ada@example.com"),flags:{trusted:{value:!0}}},a={name:"From — trusted",args:{label:"From",addresses:[t],showTrustedBadge:!0}},r={args:{label:"To",addresses:[e("Grace Hopper","grace@example.com"),e("Alan Turing","alan@example.com")]}},o={name:"Many recipients (expandable)",args:{label:"To",addresses:[e("Grace Hopper","grace@example.com"),e("Alan Turing","alan@example.com"),e("Katherine Johnson","katherine@example.com"),e("Dorothy Vaughan","dorothy@example.com"),e("Mary Jackson","mary@example.com"),{normalizedEmail:"no-name@example.com"}]}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  name: "From — trusted",
  args: {
    label: "From",
    addresses: [trusted],
    showTrustedBadge: true
  }
}`,...a.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    label: "To",
    addresses: [named("Grace Hopper", "grace@example.com"), named("Alan Turing", "alan@example.com")]
  }
}`,...r.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  name: "Many recipients (expandable)",
  args: {
    label: "To",
    addresses: [named("Grace Hopper", "grace@example.com"), named("Alan Turing", "alan@example.com"), named("Katherine Johnson", "katherine@example.com"), named("Dorothy Vaughan", "dorothy@example.com"), named("Mary Jackson", "mary@example.com"), {
      normalizedEmail: "no-name@example.com"
    }]
  }
}`,...o.parameters?.docs?.source}}};const x=["SingleFromTrusted","FewRecipients","ManyRecipientsCollapsed"];export{r as FewRecipients,o as ManyRecipientsCollapsed,a as SingleFromTrusted,x as __namedExportsOrder,g as default};
