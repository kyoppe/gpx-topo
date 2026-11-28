import type { Copy } from './i18n';

/** The same three places as on the (i) flag: X, the podcast on Spotify, and the Amazon wish list. */
const LINKS = [
  {
    key: 'x',
    href: 'https://x.com/kyouhei',
    label: () => 'X',
    icon: <path d="M17.8 3h3.1l-6.8 7.7 8 10.3h-6.2l-4.9-6.3L5.4 21H2.3l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" />,
  },
  {
    key: 'spotify',
    href: 'https://open.spotify.com/show/6rRIlgRDC7EasQW0qDI4DE?si=fe5bb5298dde4e27',
    label: () => 'Podcast (Spotify)',
    icon: (
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.4a.6.6 0 0 1-.9.2c-2.4-1.5-5.4-1.8-9-1a.6.6 0 1 1-.3-1.2c3.9-.9 7.2-.5 9.9 1.1.3.2.4.6.3.9Zm1.2-2.7a.8.8 0 0 1-1.1.3c-2.7-1.7-6.9-2.2-10.1-1.2a.8.8 0 1 1-.5-1.5c3.7-1.1 8.3-.6 11.4 1.3.4.2.5.7.3 1.1Zm.1-2.8C14.7 9 9.4 8.8 6.3 9.7a.9.9 0 1 1-.5-1.8c3.5-1.1 9.4-.9 13.1 1.3a.9.9 0 1 1-.9 1.6Z" />
    ),
  },
  {
    key: 'wishlist',
    href: 'https://www.amazon.co.jp/hz/wishlist/ls/1DP92J2BSDP0O',
    label: (copy: Copy) => copy.flag.wishlist,
    icon: (
      <>
        <path d="M5 2.8h9.5L19 7.3v10.1a3.8 3.8 0 0 1-3.8 3.8H5a3.8 3.8 0 0 1-3.8-3.8V6.6A3.8 3.8 0 0 1 5 2.8Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.45" />
        <path d="M14.5 3v4.3h4.1M4.8 10h6.8M4.8 13.2h5.7M4.8 16.4h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.45" />
        <path d="M15.5 12c1.2-1.5 4-.8 4 1.3 0 2.5-4 5.6-4 5.6s-4-3.1-4-5.6c0-2.1 2.8-2.8 4-1.3Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.65" />
      </>
    ),
  },
] as const;

/** The maker, at the foot of the page: a name and the same three icons as in the (i) flag. */
export default function CreatorSection({ title, name, copy }: { title: string; name: string; copy: Copy }) {
  return (
    <section className="site-section site-creator" id="creator" aria-labelledby="creator-title">
      <h2 id="creator-title">{title}</h2>
      <p className="site-creator-line">
        <span className="site-creator-name">{name}</span>
        {LINKS.map((link) => (
          <a key={link.key} className="site-creator-icon" href={link.href} target="_blank" rel="noreferrer" aria-label={link.label(copy)} title={link.label(copy)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {link.icon}
            </svg>
          </a>
        ))}
      </p>
    </section>
  );
}
