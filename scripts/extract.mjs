// One-time extractor: turns the original static newspaper (the frozen
// June 19, 2026 "Hacker Times" snapshot) into structured data the Next.js
// app renders. Kept for provenance; not part of the build.
//
//   node scripts/extract.mjs  ->  data/newspaper.json
//
// Source HTML lives at the path below (the snapshot's newspaper/index.html).
import { parse } from "node-html-parser";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const SRC = process.argv[2] ?? "/tmp/newspaper-src/index.html";
const root = parse(readFileSync(SRC, "utf8"));

const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const scoreOf = (el) =>
  clean(el?.text).replace(/[▲]/g, "").trim();

const sections = [];

for (const sec of root.querySelectorAll("section.zone")) {
  const kind = sec.classNames.split(/\s+/).find((c) => c !== "zone");
  const title = clean(sec.querySelector(".sechead h3")?.text);
  const desc = clean(sec.querySelector(".secdesc")?.text);
  const count = clean(sec.querySelector(".seccount")?.text);

  if (kind === "hiring") {
    const jobs = sec.querySelectorAll(".job").map((a) => ({
      href: a.getAttribute("href"),
      title: clean(a.querySelector(".jt")?.text),
      meta: clean(a.querySelector(".jd")?.text),
    }));
    sections.push({ kind, title, desc, count, jobs });
    continue;
  }

  const stories = [];
  let brief = null;

  for (const art of sec.querySelectorAll(".grid > article.card")) {
    const classes = art.classNames.split(/\s+/);

    if (classes.includes("brief-block")) {
      brief = art.querySelectorAll(".brief-item").map((a) => ({
        href: a.getAttribute("href"),
        title: clean(a.querySelector(".bt")?.text),
        scoreLabel: clean(a.querySelector(".bs")?.text),
      }));
      continue;
    }

    const kicker = art.querySelector(".kicker");
    const publisher = clean(
      kicker.childNodes
        .filter((n) => n.nodeType === 3)
        .map((n) => n.text)
        .join(" ")
    );
    const badgeEl = kicker.querySelector(".badge");
    const badge = badgeEl
      ? {
          kind: badgeEl.classNames.split(/\s+/).find((c) => c !== "badge"),
          label: clean(badgeEl.text),
        }
      : null;

    const fig = art.querySelector("figure.ph");
    const image = fig
      ? {
          src: fig.querySelector("img").getAttribute("src"),
          side: fig.classNames.includes("ph-l") ? "l" : "r",
        }
      : null;

    const spanClass = classes.find((c) => /^w\d$/.test(c) || c === "w-all");

    stories.push({
      num: clean(kicker.querySelector(".num")?.text),
      href: art.querySelector("a.hit").getAttribute("href"),
      sectionClass: classes.find((c) => c.startsWith("sec-")) ?? "sec-news",
      tier: (classes.find((c) => c.startsWith("t-")) ?? "t-standard").slice(2),
      span: spanClass === "w-all" ? "all" : Number((spanClass ?? "w1").slice(1)),
      noimg: classes.includes("noimg"),
      favicon: kicker.querySelector("img.fav")?.getAttribute("src") ?? null,
      publisher,
      badge,
      score: scoreOf(kicker.querySelector(".score")),
      headline: clean(art.querySelector(".hl")?.text),
      byline: clean(art.querySelector(".byline")?.text) || null,
      image,
      excerpt: clean(art.querySelector(".ex")?.text),
    });
  }

  sections.push({ kind, title, desc, count, stories, brief });
}

mkdirSync("data", { recursive: true });
writeFileSync("data/newspaper.json", JSON.stringify(sections, null, 2) + "\n");

const counts = sections
  .map((s) => `${s.kind}:${s.stories?.length ?? s.jobs?.length ?? 0}`)
  .join("  ");
console.log("wrote data/newspaper.json —", counts);
