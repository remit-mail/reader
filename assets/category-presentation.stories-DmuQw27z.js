import{j as t}from"./iframe-uufGNBEn.js";import{b}from"./filter-presets-CeVCfMxc.js";import{c as x}from"./app-shell-types--0yhHeoL.js";import{B as w}from"./badge-DS2l7jE5.js";import{B as g}from"./brief-section-DvHJzvM1.js";import{F as N}from"./filter-sheet-B1swY7oD.js";import{C as f}from"./message-row-yrY4apdT.js";import"./preload-helper-PPVm8Dsz.js";import"./brief-filters-B8HFYs3o.js";import"./cn-d2XQ1MEC.js";import"./chevron-down-CGnGYV2L.js";import"./createLucideIcon-Bn-Stmx4.js";import"./chevron-right-B0dowht5.js";import"./row-keyboard-4SpR8O0u.js";import"./keymap-dispatch-DTaqnLKC.js";import"./roving-focus-C30yPp50.js";import"./avatar-B5mDLuXx.js";import"./label-chip-ua_lHL4v.js";import"./message-settlement-BieSBZWI.js";import"./cloud-off-CdsVd9RG.js";import"./shield-alert-CwV1s3Qj.js";import"./star-Cwq7Iobx.js";import"./paperclip-BZCOJKRZ.js";import"./check-BSgP79ub.js";const{expect:n,within:l}=__STORYBOOK_MODULE_TEST__,s=[{category:"personal",label:"Personal",tone:"accent",section:1,total:4753},{category:"uncategorized",label:"Unclassified",tone:"neutral",section:7,total:12},{category:"transactional",label:"Transactional",tone:"positive",section:2,total:429},{category:"newsletter",label:"Newsletter",tone:"neutral",section:3,total:2295},{category:"marketing",label:"Marketing",tone:"neutral",section:4,total:3942},{category:"social",label:"Social",tone:"warning",section:5,total:88},{category:"automated",label:"Automated",tone:"neutral",section:6,total:2680}],h=[...s].sort((e,a)=>e.section-a.section),u=e=>`No ${e} mail in this brief.`,v=[{id:"all",label:"All",tone:"neutral"},...s.map(({category:e,label:a,tone:o})=>({id:e,label:a,tone:o}))],C=e=>({id:`row-${e.category}`,accountId:"a1",fromName:`${e.label} sender`,fromEmail:`${e.category}@example.com`,subject:`A ${e.label.toLowerCase()} message`,snippet:"A short preview of the message body.",timeLabel:"9:42",isRead:!0,category:e.category}),S=h.map(e=>({id:e.category,label:e.label,threads:[C(e)]})),B=h.map(e=>({id:e.category,label:e.label,threads:[],total:{kind:"exact",value:e.total}})),Q={title:"Mail/Category presentation",parameters:{layout:"padded"}},c={render:()=>t.jsxs("table",{className:"w-full text-left text-xs text-fg-muted",children:[t.jsx("thead",{children:t.jsxs("tr",{className:"text-2xs uppercase tracking-wider text-fg-subtle",children:[t.jsx("th",{className:"py-1 pr-4 font-semibold",children:"Category"}),t.jsx("th",{className:"py-1 pr-4 font-semibold",children:"Label"}),t.jsx("th",{className:"py-1 pr-4 font-semibold",children:"Tone"}),t.jsx("th",{className:"py-1 pr-4 font-semibold",children:"Chip"}),t.jsx("th",{className:"py-1 pr-4 font-semibold",children:"Section"}),t.jsx("th",{className:"py-1 font-semibold",children:"Emptied by a chip"})]})}),t.jsx("tbody",{className:"divide-y divide-line",children:s.map((e,a)=>t.jsxs("tr",{"data-category":e.category,"data-tone":e.tone,children:[t.jsx("td",{className:"py-1.5 pr-4 font-mono text-fg-subtle",children:e.category}),t.jsx("td",{className:"py-1.5 pr-4",children:t.jsx(w,{tone:e.tone,children:e.label})}),t.jsx("td",{className:"py-1.5 pr-4",children:e.tone}),t.jsx("td",{className:"py-1.5 pr-4 tabular-nums",children:a+2}),t.jsx("td",{className:"py-1.5 pr-4 tabular-nums",children:e.section}),t.jsx("td",{className:"py-1.5",children:u(e.label)})]},e.category))})]}),play:async({canvasElement:e})=>{const a=Array.from(e.querySelectorAll("tbody tr"));await n(a).toHaveLength(s.length);for(const[r,i]of s.entries()){const y=a[r];await n(y).toHaveAttribute("data-category",i.category),await n(y).toHaveAttribute("data-tone",i.tone),await n(l(y).getByText(i.label)).toBeVisible(),await n(l(y).getByText(i.tone)).toBeVisible(),await n(x[i.category]).toBe(i.tone)}const o=s.map(r=>r.label);await n(new Set(o).size).toBe(o.length)}},d={render:()=>t.jsx("div",{className:"h-96 w-96 border border-line",children:t.jsx(N,{categories:v,filters:b().filters,selectedCategory:"all",activeFilters:new Set,expanded:!0,onSelectCategory:()=>{},onToggleFilter:()=>{},onExpandedChange:()=>{},onClear:()=>{}})}),play:async({canvasElement:e})=>{const a=l(e),o=l(a.getByRole("group",{name:"Categories"}));await n(o.getAllByRole("button").map(r=>r.textContent)).toEqual(["All",...s.map(r=>r.label)]),await n(b().categories.map(r=>r.id)).toEqual(["all",...s.map(r=>r.category)])}},p={parameters:{layout:"fullscreen"},render:()=>t.jsx("div",{className:"flex h-screen w-96 flex-col overflow-y-auto border-r border-line",children:S.map(e=>t.jsx(g,{section:e,Row:f,onSelectThread:()=>{}},e.id))}),play:async({canvasElement:e})=>{const a=l(e);await n(a.getAllByRole("button",{expanded:!0}).map(o=>o.textContent)).toEqual(h.map(o=>o.label))}},m={parameters:{layout:"fullscreen"},render:()=>t.jsx("div",{className:"flex h-screen w-96 flex-col overflow-y-auto border-r border-line",children:B.map(e=>t.jsx(g,{section:e,Row:f,onSelectThread:()=>{}},e.id))}),play:async({canvasElement:e})=>{const a=l(e);for(const o of h)await n(a.getByText(u(o.label))).toBeVisible(),await n(a.queryByText(o.total.toLocaleString())).toBeNull()}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  render: () => <table className="w-full text-left text-xs text-fg-muted">
            <thead>
                <tr className="text-2xs uppercase tracking-wider text-fg-subtle">
                    <th className="py-1 pr-4 font-semibold">Category</th>
                    <th className="py-1 pr-4 font-semibold">Label</th>
                    <th className="py-1 pr-4 font-semibold">Tone</th>
                    <th className="py-1 pr-4 font-semibold">Chip</th>
                    <th className="py-1 pr-4 font-semibold">Section</th>
                    <th className="py-1 font-semibold">Emptied by a chip</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-line">
                {CANONICAL.map((entry, index) => <tr key={entry.category} data-category={entry.category} data-tone={entry.tone}>
                        <td className="py-1.5 pr-4 font-mono text-fg-subtle">
                            {entry.category}
                        </td>
                        <td className="py-1.5 pr-4">
                            <Badge tone={entry.tone}>{entry.label}</Badge>
                        </td>
                        <td className="py-1.5 pr-4">{entry.tone}</td>
                        <td className="py-1.5 pr-4 tabular-nums">{index + 2}</td>
                        <td className="py-1.5 pr-4 tabular-nums">{entry.section}</td>
                        <td className="py-1.5">{emptySectionCopy(entry.label)}</td>
                    </tr>)}
            </tbody>
        </table>,
  play: async ({
    canvasElement
  }) => {
    const rows = Array.from(canvasElement.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    await expect(rows).toHaveLength(CANONICAL.length);
    for (const [index, entry] of CANONICAL.entries()) {
      const row = rows[index];
      await expect(row).toHaveAttribute("data-category", entry.category);
      await expect(row).toHaveAttribute("data-tone", entry.tone);
      await expect(within(row).getByText(entry.label)).toBeVisible();
      await expect(within(row).getByText(entry.tone)).toBeVisible();
      await expect(categoryTone[entry.category]).toBe(entry.tone);
    }
    const labels = CANONICAL.map(entry => entry.label);
    await expect(new Set(labels).size).toBe(labels.length);
  }
}`,...c.parameters?.docs?.source},description:{story:`The decision itself, in one place: per category, the label every surface
shows, the tone it carries, where it sits in the chip row and where it sits
in the brief's section order, and what the section says once a chip has left
it with no rows.`,...c.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => <div className="h-96 w-96 border border-line">
            <FilterSheet categories={chipCategories} filters={briefFilterConfig().filters} selectedCategory="all" activeFilters={new Set<string>()} expanded onSelectCategory={() => undefined} onToggleFilter={() => undefined} onExpandedChange={() => undefined} onClear={() => undefined} />
        </div>,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const chips = within(canvas.getByRole("group", {
      name: "Categories"
    }));
    await expect(chips.getAllByRole("button").map(chip => chip.textContent)).toEqual(["All", ...CANONICAL.map(entry => entry.label)]);
    await expect(briefFilterConfig().categories.map(category => category.id)).toEqual(["all", ...CANONICAL.map(entry => entry.category)]);
  }
}`,...d.parameters?.docs?.source},description:{story:`The chip row: All, then the categories in the order the reader meets them.
Every chip carries its category's tone, so the chip and the badge the chip
filters for read alike.`,...d.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  parameters: {
    layout: "fullscreen"
  },
  render: () => <div className="flex h-screen w-96 flex-col overflow-y-auto border-r border-line">
            {orderedSections.map(section => <BriefSection key={section.id} section={section} Row={ComfortableRow} onSelectThread={() => undefined} />)}
        </div>,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("button", {
      expanded: true
    }).map(header => header.textContent)).toEqual(SECTION_ORDER.map(entry => entry.label));
  }
}`,...p.parameters?.docs?.source},description:{story:`The brief's section order, which is not the chip order: Unclassified goes
last, under the mail the classifier did reach.`,...p.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  parameters: {
    layout: "fullscreen"
  },
  render: () => <div className="flex h-screen w-96 flex-col overflow-y-auto border-r border-line">
            {emptiedSections.map(section => <BriefSection key={section.id} section={section} Row={ComfortableRow} onSelectThread={() => undefined} />)}
        </div>,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    for (const entry of SECTION_ORDER) {
      await expect(canvas.getByText(emptySectionCopy(entry.label))).toBeVisible();
      await expect(canvas.queryByText(entry.total.toLocaleString())).toBeNull();
    }
  }
}`,...m.parameters?.docs?.source},description:{story:`Every section the chips emptied. The category holds mail — the totals here
are a real mailbox's — so the section stays rather than vanishing, and says
in its own words that the filter, not the mailbox, is why it is bare. The
number goes: a count above no rows reads as a broken list.`,...m.parameters?.docs?.description}}};const W=["CanonicalTable","ChipRow","SectionOrder","EmptiedByAChip"];export{c as CanonicalTable,d as ChipRow,m as EmptiedByAChip,p as SectionOrder,W as __namedExportsOrder,Q as default};
