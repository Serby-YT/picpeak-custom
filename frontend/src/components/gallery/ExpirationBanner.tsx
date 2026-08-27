import React from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import Countdown from 'react-countdown';
import { parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useLocalizedDate } from '../../hooks/useLocalizedDate';

interface ExpirationBannerProps {
  daysRemaining: number;
  expiresAt: string;
}

// Only the last two days are genuinely urgent. Before that this is status
// information, not a warning, and styling it as an alarm for a whole week
// teaches people to ignore it - and greets them with an alert instead of
// their photographs.
const URGENT_DAYS = 2;

export const ExpirationBanner: React.FC<ExpirationBannerProps> = ({
  daysRemaining,
  expiresAt
}) => {
  const { t } = useTranslation();
  const { format } = useLocalizedDate();
  const expirationDate = parseISO(expiresAt);
  const isUrgent = daysRemaining <= URGENT_DAYS;

  const countdownRenderer = ({ days, hours, minutes, completed }: any) => {
    if (completed) return <span>{t('gallery.expired')}</span>;
    return (
      <span className="font-mono tabular-nums">
        {days > 0 ? `${days}d ` : ''}{hours}h {minutes}m
      </span>
    );
  };

  // Calm state: a quiet line that states the date once and gets out of the way.
  if (!isUrgent) {
    return (
      // Floats over the hero rather than sitting above it: in hero mode the
      // photograph should reach the top of the window, with the chrome
      // resting on it as a translucent layer.
      <div className="absolute inset-x-0 top-0 z-40 flex justify-center px-4 pt-4 pointer-events-none">
        <div
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full px-3.5 py-1.5
                     text-[11px] sm:text-xs text-white/80
                     bg-black/25 border border-white/15 backdrop-blur-md
                     shadow-[0_1px_12px_rgba(0,0,0,0.25)]"
        >
          <Clock className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
          <span className="tracking-[0.06em]">
            {t('gallery.availableUntil', 'Available until')} {format(expirationDate, 'PP')}
          </span>
        </div>
      </div>
    );
  }

  // Urgent state: now it earns colour, a fixed position and a countdown -
  // and the countdown alone says how long is left, without repeating it.
  return (
    <div
      className={`${daysRemaining <= 1 ? 'bg-red-600' : 'bg-amber-600'}
                  text-white sticky top-0 z-30`}
    >
      <div className="container py-2 sm:py-2.5">
        <div className="flex items-center justify-center gap-2 text-center">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="text-xs sm:text-sm font-medium tracking-[0.04em]">
            {t('gallery.downloadBefore')}
          </span>
          <span className="text-xs sm:text-sm opacity-90">
            <Countdown date={expirationDate} renderer={countdownRenderer} />
          </span>
        </div>
      </div>
    </div>
  );
};
