import{j as e,r as u}from"./iframe-R-hq3KXP.js";import{B as d}from"./bottom-sheet-BUTfswhQ.js";import{B as i}from"./button-DALtMcT0.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./overlay-scope-CbgdyXI5.js";import"./keymap-dispatch-DTaqnLKC.js";import"./use-modal-focus-BNTAB0Hf.js";const{expect:a,userEvent:m,within:h}=__STORYBOOK_MODULE_TEST__,E={title:"Components/BottomSheet",component:d,parameters:{layout:"fullscreen"},decorators:[s=>e.jsx("div",{className:"relative mx-auto h-dvh w-full shrink-0 overflow-hidden bg-surface sm:my-6 sm:h-[640px] sm:w-[390px] sm:rounded-[2rem] sm:border sm:border-line sm:shadow-sm",children:e.jsx(s,{})})]};function v(){const[s,t]=u.useState(!0);return e.jsxs("div",{className:"relative h-full overflow-hidden bg-surface",children:[e.jsx("div",{className:"divide-y divide-line opacity-50",children:Array.from({length:9}).map((n,c)=>e.jsxs("div",{className:"flex items-start gap-3 px-row-inset py-2.5",children:[e.jsx("div",{className:"mt-0.5 size-7 shrink-0 rounded-full bg-surface-sunken"}),e.jsxs("div",{className:"min-w-0 flex-1 space-y-1",children:[e.jsx("div",{className:"h-2.5 w-1/3 rounded bg-surface-sunken"}),e.jsx("div",{className:"h-2 w-2/3 rounded bg-surface-sunken"})]})]},c))}),!s&&e.jsx(i,{variant:"primary",onClick:()=>t(!0),className:"absolute inset-x-0 bottom-0 m-3 h-11 font-semibold",children:"Open sheet"}),e.jsx(d,{open:s,onClose:()=>t(!1),label:"Action sheet",children:e.jsxs("div",{className:"px-row-inset py-6",children:[e.jsx("h2",{className:"text-sm font-semibold text-fg",children:"Action sheet"}),e.jsx("p",{className:"mt-1 text-xs text-fg-subtle",children:"Drag the grabber down or tap outside to dismiss."}),e.jsx(i,{variant:"primary",onClick:()=>t(!1),className:"mt-4 h-11 w-full font-semibold",children:"Got it"})]})})]})}const l={render:()=>e.jsx(v,{})},o={render:()=>e.jsx(v,{}),play:async({canvasElement:s})=>{const t=h(s),n=await t.findByRole("dialog");await a(n).toHaveAttribute("aria-modal","true"),await a(n).toHaveAccessibleName("Action sheet"),await a(t.getByRole("button",{name:"Got it"})).toHaveFocus(),await m.keyboard("{Escape}"),await a(t.getByRole("button",{name:"Open sheet"})).toBeVisible(),await a(t.queryByRole("dialog")).toBeNull()}};function x(){const[s,t]=u.useState(!0);return e.jsxs("div",{className:"relative h-full overflow-hidden bg-surface",children:[e.jsx("div",{className:"px-row-inset py-3",children:e.jsx(i,{variant:"secondary",onClick:()=>t(!0),children:"Open sheet"})}),e.jsx(d,{open:s,onClose:()=>t(!1),label:"Action sheet",children:e.jsxs("div",{className:"flex flex-col gap-3 px-row-inset py-6",children:[e.jsx(i,{variant:"secondary",onClick:()=>t(!1),children:"Rename"}),e.jsx(i,{variant:"primary",onClick:()=>t(!1),children:"Got it"})]})})]})}const r={render:()=>e.jsx(x,{}),play:async({canvasElement:s})=>{const t=h(s),n=t.getByRole("button",{name:"Rename"}),c=t.getByRole("button",{name:"Got it"}),p=t.getByRole("button",{name:"Open sheet"});await a(n).toHaveFocus(),await m.tab(),await a(c).toHaveFocus(),await m.tab(),await a(n).toHaveFocus(),await a(p).not.toHaveFocus(),await m.tab({shift:!0}),await a(c).toHaveFocus(),await a(p).not.toHaveFocus()}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  render: () => <Demo />
}`,...l.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
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
}`,...o.parameters?.docs?.source},description:{story:'Same as `Default`, plus the dialog semantics the sheet now carries: a\n`role="dialog"` node opens focused on its first control, and Escape\ndismisses it the same way tapping the scrim does.',...o.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <TrapDemo />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole("button", {
      name: "Rename"
    });
    const last = canvas.getByRole("button", {
      name: "Got it"
    });
    const opener = canvas.getByRole("button", {
      name: "Open sheet"
    });
    await expect(first).toHaveFocus();
    await userEvent.tab();
    await expect(last).toHaveFocus();
    await userEvent.tab();
    await expect(first).toHaveFocus();
    await expect(opener).not.toHaveFocus();
    await userEvent.tab({
      shift: true
    });
    await expect(last).toHaveFocus();
    await expect(opener).not.toHaveFocus();
  }
}`,...r.parameters?.docs?.source},description:{story:`The sheet claims \`aria-modal\`, so the page behind it is hidden from a screen
reader and the keyboard has to agree: Tab off the last control wraps to the
first, Shift+Tab off the first wraps to the last, and neither reaches the
button behind the scrim.`,...r.parameters?.docs?.description}}};const R=["Default","MirrorsDialogSemantics","TrapsTabAtBothEdges"];export{l as Default,o as MirrorsDialogSemantics,r as TrapsTabAtBothEdges,R as __namedExportsOrder,E as default};
