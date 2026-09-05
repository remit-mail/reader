import{j as e}from"./iframe-uufGNBEn.js";import{c as o}from"./cn-d2XQ1MEC.js";function a({id:t,reason:n,nudged:s,className:i}){return e.jsxs(e.Fragment,{children:[e.jsx("p",{id:t,className:o(i,!s&&"sr-only"),children:n}),e.jsx("span",{role:"status","aria-live":"polite",className:"sr-only",children:s?n:""})]})}a.__docgenInfo={description:`What a dimmed control is still missing (#477 1.7). Nothing disables, so the
reason has to reach the user two ways, and they are not the same element.

The description carries the reason for as long as it applies, so anything
reading the control through the accessibility tree finds it without pressing
anything; the press is what unhides it.

The announcement is a live region that is mounted with the block and empty
until the press, because a live region announces what is written into it and
not what it was already holding. Marking the description live at the moment
it becomes visible announces nothing.`,methods:[],displayName:"BlockedReason",props:{id:{required:!0,tsType:{name:"string"},description:"What `aria-describedby` on the dimmed control points at."},reason:{required:!0,tsType:{name:"string"},description:""},nudged:{required:!1,tsType:{name:"boolean"},description:"The control was pressed while blocked, so the reason comes on screen."},className:{required:!1,tsType:{name:"string"},description:""}}};export{a as B};
