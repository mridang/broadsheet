"use client";

import { useEffect, useState } from "react";

type Theme = "ft" | "economist";
const FALLBACK: Record<Theme, string> = { ft: "#990F3D", economist: "#E3120B" };

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("ft");

  // The no-flash script already set <html data-theme>; sync the UI to it.
  useEffect(() => {
    const current =
      (document.documentElement.getAttribute("data-theme") as Theme) || "ft";
    setTheme(current);
  }, []);

  const apply = (t: Theme) => {
    const html = document.documentElement;
    html.setAttribute("data-theme", t);
    const c =
      getComputedStyle(html).getPropertyValue("--themecolor").trim() ||
      FALLBACK[t];
    const meta = document.getElementById("tc");
    if (meta && c) meta.setAttribute("content", c);
    try {
      localStorage.setItem("htimes-theme", t);
    } catch {}
    setTheme(t);
  };

  return (
    <div className="switcher" role="group" aria-label="Theme">
      <button
        data-theme="ft"
        aria-pressed={theme === "ft"}
        onClick={() => apply("ft")}
      >
        FT
      </button>
      <button
        data-theme="economist"
        aria-pressed={theme === "economist"}
        onClick={() => apply("economist")}
      >
        Economist
      </button>
    </div>
  );
}
