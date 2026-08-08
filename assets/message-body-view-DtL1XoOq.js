import{r as u,j as s}from"./iframe-zw88L4Mq.js";import{c as h}from"./cn-yMAG7bfM.js";import{p as w}from"./purify.es-2FREwzWT.js";import{I as p}from"./isolated-email-frame-UJHBshTb.js";const y=(t,a)=>{const e=t==="newsletter"||t==="marketing"||a;return{framed:e,isPlain:!e}},x=()=>`
/* Zero the UA default body margin and clamp the document to the iframe width so
   wide author markup can't push the body (and the page) past the viewport. */
html, body {
  margin: 0;
  padding: 0;
  max-width: 100%;
}
body {
  overflow-wrap: anywhere;
  word-break: break-word;
}
/* Media never wider than the frame; keep aspect ratio when width is capped. */
img, video, iframe, svg, canvas {
  max-width: 100% !important;
  height: auto;
}
/* Fixed-width author tables (\`<table width="600">\`) collapse to fit. */
table {
  max-width: 100% !important;
  table-layout: auto;
}
/* Cells carry the fixed widths in real newsletters (\`<td width="600">\`);
   cap them too or the table can't actually shrink. */
td, th {
  max-width: 100% !important;
}
/* \`max-width\` alone can't beat an inline \`min-width\`; zeroing the min lets
   flex / grid / table children actually collapse to the clamped width. */
* {
  min-width: 0;
}
/* Long unbroken strings (URLs, tokens) wrap instead of forcing a wide line. */
pre, code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
`,k=/^(none|transparent|inherit|initial|unset)\s*$/i,v=t=>{const a=[],n=/<style[^>]*>([\s\S]*?)<\/style>/gi;let e;for(e=n.exec(t);e!==null;)a.push(e[1]),e=n.exec(t);return a},A=t=>{const a=/background(?:-color)?\s*:\s*([^;}\n]+)/gi;let n;for(n=a.exec(t);n!==null;){const e=n[1].trim();if(!k.test(e))return!0;n=a.exec(t)}return!1},T=t=>{if(/\bstyle\s*=\s*["'][^"']*background/i.test(t)||/\bbgcolor\s*=/i.test(t))return!0;for(const a of v(t))if(A(a))return!0;return!1},N=["script","iframe","object","embed","form","input","button","textarea","select","meta","link","base"],z=["onerror","onload","onclick","onmouseover","onmouseout","onfocus","onblur","onsubmit","onkeydown","onkeyup","formaction","xlink:href","data-bind"],R="data:image/svg+xml,"+encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <rect fill="#f0f0f0" width="100" height="100"/>
    <text x="50" y="50" text-anchor="middle" dy=".3em" fill="#999" font-size="12">
      Image blocked
    </text>
  </svg>
`),L=t=>t.replace(/url\s*\([^)]*\)/gi,"none").replace(/expression\s*\([^)]*\)/gi,"").replace(/-moz-binding\s*:[^;]*/gi,""),B=t=>t.replace(/@import[^;]*;/gi,"/* @import blocked */").replace(/url\s*\([^)]*\)/gi,"none").replace(/expression\s*\([^)]*\)/gi,"").replace(/-moz-binding\s*:[^;]*/gi,""),C=(t={})=>{const a=w(),n={FORBID_TAGS:N,FORBID_ATTR:z,ALLOW_DATA_ATTR:!1,ALLOW_UNKNOWN_PROTOCOLS:!1};return a.addHook("afterSanitizeAttributes",e=>{if(e.tagName==="IMG"){const r=e.getAttribute("src")||"";if(r.startsWith("data:"))return;if(r.startsWith("cid:")){const l=r.slice(4).replace(/^<|>$/g,""),c=t.resolveCid?.(l);c&&(e.setAttribute("src",c),e.classList.add("inline-content"));return}t.allowExternalImages||(e.setAttribute("data-blocked-src",r),e.setAttribute("src",R),e.setAttribute("alt","[Blocked image]"),e.classList.add("blocked-image"))}if(e.tagName==="A"){const r=e.getAttribute("href")||"";if(/^(javascript|data):/i.test(r)){e.removeAttribute("href");return}e.setAttribute("target","_blank"),e.setAttribute("rel","noopener noreferrer nofollow"),e.classList.add("external-link")}if(e.hasAttribute("style")){const r=e.getAttribute("style")||"";e.setAttribute("style",L(r))}}),a.addHook("uponSanitizeElement",(e,r)=>{if(r.tagName==="style"){const i=e.textContent||"";e.textContent=B(i)}}),e=>{const r=T(e),i=a.sanitize(e,n);return{html:`<style>${x()}</style>${i}`,hasAuthorBackground:r}}},f=()=>s.jsx("p",{className:"text-fg-muted text-sm italic",children:"This message has no body content."}),E=({html:t,text:a,isDark:n=!1,category:e,allowImages:r=!1,resolveCid:i,className:l,renderBlockedNotice:c})=>{const d=u.useMemo(()=>!t||typeof document>"u"?null:C({allowExternalImages:r,resolveCid:i})(t),[t,r,i]),o=d?.html??null,{framed:g,isPlain:b}=y(e,d?.hasAuthorBackground??!1),m=u.useMemo(()=>!o||r?0:(o.match(/data-blocked-src/g)||[]).length,[o,r]);return!o&&!a?s.jsx("div",{className:h("message-body",l),children:s.jsx(f,{})}):s.jsxs("div",{className:h("message-body",l),children:[m>0&&s.jsx("div",{className:"message-body-notice",children:c?.(m)}),o?g?s.jsx("div",{className:"w-full max-w-full overflow-x-auto",children:s.jsx(p,{html:o,variant:"framed",isDark:n})}):s.jsx("div",{className:"max-w-full overflow-x-auto lg:max-w-2xl",children:s.jsx(p,{html:o,variant:b?"plain":"framed",isDark:n})}):a?s.jsx("pre",{className:"email-text whitespace-pre-wrap text-sm leading-relaxed",children:a}):s.jsx(f,{})]})};E.__docgenInfo={description:`Render an email body the way the app does: sanitize the raw HTML
(DOMPurify + privacy/XSS scrubbing), classify it as framed (designed mail —
author colors preserved) or plain (theme-aware base CSS), then hand the
sanitized HTML to the sandboxed \`IsolatedEmailFrame\`. Never paints raw HTML
into the app DOM — the only safe contract for untrusted mail.`,methods:[],displayName:"MessageBodyView",props:{html:{required:!1,tsType:{name:"string"},description:`Rendered email HTML (the \`text/html\` part's body, or a locally-rendered
draft). Passed RAW — this component sanitizes it before it reaches the
iframe. The single source of truth for "render an email body": app
\`MessageBody\` and the kit reading panes both compose it, so Storybook
shows the same sanitized, sandboxed rendering as the live app.`},text:{required:!1,tsType:{name:"string"},description:"Plain-text fallback for messages with no HTML part."},isDark:{required:!1,tsType:{name:"boolean"},description:"App dark mode — drives the plain/framed dark canvas in the frame.",defaultValue:{value:"false",computed:!1}},category:{required:!1,tsType:{name:"union",raw:`| "uncategorized"
| "personal"
| "newsletter"
| "marketing"
| "automated"
| "transactional"
| "social"`,elements:[{name:"literal",value:'"uncategorized"'},{name:"literal",value:'"personal"'},{name:"literal",value:'"newsletter"'},{name:"literal",value:'"marketing"'},{name:"literal",value:'"automated"'},{name:"literal",value:'"transactional"'},{name:"literal",value:'"social"'}]},description:`Message category (personal/newsletter/marketing/…). Together with the
sanitizer's author-background detection this picks the framed vs plain
treatment.`},allowImages:{required:!1,tsType:{name:"boolean"},description:'Whether external images are allowed to load. When false the sanitizer\nswaps remote `<img src>` for a placeholder and stamps `data-blocked-src`;\n`renderBlockedNotice` is then called with the count so the caller can\noffer "load images".',defaultValue:{value:"false",computed:!1}},resolveCid:{required:!1,tsType:{name:"signature",type:"function",raw:"(contentId: string) => string | undefined",signature:{arguments:[{type:{name:"string"},name:"contentId"}],return:{name:"union",raw:"string | undefined",elements:[{name:"string"},{name:"undefined"}]}}},description:"Resolve `cid:` inline-image references to fetchable URLs."},className:{required:!1,tsType:{name:"string"},description:"Extra classes for the body wrapper."},renderBlockedNotice:{required:!1,tsType:{name:"signature",type:"function",raw:"(blockedImageCount: number) => ReactNode",signature:{arguments:[{type:{name:"number"},name:"blockedImageCount"}],return:{name:"ReactNode"}}},description:`Render a notice above the body when external images were blocked. The
caller owns the "load once / always trust" affordances (they touch app
trust state), so this component only reports the count. Not called, or
called with \`0\`, when nothing was blocked.`}}};export{E as M};
