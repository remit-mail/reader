import{r as g,j as r}from"./iframe-fAVmrNjG.js";import{B as o}from"./brief-sections-CnmQP8EF.js";import{C as f}from"./message-row-Nk_lkf8_.js";import"./preload-helper-PPVm8Dsz.js";import"./roving-focus-BJjVMA6b.js";import"./app-shell-types-DpJ4kEIP.js";import"./brief-section-D4v8zVAb.js";import"./cn-yMAG7bfM.js";import"./chevron-down-CV-Txd5h.js";import"./createLucideIcon-E7hVbHyY.js";import"./filter-sheet-Cns9FlUK.js";import"./row-keyboard-4SpR8O0u.js";import"./badge-CS1LQW7q.js";import"./avatar-CaxZOEiX.js";import"./label-chip-hR8ScyNA.js";import"./shield-alert-C2HtGUTP.js";import"./star-DbXDvn6U.js";import"./paperclip-pIB-M0XR.js";import"./check-D_cIX8lf.js";function b(e){return{id:`n${e}`,accountId:"a1",fromName:`Digest ${e}`,fromEmail:`digest${e}@news.example`,subject:`This week, edition ${e}`,snippet:"Stories you might have missed.",timeLabel:"Thu",isRead:!0,category:"newsletter"}}const x=[{id:"flagged",label:"Flagged",threads:[{id:"f1",accountId:"a1",fromName:"Dana Lopez",fromEmail:"dana@example.com",subject:"Offsite logistics",snippet:"Final headcount for the venue.",timeLabel:"Tue",isRead:!1,starred:!0,category:"personal"}]},{id:"personal",label:"Personal",threads:[{id:"p1",accountId:"a1",fromName:"Priya Nair",fromEmail:"priya@example.com",subject:"Design review tomorrow",snippet:"Can we move it to 2pm? I have a conflict.",timeLabel:"8:15",isRead:!1,category:"personal"}]},{id:"transactional",label:"Transactional",threads:[{id:"x1",accountId:"a1",fromName:"Sam Okafor",fromEmail:"sam@example.com",subject:"Contract signed",snippet:"Attaching the countersigned PDF.",timeLabel:"9:01",isRead:!1,hasAttachment:!0,category:"transactional"}]},{id:"newsletter",label:"Newsletter",threads:Array.from({length:14},(e,n)=>b(n+1))}],P={title:"Screens/Kit/BriefSections",component:o,parameters:{layout:"fullscreen"},args:{sections:x,Row:f,briefCategory:"all",onSelectThread:()=>{},onSelectBriefCategory:()=>{}}},m={render:e=>r.jsx("div",{className:"flex h-screen w-96 flex-col border-r border-line",children:r.jsx(o,{...e})})},p={render:e=>r.jsx("div",{className:"flex h-[844px] w-[390px] flex-col border border-line",children:r.jsx(o,{...e})})},c={args:{briefCategory:"all"},render:e=>r.jsx("div",{className:"flex h-screen w-96 flex-col border-r border-line",children:r.jsx(o,{...e})})},i={args:{briefCategory:"newsletter"},render:e=>r.jsx("div",{className:"flex h-screen w-96 flex-col border-r border-line",children:r.jsx(o,{...e})})},S=[{id:"all",label:"All",active:!0},{id:"a1",label:"work",count:3},{id:"a2",label:"personal",count:8}],l={render:e=>{const[n,u]=g.useState("all"),[h,t]=g.useState("all");return r.jsx("div",{className:"flex h-screen w-96 flex-col border-r border-line",children:r.jsx(o,{...e,briefCategory:h,onSelectBriefCategory:t,sources:S.map(s=>({...s,active:s.id===n})),sourcesNote:"+1 muted",onSelectSource:u,defaultExpanded:!0})})}},d={render:e=>{const[n,u]=g.useState(new Set(["p1","f1"])),h=t=>u(s=>{const a=new Set(s);return a.has(t)?a.delete(t):a.add(t),a});return r.jsx("div",{className:"flex h-screen w-96 flex-col border-r border-line",children:r.jsx(o,{...e,Row:({thread:t,active:s,onClick:a})=>r.jsx(f,{thread:t,active:s,focused:t.id==="p1",selection:{checked:n.has(t.id),onToggle:()=>h(t.id)},onClick:a})})})}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  render: args => <div className="flex h-screen w-96 flex-col border-r border-line">
            <BriefSections {...args} />
        </div>
}`,...m.parameters?.docs?.source}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  render: args => <div className="flex h-[844px] w-[390px] flex-col border border-line">
            <BriefSections {...args} />
        </div>
}`,...p.parameters?.docs?.source}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: {
    briefCategory: "all"
  },
  render: args => <div className="flex h-screen w-96 flex-col border-r border-line">
            <BriefSections {...args} />
        </div>
}`,...c.parameters?.docs?.source},description:{story:`(a) "All" scope: one capped section per category, each with its header. This
is the cross-account aggregate where the section headers earn their keep.`,...c.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    briefCategory: "newsletter"
  },
  render: args => <div className="flex h-screen w-96 flex-col border-r border-line">
            <BriefSections {...args} />
        </div>
}`,...i.parameters?.docs?.source},description:{story:`(b) Single-category filter: narrowed to Newsletter, the list renders FLAT with
NO section header — the header would be redundant once a single category is
selected. This is the behavior the live brief now inherits from the kit.`,...i.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  render: args => {
    const [source, setSource] = useState("all");
    const [category, setCategory] = useState<BriefCategoryFilter>("all");
    return <div className="flex h-screen w-96 flex-col border-r border-line">
                <BriefSections {...args} briefCategory={category} onSelectBriefCategory={setCategory} sources={accountSources.map(s => ({
        ...s,
        active: s.id === source
      }))} sourcesNote="+1 muted" onSelectSource={setSource} defaultExpanded />
            </div>;
  }
}`,...l.parameters?.docs?.source},description:{story:"(c) Account-source filtering (n>1): the cross-account brief exposes an account\npill row above the categories. The row only appears with more than one source.\nSelecting a source is single-select (encoded via each source's `active` flag).",...l.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: args => {
    const [checked, setChecked] = useState<ReadonlySet<string>>(new Set(["p1", "f1"]));
    const toggle = (id: string) => setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);else next.add(id);
      return next;
    });
    return <div className="flex h-screen w-96 flex-col border-r border-line">
                <BriefSections {...args} Row={({
        thread,
        active,
        onClick
      }) => <ComfortableRow thread={thread} active={active} focused={thread.id === "p1"} selection={{
        checked: checked.has(thread.id),
        onToggle: () => toggle(thread.id)
      }} onClick={onClick} />} />
            </div>;
  }
}`,...d.parameters?.docs?.source},description:{story:`(d) Multi-select and the keyboard cursor in the brief. The rows are the same
\`Row\` the mailbox list renders, so a checked row carries the checkbox and the
selected tint, and the keyboard cursor shows its left accent rail on the row
it sits on — one row implementation across the brief, Flagged and the inbox.`,...d.parameters?.docs?.description}}};const _=["Desktop","Mobile","AllScopeWithHeaders","SingleCategoryFlat","AccountSources","Selection"];export{l as AccountSources,c as AllScopeWithHeaders,m as Desktop,p as Mobile,d as Selection,i as SingleCategoryFlat,_ as __namedExportsOrder,P as default};
