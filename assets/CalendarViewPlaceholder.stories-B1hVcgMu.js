import{j as r}from"./iframe-uufGNBEn.js";import{C as s}from"./CalendarViewPlaceholder-ulc4EhI6.js";import"./preload-helper-PPVm8Dsz.js";import"./createLucideIcon-Bn-Stmx4.js";const{expect:o,within:i}=__STORYBOOK_MODULE_TEST__,m={title:"App/Calendar/Not built yet",component:s,parameters:{layout:"fullscreen",docs:{description:{component:`A zoom the ladder offers and does not draw yet.

The route is addressable at all five zooms, so two of them land on this. What
it has to do is say which of the two things it is: a view that rendered
nothing would be indistinguishable from a month with nothing booked in it,
and the reader would plan around an empty screen.`}}},render:e=>r.jsx("div",{className:"h-dvh bg-canvas",children:r.jsx(s,{...e})})},a={args:{view:"year"},play:async({canvasElement:e})=>{const t=i(e);await o(t.getByTestId("calendar-placeholder-year")).toHaveTextContent("The year grid arrives with the rest of the zoom ladder."),await o(t.getByText("Not built yet")).toBeVisible(),await o(t.getByText(/Week, Day and Agenda work now\./)).toBeVisible()}},n={args:{view:"month"},play:async({canvasElement:e})=>{const t=i(e);await o(t.getByTestId("calendar-placeholder-month")).toHaveTextContent("The month grid arrives with the rest of the zoom ladder.")}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    view: "year"
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("calendar-placeholder-year")).toHaveTextContent("The year grid arrives with the rest of the zoom ladder.");
    await expect(canvas.getByText("Not built yet")).toBeVisible();
    await expect(canvas.getByText(/Week, Day and Agenda work now\\./)).toBeVisible();
  }
}`,...a.parameters?.docs?.source},description:{story:"It names the zoom it is waiting on, and the three that work today.",...a.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    view: "month"
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("calendar-placeholder-month")).toHaveTextContent("The month grid arrives with the rest of the zoom ladder.");
  }
}`,...n.parameters?.docs?.source}}};const p=["Year","Month"];export{n as Month,a as Year,p as __namedExportsOrder,m as default};
