import{r as w,j as r}from"./iframe-uufGNBEn.js";import{n as j}from"./brief-filters-B8HFYs3o.js";import{B as R}from"./brief-sections-CdyWQMOv.js";import{C as y}from"./message-row-yrY4apdT.js";import"./preload-helper-PPVm8Dsz.js";import"./roving-focus-C30yPp50.js";import"./app-shell-types--0yhHeoL.js";import"./brief-section-DvHJzvM1.js";import"./cn-d2XQ1MEC.js";import"./chevron-down-CGnGYV2L.js";import"./createLucideIcon-Bn-Stmx4.js";import"./chevron-right-B0dowht5.js";import"./filter-sheet-B1swY7oD.js";import"./row-keyboard-4SpR8O0u.js";import"./badge-DS2l7jE5.js";import"./keymap-dispatch-DTaqnLKC.js";import"./avatar-B5mDLuXx.js";import"./label-chip-ua_lHL4v.js";import"./message-settlement-BieSBZWI.js";import"./cloud-off-CdsVd9RG.js";import"./shield-alert-CwV1s3Qj.js";import"./star-Cwq7Iobx.js";import"./paperclip-BZCOJKRZ.js";import"./check-BSgP79ub.js";function v(e){return{id:`n${e}`,accountId:"a1",fromName:`Digest ${e}`,fromEmail:`digest${e}@news.example`,subject:`This week, edition ${e}`,snippet:"Stories you might have missed.",timeLabel:"Thu",isRead:!0,category:"newsletter"}}const N={id:"newsletter",label:"Newsletter",threads:Array.from({length:14},(e,o)=>v(o+1))},T=[{id:"flagged",label:"Flagged",threads:[{id:"f1",accountId:"a1",fromName:"Dana Lopez",fromEmail:"dana@example.com",subject:"Offsite logistics",snippet:"Final headcount for the venue.",timeLabel:"Tue",isRead:!1,starred:!0,category:"personal"}]},{id:"personal",label:"Personal",threads:[{id:"p1",accountId:"a1",fromName:"Priya Nair",fromEmail:"priya@example.com",subject:"Design review tomorrow",snippet:"Can we move it to 2pm? I have a conflict.",timeLabel:"8:15",isRead:!1,category:"personal"}]},{id:"transactional",label:"Transactional",threads:[{id:"x1",accountId:"a1",fromName:"Sam Okafor",fromEmail:"sam@example.com",subject:"Contract signed",snippet:"Attaching the countersigned PDF.",timeLabel:"9:01",isRead:!1,hasAttachment:!0,category:"transactional"}]},N],C={id:"newsletter",label:"Newsletter",threads:Array.from({length:10},(e,o)=>v(o+1)),total:{kind:"exact",value:2295}},A=[{id:"personal",label:"Personal",threads:[{id:"p1",accountId:"a1",fromName:"Priya Nair",fromEmail:"priya@example.com",subject:"Design review tomorrow",snippet:"Can we move it to 2pm? I have a conflict.",timeLabel:"8:15",isRead:!1,category:"personal"}],total:{kind:"exact",value:4753}},C,{id:"social",label:"Social",threads:[],total:{kind:"exact",value:88},loading:!0},{id:"marketing",label:"Marketing",threads:[],error:!0},{id:"uncategorized",label:"Unclassified",threads:[],total:{kind:"exact",value:12}}];function s({sections:e,briefCategory:o="all",...c}){const[n,t]=w.useState(new Set),[i,a]=w.useState(o);return r.jsx(R,{...c,sections:j(e,i,n),briefCategory:i,onSelectBriefCategory:a,activeFilters:n,onToggleFilter:S=>t(k=>{const f=new Set(k);return f.has(S)?f.delete(S):f.add(S),f}),onClearFilters:()=>{a("all"),t(new Set)}})}const re={title:"Screens/Kit/BriefSections",component:s,parameters:{layout:"fullscreen"},args:{sections:T,Row:y,briefCategory:"all",onSelectThread:()=>{}}},b={render:e=>r.jsx("div",{className:"flex h-screen w-96 flex-col border-r border-line",children:r.jsx(s,{...e})})},x={render:e=>r.jsx("div",{className:"flex h-[844px] w-[390px] flex-col border border-line",children:r.jsx(s,{...e})})},l={args:{briefCategory:"all"},render:e=>r.jsx("div",{className:"flex h-screen w-96 flex-col border-r border-line",children:r.jsx(s,{...e})})},d={args:{sections:[N],briefCategory:"newsletter"},render:e=>r.jsx("div",{className:"flex h-screen w-96 flex-col border-r border-line",children:r.jsx(s,{...e})})},m={args:{sections:A,briefCategory:"all",onShowAllSection:()=>{},onRetrySection:()=>{}},render:e=>r.jsx("div",{className:"flex h-screen w-96 flex-col border-r border-line",children:r.jsx(s,{...e})})},p={args:{sections:[C],briefCategory:"newsletter"},render:e=>r.jsx("div",{className:"flex h-screen w-96 flex-col border-r border-line",children:r.jsx(s,{...e})})},h={args:{sections:[{id:"matches",threads:[{id:"m1",accountId:"a1",fromName:"CI",fromEmail:"ci@build.example",subject:"Your build passed",snippet:"All checks green on main.",timeLabel:"8:02",isRead:!1,category:"automated"},{id:"m2",accountId:"a1",fromName:"Digest",fromEmail:"digest@news.example",subject:"Weekly digest for you",snippet:"Stories you might have missed.",timeLabel:"Mar 4",isRead:!0,category:"newsletter"}]}],briefCategory:"all",flat:!0},render:e=>r.jsx("div",{className:"flex h-screen w-96 flex-col border-r border-line",children:r.jsx(s,{...e})})},B=[{id:"all",label:"All",active:!0},{id:"a1",label:"work",count:3},{id:"a2",label:"personal",count:8}],u={render:e=>{const[o,c]=w.useState("all");return r.jsx("div",{className:"flex h-screen w-96 flex-col border-r border-line",children:r.jsx(s,{...e,sources:B.map(n=>({...n,active:n.id===o})),sourcesNote:"+1 muted",onSelectSource:c,defaultExpanded:!0})})}},g={render:e=>{const[o,c]=w.useState(new Set(["p1","f1"])),n=t=>c(i=>{const a=new Set(i);return a.has(t)?a.delete(t):a.add(t),a});return r.jsx("div",{className:"flex h-screen w-96 flex-col border-r border-line",children:r.jsx(s,{...e,Row:({thread:t,active:i,onClick:a})=>r.jsx(y,{thread:t,active:i,focused:t.id==="p1",selection:{checked:o.has(t.id),onToggle:()=>n(t.id)},onClick:a})})})}};b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  render: args => <div className="flex h-screen w-96 flex-col border-r border-line">
            <BriefHost {...args} />
        </div>
}`,...b.parameters?.docs?.source}}};x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  render: args => <div className="flex h-[844px] w-[390px] flex-col border border-line">
            <BriefHost {...args} />
        </div>
}`,...x.parameters?.docs?.source}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  args: {
    briefCategory: "all"
  },
  render: args => <div className="flex h-screen w-96 flex-col border-r border-line">
            <BriefHost {...args} />
        </div>
}`,...l.parameters?.docs?.source},description:{story:`(a) "All" scope: one capped section per category, each with its header. This
is the cross-account aggregate where the section headers earn their keep.`,...l.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: {
    sections: [newsletterSection],
    briefCategory: "newsletter"
  },
  render: args => <div className="flex h-screen w-96 flex-col border-r border-line">
            <BriefHost {...args} />
        </div>
}`,...d.parameters?.docs?.source},description:{story:`(b) Single-category scope over uncounted sections: narrowed to Newsletter, the
list renders FLAT with NO section header — with nothing but the label to state,
the header only repeats the chip. The scope is one category-scoped request, so
the section handed in is the only one there is.`,...d.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  args: {
    sections: countedSections,
    briefCategory: "all",
    onShowAllSection: () => undefined,
    onRetrySection: () => undefined
  },
  render: args => <div className="flex h-screen w-96 flex-col border-r border-line">
            <BriefHost {...args} />
        </div>
}`,...m.parameters?.docs?.source},description:{story:`(b2) The live brief: each header carries its category's real size, a section
whose rows have not arrived shows the loading treatment under its total, a
section whose own request failed says so and offers its own retry, and a
section a chip emptied says so too. "Show all" hands the reader to that
category's own list rather than fetching more rows here.`,...m.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  args: {
    sections: [countedNewsletter],
    briefCategory: "newsletter"
  },
  render: args => <div className="flex h-screen w-96 flex-col border-r border-line">
            <BriefHost {...args} />
        </div>
}`,...p.parameters?.docs?.source},description:{story:`(b3) The "show all" destination: narrowed to one counted category, the header
stays, because the total is the one thing the chip cannot state.`,...p.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  args: {
    sections: [{
      id: "matches",
      threads: [{
        id: "m1",
        accountId: "a1",
        fromName: "CI",
        fromEmail: "ci@build.example",
        subject: "Your build passed",
        snippet: "All checks green on main.",
        timeLabel: "8:02",
        isRead: false,
        category: "automated"
      }, {
        id: "m2",
        accountId: "a1",
        fromName: "Digest",
        fromEmail: "digest@news.example",
        subject: "Weekly digest for you",
        snippet: "Stories you might have missed.",
        timeLabel: "Mar 4",
        isRead: true,
        category: "newsletter"
      }]
    }],
    briefCategory: "all",
    flat: true
  },
  render: args => <div className="flex h-screen w-96 flex-col border-r border-line">
            <BriefHost {...args} />
        </div>
}`,...h.parameters?.docs?.source},description:{story:`(b4) The brief answering a search: no sections at all, one list in the order
the server returned it. A newsletter from last spring under a header would
outrank a mail from this morning, which is the reading a search must not give.`,...h.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  render: args => {
    const [source, setSource] = useState("all");
    return <div className="flex h-screen w-96 flex-col border-r border-line">
                <BriefHost {...args} sources={accountSources.map(s => ({
        ...s,
        active: s.id === source
      }))} sourcesNote="+1 muted" onSelectSource={setSource} defaultExpanded />
            </div>;
  }
}`,...u.parameters?.docs?.source},description:{story:"(c) Account-source filtering (n>1): the cross-account brief exposes an account\npill row above the categories. The row only appears with more than one source.\nSelecting a source is single-select (encoded via each source's `active` flag).",...u.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  render: args => {
    const [checked, setChecked] = useState<ReadonlySet<string>>(new Set(["p1", "f1"]));
    const toggle = (id: string) => setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);else next.add(id);
      return next;
    });
    return <div className="flex h-screen w-96 flex-col border-r border-line">
                <BriefHost {...args} Row={({
        thread,
        active,
        onClick
      }) => <ComfortableRow thread={thread} active={active} focused={thread.id === "p1"} selection={{
        checked: checked.has(thread.id),
        onToggle: () => toggle(thread.id)
      }} onClick={onClick} />} />
            </div>;
  }
}`,...g.parameters?.docs?.source},description:{story:`(d) Multi-select and the keyboard cursor in the brief. The rows are the same
\`Row\` the mailbox list renders, so a checked row carries the checkbox and the
selected tint, and the keyboard cursor shows its left accent rail on the row
it sits on — one row implementation across the brief, Flagged and the inbox.`,...g.parameters?.docs?.description}}};const te=["Desktop","Mobile","AllScopeWithHeaders","SingleCategoryFlat","ServerTotals","SingleCategoryCounted","Searching","AccountSources","Selection"];export{u as AccountSources,l as AllScopeWithHeaders,b as Desktop,x as Mobile,h as Searching,g as Selection,m as ServerTotals,p as SingleCategoryCounted,d as SingleCategoryFlat,te as __namedExportsOrder,re as default};
