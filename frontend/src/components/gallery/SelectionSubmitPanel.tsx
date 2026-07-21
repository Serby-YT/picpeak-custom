import React, { useState, useEffect } from 'react';
import { Send, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Button } from '../common';
import { feedbackService } from '../../services/feedback.service';
import { SelectionSubmitModal } from './SelectionSubmitModal';

interface SelectionSubmitPanelProps {
  slug: string;
  favoriteCount: number;
}

interface SubmittedState {
  photo_count: number;
  submitted_at: string;
}

export const SelectionSubmitPanel: React.FC<SelectionSubmitPanelProps> = ({ slug, favoriteCount }) => {
  const { t } = useTranslation();
  const [showModal, setShowModal] = useState(false);
  const [submitted, setSubmitted] = useState<SubmittedState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    feedbackService.getMySelection(slug)
      .then((res) => {
        if (mounted && res.selection) {
          setSubmitted({ photo_count: res.selection.photo_count, submitted_at: res.selection.submitted_at });
        }
      })
      .catch(() => { /* no prior selection, ignore */ });
    return () => { mounted = false; };
  }, [slug]);

  const handleSubmit = async (name: string, email: string, notes: string) => {
    setIsSubmitting(true);
    try {
      const res = await feedbackService.submitSelection(slug, {
        guest_name: name,
        guest_email: email || undefined,
        notes: notes || undefined,
      });
      setSubmitted(res.selection);
      setShowModal(false);
      toast.success(t('gallery.selectionSubmittedToast', 'Your selection has been sent to the photographer'));
    } catch (error: any) {
      toast.error(error?.response?.data?.error || t('gallery.selectionSubmitError', 'Failed to submit your selection'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="gallery-sidebar-section gallery-sidebar-selection p-4 border-b border-surface">
      <h3 className="gallery-sidebar-section-title text-sm font-semibold text-muted-theme mb-3 flex items-center gap-2">
        <Send className="w-4 h-4" />
        {t('gallery.mySelection', 'My Selection')}
      </h3>

      {submitted ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <Check className="w-4 h-4 flex-shrink-0" />
            {t('gallery.selectionSubmitted', 'Submitted {{count}} photos', { count: submitted.photo_count })}
          </p>
          <p className="text-xs text-muted-theme">
            {new Date(submitted.submitted_at).toLocaleDateString()}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="gallery-btn w-full"
            onClick={() => setShowModal(true)}
            disabled={favoriteCount === 0}
          >
            {t('gallery.updateSelection', 'Update Selection')} ({favoriteCount})
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-theme">
            {t('gallery.favoritedCountHint', '{{count}} photos favorited', { count: favoriteCount })}
          </p>
          <Button
            variant="primary"
            size="sm"
            className="gallery-btn w-full"
            onClick={() => setShowModal(true)}
            disabled={favoriteCount === 0}
          >
            {t('gallery.submitSelection', 'Submit My Selection')}
          </Button>
        </div>
      )}

      <SelectionSubmitModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        photoCount={favoriteCount}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
};
