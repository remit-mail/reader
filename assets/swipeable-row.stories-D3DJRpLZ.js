import{r as p,j as t}from"./iframe-BxLfZl0d.js";import{S as f}from"./swipeable-row-BgWSb5Ct.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./index-7yp0vHVi.js";import"./index-CmfuxwI8.js";import"./avatar-B9NbFnlE.js";import"./message-row-CyiafRov.js";import"./roving-focus-C9a9OTc4.js";import"./app-shell-types-BijkK5CA.js";import"./badge-Bz4-5UiN.js";import"./label-chip-z1uWipku.js";import"./shield-alert-Beo-XT4k.js";import"./createLucideIcon-DDkWk8mg.js";import"./star-BnMPyPKH.js";import"./paperclip-BuRqVWrf.js";import"./check-DP9bkLrx.js";import"./mail-1A9kE0lO.js";import"./mail-open-dSdNCmZv.js";import"./trash-2-DGdeO5MV.js";const b={id:"thread-1",accountId:"account-1",fromName:"Alex Rivera",fromEmail:"alex@example.com",subject:"Q3 planning notes",snippet:"Here are the notes from our planning session earlier today.",timeLabel:"9:42",isRead:!1},v={thread:b,selectionMode:!1,checked:!1,active:!1,onPeek:()=>{},onToggleCheck:()=>{},onLongPress:()=>{},onOpen:()=>{},onAct:()=>{}};function x({children:e}){return t.jsx("div",{className:"max-w-md overflow-hidden rounded-lg border border-line",children:e})}const _={title:"Primitives/SwipeableRow",component:f,parameters:{layout:"padded"},args:v,render:e=>t.jsx(x,{children:t.jsx(f,{...e})})},u={args:{peek:"none"}},m={args:{peek:"leading"}},h={args:{peek:"trailing"}},a={args:{peek:"none",selectionMode:!0,checked:!1}},c={args:{peek:"none",selectionMode:!0,checked:!0}},g={name:"Acting (interactive)",render:()=>{const[e,n]=p.useState(b),[s,o]=p.useState("trailing"),[r,w]=p.useState(!1);return r?t.jsx(x,{children:t.jsx("div",{className:"flex h-16 items-center justify-center text-sm text-fg-muted",children:"Message deleted"})}):t.jsx(x,{children:t.jsx(f,{...v,thread:e,peek:s,onPeek:o,onAct:P=>{if(P==="trailing"){w(!0);return}n(y=>({...y,isRead:!y.isRead})),o("none")}})})}};function k({onLongPress:e,selectionMode:n,checked:s}){return t.jsx(x,{children:t.jsx(f,{...v,peek:"none",selectionMode:n??!1,checked:s??!1,onLongPress:e??(()=>{})})})}const S=e=>e.querySelector("button[data-message-row]"),i={name:"Long press to select (interactive)",render:()=>{const[e,n]=p.useState(!1);return t.jsxs("div",{className:"space-y-2",children:[t.jsx(k,{selectionMode:e,checked:e,onLongPress:()=>n(s=>!s)}),t.jsx("p",{className:"text-xs text-fg-muted",children:e?"In selection mode — long press again to exit.":"Press and hold the row."})]})}},d={name:"Long press with finger drift (interactive)",render:()=>{const[e,n]=p.useState(!1);return t.jsxs("div",{className:"space-y-2",children:[t.jsx(k,{selectionMode:e,checked:e,onLongPress:()=>n(!0)}),t.jsx("p",{"data-testid":"drift-outcome",className:"text-xs text-fg-muted",children:e?"Drifting hold entered selection mode.":"Waiting for the drifting hold…"})]})},play:async({canvasElement:e})=>{const n=S(e);if(!n)return;const s=(o,r,w)=>n.dispatchEvent(new PointerEvent(o,{bubbles:!0,pointerType:"touch",pointerId:1,clientX:r,clientY:w}));s("pointerdown",100,200);for(const[o,r]of[[103,201],[106,203],[109,205],[112,206]])s("pointermove",o,r);await new Promise(o=>setTimeout(o,700)),s("pointerup",112,206)}},l={name:"Touch context menu suppressed",render:()=>t.jsxs("div",{className:"space-y-2",children:[t.jsx(k,{}),t.jsx("p",{"data-testid":"context-menu-outcome",className:"text-xs text-fg-muted",children:"Waiting for a touch press…"})]}),play:async({canvasElement:e})=>{const n=S(e),s=e.querySelector('[data-testid="context-menu-outcome"]');if(!n||!s)return;n.dispatchEvent(new PointerEvent("pointerdown",{bubbles:!0,pointerType:"touch",pointerId:1}));const o=new MouseEvent("contextmenu",{bubbles:!0,cancelable:!0});n.dispatchEvent(o),s.textContent=o.defaultPrevented?"Native context menu suppressed on touch.":"Native context menu allowed."}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  args: {
    peek: "none"
  }
}`,...u.parameters?.docs?.source}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  args: {
    peek: "leading"
  }
}`,...m.parameters?.docs?.source}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  args: {
    peek: "trailing"
  }
}`,...h.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    peek: "none",
    selectionMode: true,
    checked: false
  }
}`,...a.parameters?.docs?.source},description:{story:"In selection mode the leading avatar is REPLACED by a checkbox affordance\n— unchecked below, checked in the next story. `baseArgs` never flips\n`selectionMode`/`checked`, so this row-level toggle had zero coverage.",...a.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: {
    peek: "none",
    selectionMode: true,
    checked: true
  }
}`,...c.parameters?.docs?.source},description:{story:"Selection mode, row checked: the circle fills accent and shows a tick.",...c.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  name: "Acting (interactive)",
  render: () => {
    const [thread, setThread] = useState<ThreadRowData>(sampleThread);
    const [peek, setPeek] = useState<SwipePeek>("trailing");
    const [deleted, setDeleted] = useState(false);
    if (deleted) {
      return <PhoneFrame>
                    <div className="flex h-16 items-center justify-center text-sm text-fg-muted">
                        Message deleted
                    </div>
                </PhoneFrame>;
    }
    return <PhoneFrame>
                <SwipeableRow {...baseArgs} thread={thread} peek={peek} onPeek={setPeek} onAct={side => {
        if (side === "trailing") {
          setDeleted(true);
          return;
        }
        setThread(prev => ({
          ...prev,
          isRead: !prev.isRead
        }));
        setPeek("none");
      }} />
            </PhoneFrame>;
  }
}`,...g.parameters?.docs?.source}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  name: "Long press to select (interactive)",
  render: () => {
    const [selected, setSelected] = useState(false);
    return <div className="space-y-2">
                <GestureRow selectionMode={selected} checked={selected} onLongPress={() => setSelected(v => !v)} />
                <p className="text-xs text-fg-muted">
                    {selected ? "In selection mode — long press again to exit." : "Press and hold the row."}
                </p>
            </div>;
  }
}`,...i.parameters?.docs?.source},description:{story:`The long press is the way into multi-select on touch. Press and hold the row
(mouse hold works too — react-aria fires the long press for both) and it
flips into the selection state the \`SelectionChecked\` story shows: the
leading avatar becomes a filled, ticked checkbox and a tap toggles the row
instead of opening it.`,...i.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  name: "Long press with finger drift (interactive)",
  render: () => {
    const [selected, setSelected] = useState(false);
    return <div className="space-y-2">
                <GestureRow selectionMode={selected} checked={selected} onLongPress={() => setSelected(true)} />
                <p data-testid="drift-outcome" className="text-xs text-fg-muted">
                    {selected ? "Drifting hold entered selection mode." : "Waiting for the drifting hold…"}
                </p>
            </div>;
  },
  play: async ({
    canvasElement
  }) => {
    const row = rowElement(canvasElement);
    if (!row) return;
    const touch = (type: string, clientX: number, clientY: number) => row.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      pointerType: "touch",
      pointerId: 1,
      clientX,
      clientY
    }));
    touch("pointerdown", 100, 200);
    for (const [x, y] of [[103, 201], [106, 203], [109, 205], [112, 206]]) {
      touch("pointermove", x, y);
    }
    await new Promise(resolve => setTimeout(resolve, 700));
    touch("pointerup", 112, 206);
  }
}`,...d.parameters?.docs?.source},description:{story:`The same gesture with a real finger's drift. A hand holding still on glass
wanders several pixels over the 500ms hold — further than the distance at
which the drag starts tracking the row, which is why a hold used to nudge
the row and then do nothing. The swipe only takes the gesture once it has
travelled far enough to commit a peek, so the drifting hold below still ends
in selection mode. The play step drives the press, the drift and the hold.`,...d.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  name: "Touch context menu suppressed",
  render: () => <div className="space-y-2">
            <GestureRow />
            <p data-testid="context-menu-outcome" className="text-xs text-fg-muted">
                Waiting for a touch press…
            </p>
        </div>,
  play: async ({
    canvasElement
  }) => {
    const row = rowElement(canvasElement);
    const outcome = canvasElement.querySelector<HTMLParagraphElement>('[data-testid="context-menu-outcome"]');
    if (!row || !outcome) return;
    row.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      pointerType: "touch",
      pointerId: 1
    }));
    const menu = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true
    });
    row.dispatchEvent(menu);
    outcome.textContent = menu.defaultPrevented ? "Native context menu suppressed on touch." : "Native context menu allowed.";
  }
}`,...l.parameters?.docs?.source},description:{story:`A touch long press over a row normally raises the browser's own context menu,
which collides with the long-press-to-select gesture above. \`useLongPress\`
suppresses that menu when the press came from touch or pen, while leaving a
mouse right-click's menu alone. The play step drives a synthetic touch press
then a contextmenu and writes the outcome below.`,...l.parameters?.docs?.description}}};const z=["Rest","PeekedLeading","PeekedTrailing","SelectionUnchecked","SelectionChecked","Acting","LongPressToSelect","LongPressWithDrift","TouchContextMenuSuppressed"];export{g as Acting,i as LongPressToSelect,d as LongPressWithDrift,m as PeekedLeading,h as PeekedTrailing,u as Rest,c as SelectionChecked,a as SelectionUnchecked,l as TouchContextMenuSuppressed,z as __namedExportsOrder,_ as default};
