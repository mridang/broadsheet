import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'The Hacker Times',
    short_name: 'Hacker Times',
    description:
      'A personalised daily newspaper, generated fresh from the feeds you follow.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#FFF1E5',
    theme_color: '#990F3D',
  };
}
