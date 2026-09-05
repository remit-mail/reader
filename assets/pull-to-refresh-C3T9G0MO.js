import{R as l,r as m,j as $}from"./iframe-uufGNBEn.js";import{u as K,D as Q}from"./use-match-media-ZIkBguB9.js";var w;(function(e){e[e.UP=-1]="UP",e[e.DOWN=1]="DOWN"})(w||(w={}));function V(e){var t=getComputedStyle(e).overflowY;return e===document.scrollingElement&&t==="visible"?!0:!(t!=="scroll"&&t!=="auto")}function X(e,t){if(!V(e))return!1;if(t===w.DOWN){var a=e.scrollTop+e.clientHeight;return a<e.scrollHeight}if(t===w.UP)return e.scrollTop>0;throw new Error("unsupported direction")}function H(e,t){return X(e,t)?!0:e.parentElement==null?!1:H(e.parentElement,t)}function j(e,t){t===void 0&&(t={});var a=t.insertAt;if(!(!e||typeof document>"u")){var o=document.head||document.getElementsByTagName("head")[0],i=document.createElement("style");i.type="text/css",a==="top"&&o.firstChild?o.insertBefore(i,o.firstChild):o.appendChild(i),i.styleSheet?i.styleSheet.cssText=e:i.appendChild(document.createTextNode(e))}}var G=`.lds-ellipsis {
  display: inline-block;
  position: relative;
  width: 64px;
  height: 64px;
}

.lds-ellipsis div {
  position: absolute;
  top: 27px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: rgb(54, 54, 54);
  animation-timing-function: cubic-bezier(0, 1, 1, 0);
}

.lds-ellipsis div:nth-child(1) {
  left: 6px;
  animation: lds-ellipsis1 0.6s infinite;
}

.lds-ellipsis div:nth-child(2) {
  left: 6px;
  animation: lds-ellipsis2 0.6s infinite;
}

.lds-ellipsis div:nth-child(3) {
  left: 26px;
  animation: lds-ellipsis2 0.6s infinite;
}

.lds-ellipsis div:nth-child(4) {
  left: 45px;
  animation: lds-ellipsis3 0.6s infinite;
}

@keyframes lds-ellipsis1 {
  0% {
    transform: scale(0);
  }
  100% {
    transform: scale(1);
  }
}
@keyframes lds-ellipsis3 {
  0% {
    transform: scale(1);
  }
  100% {
    transform: scale(0);
  }
}
@keyframes lds-ellipsis2 {
  0% {
    transform: translate(0, 0);
  }
  100% {
    transform: translate(19px, 0);
  }
}`;j(G);var J=function(){return l.createElement("div",{className:"lds-ellipsis"},l.createElement("div",null),l.createElement("div",null),l.createElement("div",null),l.createElement("div",null))},Z=function(){return l.createElement("div",null,l.createElement("p",null,"↧  pull to refresh  ↧"))},I=`.ptr,
.ptr__children {
  height: 100%;
  width: 100%;
  overflow: hidden;
  -webkit-overflow-scrolling: touch;
  position: relative;
}

.ptr.ptr--fetch-more-treshold-breached .ptr__fetch-more {
  display: block;
}

.ptr__fetch-more {
  display: none;
}

/**
  * Pull down transition 
  */
.ptr__children,
.ptr__pull-down {
  transition: transform 0.2s cubic-bezier(0, 0, 0.31, 1);
}

.ptr__pull-down {
  position: absolute;
  overflow: hidden;
  left: 0;
  right: 0;
  top: 0;
  visibility: hidden;
}
.ptr__pull-down > div {
  display: none;
}

.ptr--dragging {
  /**
    * Hide PullMore content is treshold breached
    */
}
.ptr--dragging.ptr--pull-down-treshold-breached .ptr__pull-down--pull-more {
  display: none;
}
.ptr--dragging {
  /**
    * Otherwize, display content
    */
}
.ptr--dragging .ptr__pull-down--pull-more {
  display: block;
}

.ptr--pull-down-treshold-breached {
  /**
    * Force opacity to 1 is pull down trashold breached
    */
}
.ptr--pull-down-treshold-breached .ptr__pull-down {
  opacity: 1 !important;
}
.ptr--pull-down-treshold-breached {
  /**
    * And display loader
    */
}
.ptr--pull-down-treshold-breached .ptr__pull-down--loading {
  display: block;
}

.ptr__loader {
  margin: 0 auto;
  text-align: center;
}`;j(I);var ee=function(e){var t=e.isPullable,a=t===void 0?!0:t,o=e.canFetchMore,i=o===void 0?!1:o,k=e.onRefresh,b=e.onFetchMore,P=e.refreshingContent,M=P===void 0?l.createElement(J,null):P,D=e.pullingContent,U=D===void 0?l.createElement(Z,null):D,T=e.children,C=e.pullDownThreshold,x=C===void 0?67:C,N=e.fetchMoreThreshold,L=N===void 0?100:N,A=e.maxPullDownDistance,R=A===void 0?95:A,S=e.resistance,q=S===void 0?1:S,O=e.backgroundColor,Y=e.className,W=Y===void 0?"":Y,s=m.useRef(null),r=m.useRef(null),d=m.useRef(null),z=m.useRef(null),y=!1,g=!1,p=!1,f=0,h=0;m.useEffect(function(){if(!(!a||!r||!r.current)){var n=r.current;return n.addEventListener("touchstart",E,{passive:!0}),n.addEventListener("mousedown",E),n.addEventListener("touchmove",_,{passive:!1}),n.addEventListener("mousemove",_),window.addEventListener("scroll",F),n.addEventListener("touchend",v),n.addEventListener("mouseup",v),document.body.addEventListener("mouseleave",v),function(){n.removeEventListener("touchstart",E),n.removeEventListener("mousedown",E),n.removeEventListener("touchmove",_),n.removeEventListener("mousemove",_),window.removeEventListener("scroll",F),n.removeEventListener("touchend",v),n.removeEventListener("mouseup",v),document.body.removeEventListener("mouseleave",v)}}},[T,a,k,x,R,i,L]),m.useEffect(function(){var n;if(!((n=s)===null||n===void 0)&&n.current){var c=s.current.classList.contains("ptr--fetch-more-treshold-breached");c||i&&B()<L&&b&&(s.current.classList.add("ptr--fetch-more-treshold-breached"),g=!0,b().then(u).catch(u))}},[i,T]);var B=function(){if(!r||!r.current)return-1;var n=window.scrollY,c=r.current.scrollHeight;return c-n-window.innerHeight},u=function(){requestAnimationFrame(function(){r.current&&(r.current.style.overflowX="hidden",r.current.style.overflowY="auto",r.current.style.transform="unset"),d.current&&(d.current.style.opacity="0"),s.current&&(s.current.classList.remove("ptr--pull-down-treshold-breached"),s.current.classList.remove("ptr--dragging"),s.current.classList.remove("ptr--fetch-more-treshold-breached")),y&&(y=!1),g&&(g=!1)})},E=function(n){p=!1,n instanceof MouseEvent&&(f=n.pageY),window.TouchEvent&&n instanceof TouchEvent&&(f=n.touches[0].pageY),h=f,!(n.type==="touchstart"&&H(n.target,w.UP))&&(r.current.getBoundingClientRect().top<0||(p=!0))},_=function(n){if(p){if(window.TouchEvent&&n instanceof TouchEvent?h=n.touches[0].pageY:h=n.pageY,s.current.classList.add("ptr--dragging"),h<f){p=!1;return}n.cancelable&&n.preventDefault();var c=Math.min((h-f)/q,R);c>=x&&(p=!0,y=!0,s.current.classList.remove("ptr--dragging"),s.current.classList.add("ptr--pull-down-treshold-breached")),!(c>=R)&&(d.current.style.opacity=(c/65).toString(),r.current.style.overflow="visible",r.current.style.transform="translate(0px, "+c+"px)",d.current.style.visibility="visible")}},F=function(n){g||i&&B()<L&&b&&(g=!0,s.current.classList.add("ptr--fetch-more-treshold-breached"),b().then(u).catch(u))},v=function(){if(p=!1,f=0,h=0,!y){d.current&&(d.current.style.visibility="hidden"),u();return}r.current&&(r.current.style.overflow="visible",r.current.style.transform="translate(0px, "+x+"px)"),k().then(u).catch(u)};return l.createElement("div",{className:"ptr "+W,style:{backgroundColor:O},ref:s},l.createElement("div",{className:"ptr__pull-down",ref:d},l.createElement("div",{className:"ptr__loader ptr__pull-down--loading"},M),l.createElement("div",{className:"ptr__pull-down--pull-more"},U)),l.createElement("div",{className:"ptr__children",ref:r},T,l.createElement("div",{className:"ptr__fetch-more",ref:z},l.createElement("div",{className:"ptr__loader ptr__fetch-more--loading"},M))))};const ne=({children:e,onRefresh:t,isRefreshing:a})=>K(Q)?e:$.jsx(ee,{onRefresh:t,isPullable:!a,children:e});ne.__docgenInfo={description:"Wraps a scrollable list with a pull-to-refresh gesture on mobile. Below the\ndesktop breakpoint (Tailwind `lg`) a downward pull at the top of the list\nfires `onRefresh`; at desktop the gesture is inert and children render\ndirectly, since there is no touch list to pull.\n\nPresentational: the caller owns what refreshing means via `onRefresh` and\nsurfaces in-flight state through `isRefreshing`.",methods:[],displayName:"PullToRefresh",props:{children:{required:!0,tsType:{name:"ReactElement"},description:""},onRefresh:{required:!0,tsType:{name:"signature",type:"function",raw:"() => Promise<unknown>",signature:{arguments:[],return:{name:"Promise",elements:[{name:"unknown"}],raw:"Promise<unknown>"}}},description:""},isRefreshing:{required:!1,tsType:{name:"boolean"},description:""}}};export{ne as P};
