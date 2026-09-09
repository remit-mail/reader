import{j as r,r as x}from"./iframe-R-hq3KXP.js";import{C as l}from"./calendar-list-DyQDqzLH.js";import"./preload-helper-PPVm8Dsz.js";import"./calendar-color-CqvBY603.js";import"./cn-d2XQ1MEC.js";import"./account-service-status-DghfJ5l6.js";import"./badge-WI2U-Zts.js";import"./banner-BhQiwCh2.js";import"./button-DALtMcT0.js";import"./x-Czc64qis.js";import"./createLucideIcon-BDKPi14T.js";import"./chevron-down-kBBsVNj9.js";import"./chevron-right-C43QkeWJ.js";import"./check-DRXPT3gO.js";const{expect:c,userEvent:y,within:w}=__STORYBOOK_MODULE_TEST__,O={title:"Calendar/Calendar list",component:l,parameters:{layout:"padded",docs:{description:{component:`The legend and the filter are the same control, and it never leaves the
screen. Hiding it in a popover would mean reading a coloured grid with the
key in another room.`}}},decorators:[t=>r.jsx("div",{className:"max-w-60 rounded-lg border border-line bg-surface py-2",children:r.jsx(t,{})})]},a=[{id:"c1",accountId:"a1",accountLabel:"Work",name:"Northwind",color:"cal-1"},{id:"c2",accountId:"a1",accountLabel:"Work",name:"On-call",color:"cal-4"},{id:"c3",accountId:"a2",accountLabel:"Personal",name:"Personal",color:"cal-2"},{id:"c4",accountId:"a2",accountLabel:"Personal",name:"Family",color:"cal-3"},{id:"c5",accountId:"a2",accountLabel:"Personal",name:"Travel",color:"cal-6"},{id:"c6",accountId:"a3",accountLabel:"Synthwave Forum",name:"Synth meetups",color:"cal-5"}],d={render:()=>{const[t,e]=x.useState(new Set(a.map(n=>n.id).filter(n=>n!=="c2")));return r.jsx(l,{calendars:a,visible:t,onToggle:n=>e(s=>{const o=new Set(s);return o.delete(n)||o.add(n),o}),onToggleAccount:(n,s)=>e(o=>{const i=new Set(o);for(const v of a)v.accountId===n&&(s?i.add(v.id):i.delete(v.id));return i})})}},p={render:()=>r.jsx(l,{calendars:a,visible:new Set(a.map(t=>t.id)),onToggle:()=>{},onToggleAccount:()=>{},closedAccountIds:["a2"]})},u={render:()=>r.jsx(l,{calendars:a,visible:new Set,onToggle:()=>{}}),play:async({canvasElement:t})=>{const e=w(t);for(const n of e.getAllByRole("checkbox"))await c(n).not.toBeChecked();await c(e.getByText("Travel")).toBeVisible()}},m={render:()=>{const t=a.slice(0,1),[e,n]=x.useState(new Set([t[0].id]));return r.jsx(l,{calendars:t,visible:e,onToggle:s=>n(o=>{const i=new Set(o);return i.delete(s)||i.add(s),i})})},play:async({canvasElement:t})=>{const e=w(t),n=e.getByRole("checkbox",{name:"Northwind"});await c(n).toBeChecked(),await y.click(e.getByText("Northwind")),await c(n).not.toBeChecked()}},h={render:()=>{const t=a.map(e=>e.id==="c1"?{...e,sync:"paused"}:e);return r.jsx(l,{calendars:t,visible:new Set(a.map(e=>e.id)),onToggle:()=>{},onToggleAccount:()=>{}})},play:async({canvasElement:t})=>{const e=w(t);await c(e.getByRole("checkbox",{name:"Northwind"})).toBeChecked(),await c(e.getByText("Northwind: calendar sync off")).toBeInTheDocument()}},g={render:()=>{const[t,e]=x.useState(new Set(a.map(n=>n.id)));return r.jsx(l,{calendars:a,layout:"strip",touch:!0,visible:t,onToggle:n=>e(s=>{const o=new Set(s);return o.delete(n)||o.add(n),o})})},play:async({canvasElement:t})=>{const e=w(t);await c(e.getAllByRole("checkbox")).toHaveLength(a.length);const n=e.getByRole("checkbox",{name:"On-call"});await y.click(e.getByText("On-call")),await c(n).not.toBeChecked(),await c(e.getByRole("checkbox",{name:"Northwind"})).toBeChecked()}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
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
    const paused = calendars.map(calendar => calendar.id === "c1" ? {
      ...calendar,
      sync: "paused" as const
    } : calendar);
    return <CalendarList calendars={paused} visible={new Set(calendars.map(c => c.id))} onToggle={() => {}} onToggleAccount={() => {}} />;
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("checkbox", {
      name: "Northwind"
    })).toBeChecked();
    await expect(canvas.getByText("Northwind: calendar sync off")).toBeInTheDocument();
  }
}`,...h.parameters?.docs?.source},description:{story:`A paused provider calendar. Sync stopped; the calendar is still listed, still
coloured and still tickable, so the pause icon is decoration and the words
that carry it sit beside the row rather than inside the tick's name.`,...h.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
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
}`,...g.parameters?.docs?.source},description:{story:`The same control on a surface with no room for a rail: a scrolling row of
chips at thumb size. It is laid out differently and it is not a popover —
turning a calendar off stays one press away from the grid.`,...g.parameters?.docs?.description}}};const j=["Interactive","AccountFolded","AllHidden","SingleCalendar","Paused","AsAStrip"];export{p as AccountFolded,u as AllHidden,g as AsAStrip,d as Interactive,h as Paused,m as SingleCalendar,j as __namedExportsOrder,O as default};
