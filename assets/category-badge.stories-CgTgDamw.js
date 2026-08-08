import{j as t}from"./iframe-zw88L4Mq.js";import{C as o}from"./category-badge-Cy6vIIMB.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";const g={title:"Mail/CategoryBadge",component:o,parameters:{layout:"centered"}},n=["newsletter","marketing","automated","transactional","social"],e={render:()=>t.jsx("div",{className:"flex flex-wrap items-center gap-2",children:n.map(s=>t.jsx(o,{category:s,size:"md"},s))})},r={args:{category:"personal",size:"md"}},a={args:{category:"newsletter",size:"sm"}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex flex-wrap items-center gap-2">
            {categories.map(category => <CategoryBadge key={category} category={category} size="md" />)}
        </div>
}`,...e.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    category: "personal",
    size: "md"
  }
}`,...r.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    category: "newsletter",
    size: "sm"
  }
}`,...a.parameters?.docs?.source}}};const p=["AllCategories","PersonalRendersNothing","ListRowSize"];export{e as AllCategories,a as ListRowSize,r as PersonalRendersNothing,p as __namedExportsOrder,g as default};
