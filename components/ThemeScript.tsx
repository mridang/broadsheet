// No-flash theme: apply the saved theme + address-bar colour before first
// paint, so there's no light/dark flicker on load. Mirrors the original
// snapshot's inline head script.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('htimes-theme')||'ft';var c={ft:'#990F3D',economist:'#E3120B'}[t]||'#990F3D';document.documentElement.setAttribute('data-theme',t);var m=document.getElementById('tc');if(m)m.setAttribute('content',c);}catch(e){}})();`;

export default function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
