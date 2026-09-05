import{r as c,j as x}from"./iframe-uufGNBEn.js";const z=()=>`
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
/* An author \`nowrap\` assumes a viewport as wide as the line. The frame is the
   pane's width whatever the mail is, so a pinned paragraph turns reading one
   sentence into a sideways drag — and inside an author \`overflow:hidden\` it is
   cut mid-character with nothing left to scroll at all. Flowing text wraps. The
   \`i\` flag is load-bearing: Outlook and older generators emit \`WHITE-SPACE:
   NOWRAP\`, and an attribute value match is case-sensitive without it. */
[nowrap]:not(pre, code, pre *, code *),
[style*="nowrap" i]:not(pre, code, pre *, code *) {
  white-space: normal !important;
}
/* Long unbroken strings (URLs, tokens) wrap instead of forcing a wide line. */
pre, code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
/* Preformatted text keeps its spacing even where a nowrap is declared — on the
   block or on a span inside it. \`normal\` would collapse the runs of spaces that
   are the entire content of a \`pre\`, and the un-important rule above cannot
   defend an inline style, so this wraps to \`pre-wrap\` instead of unwrapping. */
:is(pre, code, pre *, code *):is([nowrap], [style*="nowrap" i]) {
  white-space: pre-wrap !important;
}
`,T='"Geist Variable", "Geist", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',h={light:{fg:"oklch(0.3 0.025 235)",canvas:"oklch(0.96 0.015 90)",accent:"oklch(0.55 0.14 150)"},dark:{fg:"oklch(0.88 0.02 90)",canvas:"oklch(0.22 0.025 220)",accent:"oklch(0.78 0.16 150)"}},S={background:!1,spacing:!1},A="16px",$=()=>`html{padding:0}body{padding:${A};box-sizing:border-box}`,R=()=>"html{overflow:hidden}body{overflow-x:auto}",L=/prefers-color-scheme\s*:\s*dark|color-scheme\s*:\s*[^;}"']*\bdark\b/i,M='<meta name="viewport" content="width=device-width, initial-scale=1">',_=e=>{const t=e?h.dark:h.light;return`
/* Plain-email base: UI font-stack + theme-aware colors (#424) */
html, body {
  font-family: ${T};
  font-size: 14px;
  line-height: 1.6;
  color: ${t.fg};
  background-color: ${t.canvas};
  margin: 0;
  padding: 0;
}
/* Strip author unreadable text colors and element backgrounds, scoped to body
   descendants so the themed html/body surface above survives this reset. */
body * {
  color: inherit !important;
  background-color: transparent !important;
}
a, a:visited {
  color: ${t.accent} !important;
  text-decoration: underline;
}
`},u="invert(0.92) hue-rotate(180deg)",y=`img,picture,video,svg,canvas,[style*='background-image'],[background]{filter:${u}}`,I=(e,t,a)=>{const r=e?h.dark.canvas:h.light.canvas;return a?e?t?`html,body{margin:0;background-color:${r};color-scheme:dark light}`:`html{margin:0;background-color:#ffffff;filter:${u}}body{margin:0}${y}`:"html,body{margin:0;background-color:#ffffff;color-scheme:light}":e?t?`html,body{margin:0;background-color:${r};color-scheme:dark light}`:`html{margin:0;background-color:${r}}body{margin:0;filter:${u}}${y}`:`html,body{margin:0;background-color:${r};color-scheme:light}`},N=(e,t,a,r=S)=>{const m=t==="plain"?_(a):I(a,L.test(e),r.background),l=r.spacing?"":$();return`${M}<style>${m}</style>${e}<style>${R()}${l}</style>`},C=5e4,D="allow-same-origin allow-popups allow-popups-to-escape-sandbox",H=(e,t,a)=>Math.min(Math.ceil(Math.max(e,t)),a),K=new Set(["Enter","Escape","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End"]),O=e=>e===" "?!1:e.length===1?!0:K.has(e),p=e=>{if(e.metaKey||e.ctrlKey||e.altKey||!O(e.key))return;const t=e.currentTarget??e.target,a=t?.defaultView?.parent;!a||a===t?.defaultView||a.dispatchEvent(new KeyboardEvent("keydown",{key:e.key,code:e.code,shiftKey:e.shiftKey,bubbles:!0,cancelable:!0}))},F=({html:e,variant:t="framed",isDark:a=!1,declares:r,className:m})=>{const l=c.useRef(null),[f,v]=c.useState(0),k=c.useMemo(()=>N(e,t,a,r),[e,t,a,r]);return c.useEffect(()=>{const d=l.current;if(!d)return;const o=()=>{const n=d.contentDocument;if(!n?.body)return;const E=n.documentElement,w=H(n.body.scrollHeight,E?.scrollHeight??0,C);v(b=>b===w?b:w)};let i,s;const g=()=>{o(),i?.disconnect(),i=void 0,s?.removeEventListener("keydown",p),s?.removeEventListener("load",o,!0),s=void 0;const n=d.contentDocument;n?.body&&(i=new ResizeObserver(o),i.observe(n.body),n.documentElement&&i.observe(n.documentElement),n.addEventListener("load",o,!0),n.fonts?.ready.then(o),n.addEventListener("keydown",p),s=n)};return d.addEventListener("load",g),()=>{d.removeEventListener("load",g),s?.removeEventListener("keydown",p),s?.removeEventListener("load",o,!0),i?.disconnect()}},[]),x.jsx("iframe",{ref:l,title:"Email content",sandbox:D,srcDoc:k,className:m,style:{width:"100%",border:"none",display:"block",height:f===0?"1px":`${f}px`,colorScheme:"normal"}})};F.__docgenInfo={description:`Render untrusted (sanitized) email HTML in a sandboxed iframe that is exactly
as wide as the pane holding it and isolates the email's CSS from the app
chrome.

Presentational: HTML + treatment + theme come in via props; the component owns
the srcDoc assembly and the height. The width is the app's layout and nothing
else — the frame is never widened to fit the mail, so no measurement of the
email can move a box the reader can see. Content that genuinely cannot wrap (a
fixed-width table, an oversized image, a \`pre\` the author pinned) scrolls
inside the document, where it lives; the pane and the page never learn about
it.

Height is the one axis the frame reads off its content: a seamless inline
frame has to grow to the mail it shows or it would scroll internally against
the page's own scrollbar.`,methods:[],displayName:"IsolatedEmailFrame",props:{html:{required:!0,tsType:{name:"string"},description:`Sanitized email HTML. Must already be DOMPurify'd and carry the
sanitizer's layout-clamp \`<style>\` block; this component only adds the
colour / font / dark-mode canvas and isolates the result in a sandboxed
iframe. Never pass raw, untrusted HTML here.`},variant:{required:!1,tsType:{name:"union",raw:'"plain" | "framed"',elements:[{name:"literal",value:'"plain"'},{name:"literal",value:'"framed"'}]},description:`Render treatment:

- \`"plain"\` — weakly-marked / personal mail. UI sans-serif + theme-aware
  colours are injected so black-text-on-dark is readable.
- \`"framed"\` — designed mail (newsletter / marketing / author background).
  The author's colours are preserved; in dark mode the email is darkened
  via a smart-invert unless it opts into its own dark design.`,defaultValue:{value:'"framed"',computed:!1}},isDark:{required:!1,tsType:{name:"boolean"},description:`Whether the app is in dark mode. The plain branch picks theme-aware
colours; the framed branch decides whether to render as-authored on white
or apply the smart-invert.`,defaultValue:{value:"false",computed:!1}},declares:{required:!1,tsType:{name:"AuthorDeclarations"},description:`What the mail declares about its own presentation, from the sanitizer. A
declared background renders as authored; where the mail declares none the
frame's ground is the reading pane's own colour. A mail that declares no
padding or margin is given breathing room inside that ground.`},className:{required:!1,tsType:{name:"string"},description:""}}};export{F as I,z as g};
