import{j as r}from"./iframe-R-hq3KXP.js";import{g as l}from"./category-presentation-Lb2waRxR.js";import{c as s}from"./cn-d2XQ1MEC.js";const o=({category:n,size:a="sm",className:t})=>{const e=l(n);return e?r.jsx("span",{className:s("inline-flex items-center rounded border border-line bg-surface-sunken/50 font-medium uppercase tracking-wide text-fg-muted shrink-0",a==="sm"&&"px-1.5 py-0 text-2xs leading-4",a==="md"&&"px-2 py-0.5 text-xs",t),"aria-label":`Category: ${e}`,children:e}):null};o.__docgenInfo={description:`Inline category label for non-personal mail. Renders nothing for \`personal\`
or absent values so the existing list-row layout is unaffected for the
common case.

Visual style matches the muted, low-emphasis aesthetic of the surrounding
row chrome — no color tabs, no full-width pill backgrounds.`,methods:[],displayName:"CategoryBadge",props:{category:{required:!0,tsType:{name:"union",raw:"ThreadCategory | undefined",elements:[{name:"union",raw:`| "uncategorized"
| "personal"
| "newsletter"
| "marketing"
| "automated"
| "transactional"
| "social"`,elements:[{name:"literal",value:'"uncategorized"'},{name:"literal",value:'"personal"'},{name:"literal",value:'"newsletter"'},{name:"literal",value:'"marketing"'},{name:"literal",value:'"automated"'},{name:"literal",value:'"transactional"'},{name:"literal",value:'"social"'}]},{name:"undefined"}]},description:""},size:{required:!1,tsType:{name:"union",raw:'"sm" | "md"',elements:[{name:"literal",value:'"sm"'},{name:"literal",value:'"md"'}]},description:"Larger size for the open-message header. List rows use the default.",defaultValue:{value:'"sm"',computed:!1}},className:{required:!1,tsType:{name:"string"},description:""}}};export{o as C};
