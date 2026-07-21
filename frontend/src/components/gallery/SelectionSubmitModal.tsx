import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '../common';

interface SelectionSubmitModalProps {
  isOpen: boolean;
  onClose: () => void;
  photoCount: number;
  onSubmit: (name: string, email: string, notes: string) => void;
  isSubmitting?: boolean;
}

export const SelectionSubmitModal: React.FC<SelectionSubmitModalProps> = ({
  isOpen,
  onClose,
  photoCount,
  onSubmit,
  isSubmitting = false,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t('gallery.selectionNameRequired', 'Please enter your name'));
      return;
    }
    onSubmit(name.trim(), email.trim(), notes.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-surface rounded-lg shadow-xl max-w-md w-full p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 hover:bg-black/10 rounded-lg transition-colors"
          aria-label={t('common.close')}
        >
          <X className="w-5 h-5 text-muted-theme" />
        </button>

        <h2 className="text-lg font-semibold text-theme mb-2">
          {t('gallery.submitSelectionTitle', 'Submit Your Final Selection')}
        </h2>
        <p className="text-sm text-muted-theme mb-4">
          {t(
            'gallery.submitSelectionHint',
            "You've favorited {{count}} photos. Submitting locks these in as your final picks for the photographer.",
            { count: photoCount }
          )}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('feedback.yourName', 'Your Name')}
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            error={error}
            placeholder={t('feedback.namePlaceholder', 'Enter your name')}
            required
          />
          <Input
            type="email"
            label={t('gallery.emailOptional', 'Your Email (optional)')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('feedback.emailPlaceholder', 'Enter your email')}
          />
          <div>
            <label className="block text-sm font-medium text-theme mb-1">
              {t('gallery.notesOptional', 'Notes for your photographer (optional)')}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-surface border border-surface rounded-lg text-theme placeholder:text-muted-theme focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder={t('gallery.notesPlaceholder', 'Anything specific you want them to know?')}
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" variant="primary" className="flex-1" disabled={isSubmitting}>
              {isSubmitting
                ? t('gallery.submittingSelection', 'Submitting...')
                : t('gallery.submitSelection', 'Submit My Selection')}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
              {t('common.cancel', 'Cancel')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
