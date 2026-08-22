import{j as s}from"./iframe-BxLfZl0d.js";import{c as o}from"./cn-d2XQ1MEC.js";const i=({label:e,onDismiss:a,className:t})=>s.jsx("button",{type:"button","aria-label":e,tabIndex:-1,onClick:a,className:o("absolute inset-0 bg-canvas/80",t)});i.__docgenInfo={description:`The scrim behind a modal and the click-to-dismiss on it, in the shape
\`BottomSheet\` already uses: a real button rather than a click handler on a
div, out of the tab order because Escape and the dialog's own Close are the
keyboard's way out. It sits as a sibling of the dialog card, never its
ancestor, so a click on the card is not a click on the scrim and nothing has
to stop propagation to survive.`,methods:[],displayName:"DialogBackdrop",props:{label:{required:!0,tsType:{name:"string"},description:'Names the dismissal to assistive technology, e.g. `"Close"`.'},onDismiss:{required:!0,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:""},className:{required:!1,tsType:{name:"string"},description:""}}};export{i as D};
