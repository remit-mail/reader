import{j as e,r as d}from"./iframe-uufGNBEn.js";import{B as c}from"./bottom-sheet-BCAOj2Xc.js";import{B as i}from"./button-Wi0n0Lyz.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./overlay-scope-DDGgBdDi.js";import"./keymap-dispatch-DTaqnLKC.js";import"./use-initial-focus-BI_G8RKS.js";const{expect:a,userEvent:p,within:u}=__STORYBOOK_MODULE_TEST__,j={title:"Components/BottomSheet",component:c,parameters:{layout:"fullscreen"},decorators:[t=>e.jsx("div",{className:"relative mx-auto h-dvh w-full shrink-0 overflow-hidden bg-surface sm:my-6 sm:h-[640px] sm:w-[390px] sm:rounded-[2rem] sm:border sm:border-line sm:shadow-sm",children:e.jsx(t,{})})]};function l(){const[t,s]=d.useState(!0);return e.jsxs("div",{className:"relative h-full overflow-hidden bg-surface",children:[e.jsx("div",{className:"divide-y divide-line opacity-50",children:Array.from({length:9}).map((r,m)=>e.jsxs("div",{className:"flex items-start gap-3 px-row-inset py-2.5",children:[e.jsx("div",{className:"mt-0.5 size-7 shrink-0 rounded-full bg-surface-sunken"}),e.jsxs("div",{className:"min-w-0 flex-1 space-y-1",children:[e.jsx("div",{className:"h-2.5 w-1/3 rounded bg-surface-sunken"}),e.jsx("div",{className:"h-2 w-2/3 rounded bg-surface-sunken"})]})]},m))}),!t&&e.jsx(i,{variant:"primary",onClick:()=>s(!0),className:"absolute inset-x-0 bottom-0 m-3 h-11 font-semibold",children:"Open sheet"}),e.jsx(c,{open:t,onClose:()=>s(!1),label:"Action sheet",children:e.jsxs("div",{className:"px-row-inset py-6",children:[e.jsx("h2",{className:"text-sm font-semibold text-fg",children:"Action sheet"}),e.jsx("p",{className:"mt-1 text-xs text-fg-subtle",children:"Drag the grabber down or tap outside to dismiss."}),e.jsx(i,{variant:"primary",onClick:()=>s(!1),className:"mt-4 h-11 w-full font-semibold",children:"Got it"})]})})]})}const n={render:()=>e.jsx(l,{})},o={render:()=>e.jsx(l,{}),play:async({canvasElement:t})=>{const s=u(t),r=await s.findByRole("dialog");await a(r).toHaveAttribute("aria-modal","true"),await a(r).toHaveAccessibleName("Action sheet"),await a(s.getByRole("button",{name:"Got it"})).toHaveFocus(),await p.keyboard("{Escape}"),await a(s.getByRole("button",{name:"Open sheet"})).toBeVisible(),await a(s.queryByRole("dialog")).toBeNull()}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <Demo />
}`,...n.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <Demo />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const sheet = await canvas.findByRole("dialog");
    await expect(sheet).toHaveAttribute("aria-modal", "true");
    await expect(sheet).toHaveAccessibleName("Action sheet");
    await expect(canvas.getByRole("button", {
      name: "Got it"
    })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect(canvas.getByRole("button", {
      name: "Open sheet"
    })).toBeVisible();
    await expect(canvas.queryByRole("dialog")).toBeNull();
  }
}`,...o.parameters?.docs?.source},description:{story:'Same as `Default`, plus the dialog semantics the sheet now carries: a\n`role="dialog"` node opens focused on its first control, and Escape\ndismisses it the same way tapping the scrim does.',...o.parameters?.docs?.description}}};const B=["Default","MirrorsDialogSemantics"];export{n as Default,o as MirrorsDialogSemantics,B as __namedExportsOrder,j as default};
