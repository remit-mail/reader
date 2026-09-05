import{j as t}from"./iframe-uufGNBEn.js";import"./preload-helper-PPVm8Dsz.js";function m(e){try{return new Date(e).toLocaleString(void 0,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}catch{return e}}function n({sha:e="abcdef1",commitUrl:i,buildTime:o=new Date().toISOString()}){return t.jsxs("p",{className:"text-xs text-fg-subtle",children:["Version"," ",i?t.jsx("a",{href:i,target:"_blank",rel:"noopener noreferrer",className:"font-mono hover:text-fg-muted hover:underline",children:e}):t.jsx("span",{className:"font-mono",children:e})," · ",t.jsxs("span",{children:["Built ",m(o)]})]})}const l={title:"Components/AppVersion",component:n,parameters:{layout:"padded"},argTypes:{sha:{control:"text"},commitUrl:{control:"text"},buildTime:{control:"text"}}},r={args:{sha:"a1b2c3d",commitUrl:"https://github.com/remit-mail/reader/commit/a1b2c3d4e5f6",buildTime:"2024-06-12T10:30:00.000Z"}},s={args:{sha:"dev",commitUrl:void 0,buildTime:new Date().toISOString()}},a={render:e=>t.jsxs("div",{className:"border-t border-line pt-4 mt-4 max-w-sm",children:[t.jsx("p",{className:"text-sm font-medium text-fg mb-1",children:"About"}),t.jsx(n,{...e})]}),args:{sha:"a1b2c3d",commitUrl:"https://github.com/remit-mail/reader/commit/a1b2c3d4e5f6",buildTime:"2024-06-12T10:30:00.000Z"}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    sha: "a1b2c3d",
    commitUrl: "https://github.com/remit-mail/reader/commit/a1b2c3d4e5f6",
    buildTime: "2024-06-12T10:30:00.000Z"
  }
}`,...r.parameters?.docs?.source},description:{story:"Default: shows the short SHA as a link plus a human-readable build time.",...r.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    sha: "dev",
    commitUrl: undefined,
    buildTime: new Date().toISOString()
  }
}`,...s.parameters?.docs?.source},description:{story:'Dev build: SHA is "dev" and there is no commit URL, so the version renders\nunlinked rather than as a dead `/commit/dev` link.',...s.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: args => <div className="border-t border-line pt-4 mt-4 max-w-sm">
            <p className="text-sm font-medium text-fg mb-1">About</p>
            <AppVersion {...args} />
        </div>,
  args: {
    sha: "a1b2c3d",
    commitUrl: "https://github.com/remit-mail/reader/commit/a1b2c3d4e5f6",
    buildTime: "2024-06-12T10:30:00.000Z"
  }
}`,...a.parameters?.docs?.source},description:{story:"As rendered inside Settings › Advanced — padded section with heading.",...a.parameters?.docs?.description}}};const u=["Default","DevBuild","InSettingsAboutSection"];export{r as Default,s as DevBuild,a as InSettingsAboutSection,u as __namedExportsOrder,l as default};
