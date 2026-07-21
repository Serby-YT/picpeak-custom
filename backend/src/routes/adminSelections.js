/**
 * Admin routes for viewing client-submitted photo selections (proofing)
 */

const express = require('express');
const router = express.Router();
const { db, withRetry } = require('../database/db');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

// List submitted selections for an event, most recent first
router.get('/:eventId', adminAuth, requirePermission('photos.view'), async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);

    const event = await withRetry(() => db('events').where('id', eventId).first());
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const selections = await db('gallery_selections')
      .where('event_id', eventId)
      .select('id', 'guest_name', 'guest_email', 'notes', 'photo_count', 'submitted_at')
      .orderBy('submitted_at', 'desc');

    res.json({ selections });
  } catch (error) {
    logger.error('Error listing gallery selections:', error);
    res.status(500).json({ error: 'Failed to load selections' });
  }
});

// Full detail for one submitted selection, including its photo list
router.get('/:eventId/:selectionId', adminAuth, requirePermission('photos.view'), async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const selectionId = parseInt(req.params.selectionId);

    const selection = await db('gallery_selections')
      .where({ id: selectionId, event_id: eventId })
      .first();

    if (!selection) {
      return res.status(404).json({ error: 'Selection not found' });
    }

    const photoRows = await db('gallery_selection_photos')
      .join('photos', 'gallery_selection_photos.photo_id', 'photos.id')
      .where('gallery_selection_photos.selection_id', selectionId)
      .select(
        'photos.id',
        'photos.filename',
        'photos.average_rating',
        'photos.like_count'
      );

    const photos = photoRows.map((photo) => ({
      ...photo,
      thumbnail_url: `/admin/photos/${eventId}/thumbnail/${photo.id}`
    }));

    res.json({
      selection: {
        id: selection.id,
        guest_name: selection.guest_name,
        guest_email: selection.guest_email,
        notes: selection.notes,
        photo_count: selection.photo_count,
        submitted_at: selection.submitted_at
      },
      photos
    });
  } catch (error) {
    logger.error('Error getting gallery selection detail:', error);
    res.status(500).json({ error: 'Failed to load selection' });
  }
});

module.exports = router;
