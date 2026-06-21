import { asset } from "@/lib/newspaper";
import type { Story } from "@/lib/types";

const spanClass = (span: Story["span"]) =>
  span === "all" ? "w-all" : `w${span}`;

export default function StoryCard({ story }: { story: Story }) {
  const cls = [
    "card",
    story.sectionClass,
    `t-${story.tier}`,
    spanClass(story.span),
    story.noimg ? "noimg" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cls}>
      <a
        className="hit"
        href={story.href}
        target="_blank"
        rel="noopener"
        aria-label={story.headline}
      />
      <div className="meat">
        <div className="kicker">
          <span className="num">{story.num}</span>
          {story.favicon && (
            <img className="fav" loading="lazy" src={asset(story.favicon)} alt="" />
          )}{" "}
          {story.publisher}{" "}
          {story.badge && (
            <span className={`badge ${story.badge.kind}`}>{story.badge.label}</span>
          )}
          <span className="score">▲ {story.score}</span>
        </div>
        <h2 className="hl">{story.headline}</h2>
        {story.byline && <div className="byline">{story.byline}</div>}
        {story.image && (
          <figure className={`ph ph-${story.image.side}`}>
            <img loading="lazy" src={asset(story.image.src)} alt="" />
          </figure>
        )}
        <p className="ex">{story.excerpt}</p>
        <span className="more">Read full story ↗</span>
      </div>
    </article>
  );
}
