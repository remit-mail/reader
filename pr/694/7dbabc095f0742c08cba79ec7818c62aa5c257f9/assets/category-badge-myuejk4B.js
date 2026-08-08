import{j as r}from"./iframe-uTafckjr.js";import{c as s}from"./cn-BnS_VibS.js";const l={uncategorized:"unclassified",newsletter:"newsletter",marketing:"marketing",automated:"notification",transactional:"receipt",social:"social"},i=e=>!e||e==="personal"?null:l[e],o=({category:e,size:n="sm",className:t})=>{const a=i(e);return a?r.jsx("span",{className:s("inline-flex items-center rounded border border-line bg-surface-sunken/50 font-medium uppercase tracking-wide text-fg-muted shrink-0",n==="sm"&&"px-1.5 py-0 text-2xs leading-4",n==="md"&&"px-2 py-0.5 text-xs",t),"aria-label":`Category: ${a}`,children:a}):null};o.__docgenInfo={description:`Inline category label for non-personal mail. Renders nothing for \`personal\`
or absent values so the existing list-row layout is unaffected for the
common case.

Visual style matches the muted, low-emphasis aesthetic of the surrounding
row chrome — no color tabs, no full-width pill backgrounds.`,methods:[],displayName:"CategoryBadge",props:{category:{required:!0,tsType:{name:"union",raw:"MessageCategory | undefined",elements:[{name:"union",raw:`| "uncategorized"
| "personal"
| "newsletter"
| "marketing"
| "automated"
| "transactional"
| "social"`,elements:[{name:"literal",value:'"uncategorized"'},{name:"literal",value:'"personal"'},{name:"literal",value:'"newsletter"'},{name:"literal",value:'"marketing"'},{name:"literal",value:'"automated"'},{name:"literal",value:'"transactional"'},{name:"literal",value:'"social"'}]},{name:"undefined"}]},description:""},size:{required:!1,tsType:{name:"union",raw:'"sm" | "md"',elements:[{name:"literal",value:'"sm"'},{name:"literal",value:'"md"'}]},description:"Larger size for the open-message header. List rows use the default.",defaultValue:{value:'"sm"',computed:!1}},className:{required:!1,tsType:{name:"string"},description:""}}};export{o as C};
