import{j as t,r as b}from"./iframe-DS5xN_9u.js";import{N as I}from"./nav-link-surface-BEOdS9MA.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";const{expect:a,fireEvent:B,userEvent:m,within:y}=__STORYBOOK_MODULE_TEST__,w=390,H=n=>t.jsx("div",{className:"relative overflow-hidden rounded-lg border border-line",style:{width:w,height:844},children:t.jsx(n,{})}),O={title:"Design System/Primitives/NavLinkSurface",parameters:{layout:"centered"}},f=["nav","row","inline"],h=[{id:"brief",href:"/mail/brief",label:"Daily brief"},{id:"flagged",href:"/mail/flagged",label:"Starred"},{id:"outbox",href:"/mail/outbox",label:"Outbox"}],T="nothing activated";function o({width:n=320,shown:e=f}){const[i,c]=b.useState(T),l=r=>s=>{s.preventDefault(),c(s.metaKey?`${r} with Meta`:r)};return t.jsxs("div",{className:"flex flex-col gap-5 bg-canvas p-4 text-fg",style:{width:n},children:[e.map(r=>t.jsxs("section",{className:"flex flex-col items-start gap-1",children:[t.jsx("h3",{className:"text-2xs uppercase tracking-wider text-fg-subtle",children:r}),h.map((s,k)=>t.jsx(I,{current:k===0?"page":void 0,"data-testid":`link-${r}-${s.id}`,href:s.href,onClick:l(s.label),variant:r,children:r==="row"?t.jsx("span",{className:"flex-1 px-3 py-2",children:s.label}):s.label},s.id))]},r)),t.jsx("p",{className:"text-xs text-fg-muted","data-testid":"last-activation",children:i})]})}const v={render:()=>t.jsx(o,{})},d={parameters:{layout:"centered",viewport:{value:"mobile"}},decorators:[H],render:()=>t.jsx(o,{shown:["nav"],width:w})},p={render:()=>t.jsx(o,{}),play:async({canvasElement:n})=>{const e=y(n);for(const i of f)for(const c of h){const l=e.getByTestId(`link-${i}-${c.id}`);await a(l.tagName).toBe("A"),await a(l).toHaveAttribute("href",c.href)}await a(e.getAllByRole("link")).toHaveLength(f.length*h.length)}},u={render:()=>t.jsx(o,{}),play:async({canvasElement:n})=>{const e=y(n);await a(e.getByTestId("link-nav-brief")).toHaveAttribute("aria-current","page"),await a(e.getByTestId("link-nav-flagged")).not.toHaveAttribute("aria-current"),await m.click(e.getByTestId("link-nav-flagged")),await a(e.getByTestId("link-nav-brief")).toHaveAttribute("aria-current","page"),await a(e.getByTestId("link-nav-flagged")).not.toHaveAttribute("aria-current")}},g={render:()=>t.jsx(o,{}),play:async({canvasElement:n})=>{const e=y(n);await a(e.getByTestId("last-activation")).toHaveTextContent(T),await m.tab(),await a(e.getByTestId("link-nav-brief")).toHaveFocus(),await m.keyboard("{Enter}"),await a(e.getByTestId("last-activation")).toHaveTextContent("Daily brief"),await a(e.getByTestId("link-nav-brief")).toHaveFocus()}},x={render:()=>t.jsx(o,{}),play:async({canvasElement:n})=>{const e=y(n),i=e.getByTestId("link-nav-outbox");await m.click(i),await a(e.getByTestId("last-activation")).toHaveTextContent("Outbox"),B.click(i,{metaKey:!0}),await a(e.getByTestId("last-activation")).toHaveTextContent("Outbox with Meta")}};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  render: () => <NavLinkMatrix />
}`,...v.parameters?.docs?.source}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  parameters: {
    layout: "centered",
    viewport: {
      value: "mobile"
    }
  },
  decorators: [phoneFrame],
  render: () => <NavLinkMatrix shown={["nav"]} width={PHONE_WIDTH} />
}`,...d.parameters?.docs?.source}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  render: () => <NavLinkMatrix />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    for (const variant of variants) {
      for (const destination of destinations) {
        const link = canvas.getByTestId(\`link-\${variant}-\${destination.id}\`);
        await expect(link.tagName).toBe("A");
        await expect(link).toHaveAttribute("href", destination.href);
      }
    }
    await expect(canvas.getAllByRole("link")).toHaveLength(variants.length * destinations.length);
  }
}`,...p.parameters?.docs?.source}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  render: () => <NavLinkMatrix />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("link-nav-brief")).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByTestId("link-nav-flagged")).not.toHaveAttribute("aria-current");
    await userEvent.click(canvas.getByTestId("link-nav-flagged"));
    await expect(canvas.getByTestId("link-nav-brief")).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByTestId("link-nav-flagged")).not.toHaveAttribute("aria-current");
  }
}`,...u.parameters?.docs?.source}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  render: () => <NavLinkMatrix />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("last-activation")).toHaveTextContent(NOTHING_ACTIVATED);
    await userEvent.tab();
    await expect(canvas.getByTestId("link-nav-brief")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByTestId("last-activation")).toHaveTextContent("Daily brief");
    await expect(canvas.getByTestId("link-nav-brief")).toHaveFocus();
  }
}`,...g.parameters?.docs?.source}}};x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  render: () => <NavLinkMatrix />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByTestId("link-nav-outbox");
    await userEvent.click(link);
    await expect(canvas.getByTestId("last-activation")).toHaveTextContent("Outbox");
    fireEvent.click(link, {
      metaKey: true
    });
    await expect(canvas.getByTestId("last-activation")).toHaveTextContent("Outbox with Meta");
  }
}`,...x.parameters?.docs?.source}}};const C=["Variants","Phone","IsARealAnchor","MarksTheCurrentDestination","ActivatesOnTabThenEnter","PassesModifiedClicksThrough"];export{g as ActivatesOnTabThenEnter,p as IsARealAnchor,u as MarksTheCurrentDestination,x as PassesModifiedClicksThrough,d as Phone,v as Variants,C as __namedExportsOrder,O as default};
