import type { Metadata, Viewport } from 'next';
import { Lora, Source_Serif_4 } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { currentUser } from '@/lib/account';
import { Masthead } from './(home)/_components/masthead';

// Theme body fonts — FT → Source Serif 4, Economist → Lora. Exposed as CSS
// variables the newspaper stylesheet switches between per data-theme.
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-source-serif',
  weight: ['400', '600', '700', '900'],
  style: ['normal', 'italic'],
});
const lora = Lora({
  subsets: ['latin'],
  variable: '--font-lora',
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
});

const TITLE = 'The Hacker Times';
const DESCRIPTION =
  'A personalised daily newspaper, generated fresh from the feeds you follow.';
const SITE_URL = 'https://broadsheet.apps.mrida.ng';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Hacker Times' },
  openGraph: {
    type: 'website',
    siteName: TITLE,
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#990F3D',
};

// No-flash: apply the saved theme + bar colour before first paint.
const NOFLASH =
  "(function(){try{var t=localStorage.getItem('ht-theme')||'ft';" +
  "var c={ft:'#990F3D',economist:'#E3120B'}[t]||'#990F3D';" +
  "document.documentElement.setAttribute('data-theme',t);" +
  "var m=document.querySelector('meta[name=theme-color]');" +
  "if(m)m.setAttribute('content',c);}catch(e){}})();";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await currentUser();
  return (
    <html
      lang="en"
      data-theme="ft"
      suppressHydrationWarning
      className={`${sourceSerif.variable} ${lora.variable}`}
    >
      <body>
        <Script id="noflash" strategy="beforeInteractive">
          {NOFLASH}
        </Script>
        <Masthead user={user} />
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
