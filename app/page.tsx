import Masthead from "@/components/Masthead";
import SectionView from "@/components/SectionView";
import { getSections, EDITION } from "@/lib/newspaper";

export default function Page() {
  const sections = getSections();
  return (
    <>
      <Masthead />
      <div className="wrap">
        {sections.map((section, i) => (
          <SectionView key={i} section={section} />
        ))}
        <div className="foot">{EDITION.footer}</div>
        <div className="enginenote">{EDITION.enginenote}</div>
      </div>
    </>
  );
}
