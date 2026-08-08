import{j as e}from"./iframe-uTafckjr.js";const d={new:"New Message",reply:"Reply"};function n({banner:t,header:s,children:r,quoted:o,actionBar:a}){return e.jsxs("div",{className:"flex h-full min-h-0 flex-col",children:[t,s,e.jsxs("div",{className:"flex min-h-0 flex-1 flex-col overflow-auto","data-testid":"compose-body-area",children:[r,o&&e.jsx("div",{className:"shrink-0 px-3 pb-2",children:o})]}),a]})}n.__docgenInfo={description:`Presentational compose layout: banner / header / scrollable body+quote /
pinned action bar. Owns the column structure so the action bar always sits
at the bottom and never clips below the fold. The live form composes this
with its provider-driven slots; stories render it with static slots.

The body region is a column so the editor can claim the space the quote and
the action bar leave — a body slot shorter than the region would otherwise
leave dead, unclickable canvas under it.`,methods:[],displayName:"ComposeFormShell",props:{banner:{required:!1,tsType:{name:"ReactNode"},description:"Optional banner above the header (e.g. SMTP-missing notice)."},header:{required:!0,tsType:{name:"ReactNode"},description:"Recipient / subject header region."},children:{required:!0,tsType:{name:"ReactNode"},description:"The editor body."},quoted:{required:!1,tsType:{name:"ReactNode"},description:"Quoted reply / forwarded content under the body."},actionBar:{required:!0,tsType:{name:"ReactNode"},description:"The ComposeActionBar."}}};export{n as C,d as c};
