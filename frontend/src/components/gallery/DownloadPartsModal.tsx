import React, { useEffect, useState } from 'react';
import { X, Download, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../common';
import { galleryService, type DownloadPart } from '../../services/gallery.service';

interface DownloadPartsModalProps {
  slug: string;
  parts: DownloadPart[] | null;
  onClose: () => void;
}

// Decimal units, the way phones and browsers' download lists count, so the total
// here matches the size the browser shows while downloading
const formatSize = (bytes: number): string => {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
};

/**
 * On a phone the whole gallery comes as ~1GB parts instead of one huge ZIP. A
 * phone drops a long download easily (the screen locks, the network switches),
 * and one 8GB archive that breaks at 700MB has to start over. A part that breaks
 * costs at most one part, and the server answers Range requests, so the browser's
 * own retry continues from where it stopped.
 *
 * Browsers refuse to start several downloads by themselves, so each part is a
 * button the client taps. Which parts were started is remembered on the device,
 * so coming back later shows where they left off.
 */
export const DownloadPartsModal: React.FC<DownloadPartsModalProps> = ({ slug, parts, onClose }) => {
  const { t } = useTranslation();
  const storageKey = parts
    ? `gallery-download-parts:${slug}:${parts.length}:${parts.reduce((sum, p) => sum + p.size, 0)}`
    : '';
  const [started, setStarted] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      setStarted(new Set(Array.isArray(saved) ? saved : []));
    } catch {
      setStarted(new Set());
    }
  }, [storageKey]);

  if (!parts) return null;

  const total = parts.reduce((sum, p) => sum + p.size, 0);

  const startPart = (part: DownloadPart) => {
    galleryService.downloadPart(slug, part.index, parts.length);
    const next = new Set(started).add(part.index);
    setStarted(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      // Private mode: the ticks just won't survive a reload
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-parts-title"
        className="relative bg-surface w-full sm:max-w-md rounded-t-2xl sm:rounded-lg shadow-xl max-h-[85vh] flex flex-col"
      >
        <div className="p-5 pb-3">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-2 hover:bg-black/10 rounded-lg transition-colors"
            aria-label={t('common.close', 'Close')}
          >
            <X className="w-5 h-5 text-muted-theme" />
          </button>
          <h2 id="download-parts-title" className="text-lg font-semibold text-theme mb-2 pr-8">
            {t('gallery.downloadPartsTitle', 'Download in parts')}
          </h2>
          <p className="text-sm text-muted-theme">
            {t(
              'gallery.downloadPartsHint',
              'This gallery is {{size}}, so on a phone it comes in {{count}} parts. Tap each one. If a part stops, retry it from your browser\'s downloads and it carries on where it left off.',
              { size: formatSize(total), count: parts.length }
            )}
          </p>
        </div>

        <ul className="overflow-y-auto px-5 pb-5 space-y-2">
          {parts.map((part) => {
            const isStarted = started.has(part.index);
            return (
              <li
                key={part.index}
                className="flex items-center gap-3 rounded-lg border border-surface px-3 py-2.5"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-theme flex items-center gap-1.5">
                    {isStarted && <Check className="w-4 h-4 text-green-600 shrink-0" aria-hidden="true" />}
                    {t('gallery.downloadPartLabel', 'Part {{index}} of {{count}}', {
                      index: part.index,
                      count: parts.length,
                    })}
                  </div>
                  <div className="text-xs text-muted-theme">
                    {t('gallery.downloadPartDetails', '{{photos}} photos · {{size}}', {
                      photos: part.photoCount,
                      size: formatSize(part.size),
                    })}
                  </div>
                </div>
                <Button
                  variant={isStarted ? 'ghost' : 'primary'}
                  size="sm"
                  onClick={() => startPart(part)}
                  leftIcon={<Download className="w-4 h-4" />}
                >
                  {isStarted
                    ? t('gallery.downloadPartAgain', 'Again')
                    : t('gallery.downloadPart', 'Download')}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
