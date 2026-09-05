import{j as i,r as w}from"./iframe-uufGNBEn.js";import{C as l}from"./calendar-list-Ci3Pnyxg.js";import"./preload-helper-PPVm8Dsz.js";import"./calendar-color-CqvBY603.js";import"./cn-d2XQ1MEC.js";import"./chevron-down-CGnGYV2L.js";import"./createLucideIcon-Bn-Stmx4.js";import"./chevron-right-B0dowht5.js";import"./check-BSgP79ub.js";const{expect:r,userEvent:x,within:v}=__STORYBOOK_MODULE_TEST__,I={title:"Calendar/Calendar list",component:l,parameters:{layout:"padded",docs:{description:{component:`The legend and the filter are the same control, and it never leaves the
screen. Hiding it in a popover would mean reading a coloured grid with the
key in another room.`}}},decorators:[t=>i.jsx("div",{className:"max-w-60 rounded-lg border border-line bg-surface py-2",children:i.jsx(t,{})})]},o=[{id:"c1",accountId:"a1",accountLabel:"Work",name:"Northwind",color:"cal-1"},{id:"c2",accountId:"a1",accountLabel:"Work",name:"On-call",color:"cal-4"},{id:"c3",accountId:"a2",accountLabel:"Personal",name:"Personal",color:"cal-2"},{id:"c4",accountId:"a2",accountLabel:"Personal",name:"Family",color:"cal-3"},{id:"c5",accountId:"a2",accountLabel:"Personal",name:"Travel",color:"cal-6"},{id:"c6",accountId:"a3",accountLabel:"Synthwave Forum",name:"Synth meetups",color:"cal-5"}],d={render:()=>{const[t,n]=w.useState(new Set(o.map(e=>e.id).filter(e=>e!=="c2")));return i.jsx(l,{calendars:o,visible:t,onToggle:e=>n(c=>{const a=new Set(c);return a.delete(e)||a.add(e),a}),onToggleAccount:(e,c)=>n(a=>{const s=new Set(a);for(const g of o)g.accountId===e&&(c?s.add(g.id):s.delete(g.id));return s})})}},p={render:()=>i.jsx(l,{calendars:o,visible:new Set(o.map(t=>t.id)),onToggle:()=>{},onToggleAccount:()=>{},closedAccountIds:["a2"]})},u={render:()=>i.jsx(l,{calendars:o,visible:new Set,onToggle:()=>{}}),play:async({canvasElement:t})=>{const n=v(t);for(const e of n.getAllByRole("checkbox"))await r(e).not.toBeChecked();await r(n.getByText("Travel")).toBeVisible()}},m={render:()=>{const t=o.slice(0,1),[n,e]=w.useState(new Set([t[0].id]));return i.jsx(l,{calendars:t,visible:n,onToggle:c=>e(a=>{const s=new Set(a);return s.delete(c)||s.add(c),s})})},play:async({canvasElement:t})=>{const n=v(t),e=n.getByRole("checkbox",{name:"Northwind"});await r(e).toBeChecked(),await x.click(n.getByText("Northwind")),await r(e).not.toBeChecked()}},h={render:()=>{const[t,n]=w.useState(new Set(o.map(e=>e.id)));return i.jsx(l,{calendars:o,layout:"strip",touch:!0,visible:t,onToggle:e=>n(c=>{const a=new Set(c);return a.delete(e)||a.add(e),a})})},play:async({canvasElement:t})=>{const n=v(t);await r(n.getAllByRole("checkbox")).toHaveLength(o.length);const e=n.getByRole("checkbox",{name:"On-call"});await x.click(n.getByText("On-call")),await r(e).not.toBeChecked(),await r(n.getByRole("checkbox",{name:"Northwind"})).toBeChecked()}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [visible, setVisible] = useState(new Set(calendars.map(c => c.id).filter(id => id !== "c2")));
    return <CalendarList calendars={calendars} visible={visible} onToggle={id => setVisible(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    })} onToggleAccount={(accountId, nextVisible) => setVisible(prev => {
      const next = new Set(prev);
      for (const calendar of calendars) {
        if (calendar.accountId !== accountId) continue;
        if (nextVisible) next.add(calendar.id);else next.delete(calendar.id);
      }
      return next;
    })} />;
  }
}`,...d.parameters?.docs?.source},description:{story:"Ticking a calendar off is a first-class move, so it takes one click.",...d.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  render: () => <CalendarList calendars={calendars} visible={new Set(calendars.map(c => c.id))} onToggle={() => {}} onToggleAccount={() => {}} closedAccountIds={["a2"]} />
}`,...p.parameters?.docs?.source},description:{story:`An account folded shut. Its calendars are still on the grid — the caret hides
rows, the tick hides events, and the two are not the same thing.`,...p.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  render: () => <CalendarList calendars={calendars} visible={new Set()} onToggle={() => {}} />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    for (const box of canvas.getAllByRole("checkbox")) {
      await expect(box).not.toBeChecked();
    }
    await expect(canvas.getByText("Travel")).toBeVisible();
  }
}`,...u.parameters?.docs?.source},description:{story:"Everything off: an unticked calendar keeps its swatch outline, so the key survives.",...u.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  render: () => {
    const only = calendars.slice(0, 1);
    const [visible, setVisible] = useState(new Set([only[0].id]));
    return <CalendarList calendars={only} visible={visible} onToggle={id => setVisible(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    })} />;
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const northwind = canvas.getByRole("checkbox", {
      name: "Northwind"
    });
    await expect(northwind).toBeChecked();
    await userEvent.click(canvas.getByText("Northwind"));
    await expect(northwind).not.toBeChecked();
  }
}`,...m.parameters?.docs?.source},description:{story:`One account with one calendar in it, which is what a new install looks like.
The control is still the legend, so it stays on screen: a grid whose single
colour is unexplained is no more readable than one with six.`,...m.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [visible, setVisible] = useState(new Set(calendars.map(c => c.id)));
    return <CalendarList calendars={calendars} layout="strip" touch visible={visible} onToggle={id => setVisible(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    })} />;
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("checkbox")).toHaveLength(calendars.length);
    const onCall = canvas.getByRole("checkbox", {
      name: "On-call"
    });
    await userEvent.click(canvas.getByText("On-call"));
    await expect(onCall).not.toBeChecked();
    await expect(canvas.getByRole("checkbox", {
      name: "Northwind"
    })).toBeChecked();
  }
}`,...h.parameters?.docs?.source},description:{story:`The same control on a surface with no room for a rail: a scrolling row of
chips at thumb size. It is laid out differently and it is not a popover —
turning a calendar off stays one press away from the grid.`,...h.parameters?.docs?.description}}};const E=["Interactive","AccountFolded","AllHidden","SingleCalendar","AsAStrip"];export{p as AccountFolded,u as AllHidden,h as AsAStrip,d as Interactive,m as SingleCalendar,E as __namedExportsOrder,I as default};
