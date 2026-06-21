import { EDITION } from "@/lib/newspaper";
import ThemeSwitcher from "./ThemeSwitcher";
import InstallButton from "./InstallButton";

export default function Masthead() {
  return (
    <header className="mast">
      <div className="row">
        <span>{EDITION.volume}</span>
        <span>{EDITION.strapline}</span>
        <span>{EDITION.price}</span>
      </div>
      <h1>{EDITION.title}</h1>
      <div className="tag">{EDITION.tagline}</div>
      <div className="date">
        <span>{EDITION.date}</span>
        <span>{EDITION.place}</span>
        <span>{EDITION.edition}</span>
      </div>
      <ThemeSwitcher />
      <InstallButton />
    </header>
  );
}
