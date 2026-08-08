import{j as e}from"./iframe-uTafckjr.js";import{c as r}from"./cn-BnS_VibS.js";function i({leading:a,search:t,actions:s,className:n}){return e.jsxs("header",{className:r("flex min-h-pane-header w-full shrink-0 items-center gap-2 border-b border-line bg-canvas px-row-inset py-1",n),children:[a&&e.jsx("div",{className:"flex shrink-0 items-center gap-1",children:a}),e.jsx("div",{className:"flex min-w-0 flex-1 justify-start",children:e.jsx("div",{className:"w-full max-w-xs transition-[max-width] duration-150 ease-out focus-within:max-w-lg",children:t})}),s&&e.jsx("div",{className:"flex shrink-0 items-center gap-1",children:s})]})}i.__docgenInfo={description:`The application top bar: one row across the top of the shell, over the nav,
list, reading and intelligence panes, carrying search and the global actions.

Search sits here rather than over the message list because it is not the
list's search — it reads across the whole app, and the bar's span is what
says so. The search field takes the room it needs, then the global actions.

Presentational and slot-driven; the host supplies the wired field and
action controls.`,methods:[],displayName:"AppTopBar",props:{leading:{required:!1,tsType:{name:"ReactNode"},description:`Controls at the bar's left edge, over the nav column — the nav toggle.
Anything that acts on the shell itself rather than on the mail in it.`},search:{required:!0,tsType:{name:"ReactNode"},description:`The search field. Spans the bar's middle and is the only thing that
grows, so the bar reads as one search surface for the whole app.`},actions:{required:!1,tsType:{name:"ReactNode"},description:`Global actions — compose, feedback, avatar. Actions that belong to the
app rather than to whatever is currently listed or open; message-context
verbs live in the message pane's own toolbar, under this bar.`},className:{required:!1,tsType:{name:"string"},description:""}}};export{i as A};
