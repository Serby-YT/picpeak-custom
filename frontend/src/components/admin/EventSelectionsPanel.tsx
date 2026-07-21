import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Mail, MessageSquare, User } from 'lucide-react';
import { Card } from '../common';
import { adminService } from '../../services/admin.service';

interface EventSelectionsPanelProps {
  eventId: number;
}

const SelectionRow: React.FC<{ eventId: number; selectionId: number; guestName: string; guestEmail: string | null; notes: string | null; photoCount: number; submittedAt: string }> = ({
  eventId,
  selectionId,
  guestName,
  guestEmail,
  notes,
  photoCount,
  submittedAt,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-selection-detail', eventId, selectionId],
    queryFn: () => adminService.getSelectionDetail(eventId, selectionId),
    enabled: expanded,
  });

  return (
    <div className="border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? (
            <ChevronDown className="w-4 h-4 flex-shrink-0 text-neutral-400" />
          ) : (
            <ChevronRight className="w-4 h-4 flex-shrink-0 text-neutral-400" />
          )}
          <div className="min-w-0">
            <p className="font-medium text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
              <User className="w-4 h-4 text-neutral-400 flex-shrink-0" />
              <span className="truncate">{guestName}</span>
            </p>
            {guestEmail && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5 mt-0.5">
                <Mail className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{guestEmail}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 text-right">
          <span className="px-2 py-1 text-xs font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full">
            {t('events.selectionPhotoCount', '{{count}} photos', { count: photoCount })}
          </span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
            {new Date(submittedAt).toLocaleDateString()}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="p-4 border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/40">
          {notes && (
            <div className="mb-4 p-3 bg-white dark:bg-neutral-800 rounded-md border border-neutral-200 dark:border-neutral-700">
              <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5 mb-1">
                <MessageSquare className="w-3 h-3" />
                {t('events.selectionNotes', 'Note from client')}
              </p>
              <p className="text-sm text-neutral-700 dark:text-neutral-300">{notes}</p>
            </div>
          )}

          {isLoading && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading', 'Loading...')}</p>
          )}

          {data && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {data.photos.map((photo) => (
                <div key={photo.id} className="aspect-square rounded-md overflow-hidden bg-neutral-200 dark:bg-neutral-700">
                  <img
                    src={photo.thumbnail_url}
                    alt={photo.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const EventSelectionsPanel: React.FC<EventSelectionsPanelProps> = ({ eventId }) => {
  const { t } = useTranslation();

  const { data: selections = [], isLoading } = useQuery({
    queryKey: ['admin-event-selections', eventId],
    queryFn: () => adminService.getEventSelections(eventId),
  });

  return (
    <Card padding="md">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
          {t('events.selectionsTitle', 'Client Selections')}
        </h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {t('events.selectionsInfo', "Final photo picks your clients have submitted for you to work from - separate from casual favoriting, this is their locked-in list.")}
        </p>
      </div>

      {isLoading && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading', 'Loading...')}</p>
      )}

      {!isLoading && selections.length === 0 && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {t('events.noSelectionsYet', 'No client has submitted a final selection yet.')}
        </p>
      )}

      {selections.length > 0 && (
        <div className="space-y-3">
          {selections.map((selection) => (
            <SelectionRow
              key={selection.id}
              eventId={eventId}
              selectionId={selection.id}
              guestName={selection.guest_name}
              guestEmail={selection.guest_email}
              notes={selection.notes}
              photoCount={selection.photo_count}
              submittedAt={selection.submitted_at}
            />
          ))}
        </div>
      )}
    </Card>
  );
};
