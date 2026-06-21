import type { BriefItem } from "@/lib/types";

export default function BriefBlock({ items }: { items: BriefItem[] }) {
  return (
    <article className="card w-all brief-block">
      <div className="meat">
        <div className="brief-h">In Brief</div>
        {items.map((item, i) => (
          <a
            key={i}
            className="brief-item"
            href={item.href}
            target="_blank"
            rel="noopener"
          >
            <span className="bt">{item.title}</span>
            <span className="bs">{item.scoreLabel}</span>
          </a>
        ))}
      </div>
    </article>
  );
}
