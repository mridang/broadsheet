import type { User } from '@/lib/db';
import { ThemeSwitcher } from './theme-switcher';
import { InstallButton } from './install-button';

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function today(): string {
  const d = new Date();
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function Masthead({ user }: { user: User | null }) {
  const nav = user ? (
    <>
      <a className="navlink" href="/feeds">
        Manage feeds
      </a>{' '}
      <span className="navuser">{user.name || user.email}</span>{' '}
      <a className="navlink" href="/logout">
        Sign out
      </a>
    </>
  ) : (
    <a className="navlink" href="/login">
      Sign in
    </a>
  );

  return (
    <header className="mast">
      <div className="row">
        <span>Vol. I · No. 1</span>
        <span>Your Front Page</span>
        <span>Price: One Upvote</span>
      </div>
      <h1>The Hacker Times</h1>
      <div className="tag">
        &ldquo;All the News That&rsquo;s Fit to Upvote&rdquo;
      </div>
      <div className="date">
        <span>{today()}</span>
        <span>{user ? 'Personalised Edition' : 'Hacker News Edition'}</span>
      </div>
      <ThemeSwitcher />
      <InstallButton />
      <nav className="appnav">{nav}</nav>
    </header>
  );
}
