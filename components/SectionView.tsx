import type { Section } from "@/lib/types";
import StoryCard from "./StoryCard";
import BriefBlock from "./BriefBlock";

function SectionHead({ title, desc, count }: Pick<Section, "title" | "desc" | "count">) {
  return (
    <div className="sechead">
      <h3>{title}</h3>
      <span className="secdesc">{desc}</span>
      <span className="seccount">{count}</span>
    </div>
  );
}

export default function SectionView({ section }: { section: Section }) {
  if (section.kind === "hiring") {
    return (
      <section className="zone hiring">
        <SectionHead title={section.title} desc={section.desc} count={section.count} />
        <div className="classifieds">
          {section.jobs.map((job, i) => (
            <a key={i} className="job" href={job.href} target="_blank" rel="noopener">
              <span className="jt">{job.title}</span>
              <span className="jd">{job.meta}</span>
            </a>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={`zone ${section.kind}`}>
      <SectionHead title={section.title} desc={section.desc} count={section.count} />
      <div className="grid">
        {section.stories.map((story, i) => (
          <StoryCard key={i} story={story} />
        ))}
        {section.brief && section.brief.length > 0 && (
          <BriefBlock items={section.brief} />
        )}
      </div>
    </section>
  );
}
