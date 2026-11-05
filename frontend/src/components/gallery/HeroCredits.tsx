import React from "react";

export interface GalleryCredit {
  name: string;
  role?: string | null;
  url: string;
}

interface HeroCreditsProps {
  // The studio running the gallery (branding company name) and, when set,
  // the link to its contact card.
  ownerName?: string;
  ownerUrl?: string | null;
  // Other photographers credited on this gallery.
  credits?: GalleryCredit[];
}

// Only absolute http(s) links become anchors; anything else renders as text.
const safeHref = (url?: string | null): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
};

/**
 * Credit lines at the bottom of the gallery hero: the studio first (linked to
 * its contact card), then everyone else who worked the event, each linked to
 * their own portfolio. Stacked on phones, one row with separators from sm up.
 */
export const HeroCredits: React.FC<HeroCreditsProps> = ({ ownerName, ownerUrl, credits = [] }) => {
  const items: Array<{ key: string; role?: string | null; name: string; href: string | null; external: boolean }> = [];
  if (ownerName) {
    items.push({ key: "owner", name: ownerName, href: safeHref(ownerUrl), external: false });
  }
  credits.forEach((credit, index) => {
    if (!credit?.name) return;
    items.push({ key: `credit-${index}`, role: credit.role, name: credit.name, href: safeHref(credit.url), external: true });
  });
  if (!items.length) return null;

  return (
    <ul className="gallery-hero-credits" aria-label="Credits">
      {items.map(item => {
        const label = (
          <>
            {item.role && (
              <>
                <span className="gallery-hero-credits__role">{item.role}</span>
                <span className="gallery-hero-credits__sep" aria-hidden="true">·</span>
                <span className="sr-only">: </span>
              </>
            )}
            <span className="gallery-hero-credits__name">{item.name}</span>
          </>
        );
        return (
          <li key={item.key} className="gallery-hero-credits__item">
            {item.href ? (
              <a
                href={item.href}
                target="_blank"
                rel={item.external ? "noopener noreferrer nofollow" : "noopener"}
                className="gallery-hero-credits__link"
              >
                {label}
              </a>
            ) : (
              <span className="gallery-hero-credits__text">{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
};

HeroCredits.displayName = "HeroCredits";
