const express = require('express');
const router = express.Router();
const { photoAuth } = require('../middleware/photoAuth');
const { verifyGalleryAccess } = require('../middleware/gallery');
const { feedbackRateLimit, generateGuestIdentifier } = require('../middleware/feedbackRateLimit');
const feedbackService = require('../services/feedbackService');
const feedbackModeration = require('../services/feedbackModeration');
const { db, logActivity } = require('../database/db');
const logger = require('../utils/logger');
const {
  validatePhotoId,
  validateFeedbackSubmission,
  checkValidation,
  validateGuestRequirements
} = require('../utils/feedbackValidation');
const { escapeLikePattern } = require('../utils/sqlSecurity');

// Get feedback settings for a gallery
router.get('/:slug/feedback-settings',
  verifyGalleryAccess,
  async (req, res) => {
    try {
      const event = req.event;
      const settings = await feedbackService.getEventFeedbackSettings(event.id);
      
      // Only send relevant settings to guests
      // Convert SQLite boolean values (0/1) to proper booleans
      const guestSettings = {
        feedback_enabled: Boolean(settings.feedback_enabled),
        allow_ratings: Boolean(settings.allow_ratings),
        allow_likes: Boolean(settings.allow_likes),
        allow_comments: Boolean(settings.allow_comments),
        allow_favorites: Boolean(settings.allow_favorites),
        require_name_email: Boolean(settings.require_name_email),
        show_feedback_to_guests: Boolean(settings.show_feedback_to_guests)
      };
      
      res.json(guestSettings);
    } catch (error) {
      logger.error('Error getting feedback settings:', error);
      res.status(500).json({ error: 'Failed to get feedback settings' });
    }
  }
);

// Get feedback for a specific photo
router.get('/:slug/photos/:photoId/feedback',
  verifyGalleryAccess,
  validatePhotoId,
  checkValidation,
  async (req, res) => {
    try {
      const { photoId } = req.params;
      const event = req.event;
      const guestIdentifier = generateGuestIdentifier(req);
      
      // Get feedback settings
      const settings = await feedbackService.getEventFeedbackSettings(event.id);
      
      if (!settings.feedback_enabled) {
        return res.status(403).json({ error: 'Feedback is not enabled for this event' });
      }
      
      // Verify photo belongs to event
      const photo = await db('photos')
        .where({ id: photoId, event_id: event.id })
        .first();
      
      if (!photo) {
        return res.status(404).json({ error: 'Photo not found' });
      }
      
      // Get feedback based on settings
      const options = {
        approved_only: true,
        include_hidden: false
      };
      
      // Include guest's own feedback even if not approved
      const feedback = await feedbackService.getPhotoFeedback(photoId, options);
      
      // Get guest's own feedback separately
      const guestFeedback = await feedbackService.getPhotoFeedback(photoId, {
        guest_identifier: guestIdentifier
      });
      
      // Combine and deduplicate
      const allFeedback = [...feedback];
      guestFeedback.forEach(gf => {
        if (!feedback.find(f => f.id === gf.id)) {
          allFeedback.push({ ...gf, is_mine: true });
        } else {
          const index = allFeedback.findIndex(f => f.id === gf.id);
          allFeedback[index].is_mine = true;
        }
      });
      
      // Filter based on what guests should see
      const visibleFeedback = settings.show_feedback_to_guests ? allFeedback : 
        allFeedback.filter(f => f.is_mine);
      
      res.json({
        feedback: visibleFeedback,
        summary: {
          average_rating: photo.average_rating || 0,
          total_ratings: await db('photo_feedback')
            .where({ photo_id: photoId, feedback_type: 'rating', is_hidden: false })
            .count('id as count')
            .first()
            .then(r => r.count),
          like_count: photo.like_count || 0,
          favorite_count: photo.favorite_count || 0,
          comment_count: await db('photo_feedback')
            .where({ 
              photo_id: photoId, 
              feedback_type: 'comment', 
              is_approved: true,
              is_hidden: false 
            })
            .count('id as count')
            .first()
            .then(r => r.count)
        },
        my_feedback: {
          rating: guestFeedback.find(f => f.feedback_type === 'rating')?.rating,
          liked: !!guestFeedback.find(f => f.feedback_type === 'like'),
          favorited: !!guestFeedback.find(f => f.feedback_type === 'favorite')
        }
      });
    } catch (error) {
      logger.error('Error getting photo feedback:', error);
      res.status(500).json({ error: 'Failed to get feedback' });
    }
  }
);

// Submit feedback for a photo
router.post('/:slug/photos/:photoId/feedback',
  verifyGalleryAccess,
  validatePhotoId,
  validateFeedbackSubmission,
  checkValidation,
  async (req, res) => {
    try {
      const { photoId } = req.params;
      const event = req.event;
      const guestIdentifier = generateGuestIdentifier(req);
      
      // Get feedback settings
      const settings = await feedbackService.getEventFeedbackSettings(event.id);
      
      if (!settings.feedback_enabled) {
        return res.status(403).json({ error: 'Feedback is not enabled for this event' });
      }
      
      // Check if specific feedback type is allowed
      const feedbackType = req.body.feedback_type;
      const typeAllowed = {
        rating: settings.allow_ratings,
        like: settings.allow_likes,
        comment: settings.allow_comments,
        favorite: settings.allow_favorites
      };
      
      if (!typeAllowed[feedbackType]) {
        return res.status(403).json({ error: `${feedbackType} feedback is not enabled` });
      }
      
      // Verify photo belongs to event
      const photo = await db('photos')
        .where({ id: photoId, event_id: event.id })
        .first();
      
      if (!photo) {
        return res.status(404).json({ error: 'Photo not found' });
      }
      
      // Validate guest requirements
      const guestValidation = await validateGuestRequirements(settings, req.body);
      if (!guestValidation.valid) {
        return res.status(400).json({ 
          error: 'Guest information required',
          errors: guestValidation.errors 
        });
      }
      
      // Apply rate limiting based on feedback type
      const rateLimitMiddleware = feedbackRateLimit(feedbackType);
      await new Promise((resolve, reject) => {
        rateLimitMiddleware(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      // If we got here and response was sent (rate limited), return
      if (res.headersSent) return;
      
      // Prepare feedback data
      const feedbackData = {
        feedback_type: feedbackType,
        rating: req.body.rating,
        comment_text: req.body.comment_text,
        guest_name: req.body.guest_name,
        guest_email: req.body.guest_email,
        ip_address: req.ip || req.connection.remoteAddress,
        user_agent: req.headers['user-agent'],
        moderate_comments: settings.moderate_comments
      };
      
      // For comments, check moderation
      if (feedbackType === 'comment') {
        // Check user reputation
        const reputation = await feedbackModeration.checkUserReputation(guestIdentifier, event.id);
        
        // Moderate the comment
        const moderationResult = await feedbackModeration.moderateText(req.body.comment_text);
        
        if (!moderationResult.approved) {
          // Still save but mark as not approved
          feedbackData.is_approved = false;
          logger.warn('Comment flagged for moderation:', {
            reason: moderationResult.reason,
            violations: moderationResult.violations
          });
        } else if (reputation.autoApprove) {
          // Trusted user, auto-approve
          feedbackData.is_approved = true;
        } else if (settings.moderate_comments) {
          // Default moderation setting
          feedbackData.is_approved = false;
        }
      }
      
      // Submit feedback
      const result = await feedbackService.submitFeedback(
        photoId,
        event.id,
        feedbackData,
        guestIdentifier
      );
      
      // Log activity. actor_id is an integer column (admin user id when
      // actor_type='admin') - guest actions have no integer id, so this was
      // previously passing a hex string here, which the insert silently
      // rejected and dropped every guest feedback notification.
      await logActivity(`guest_feedback_${feedbackType}`, {
        photo_id: photoId,
        guest_identifier: guestIdentifier.substring(0, 16),
        result
      }, event.id, {
        type: 'guest',
        id: null,
        name: req.body.guest_name || 'Anonymous'
      });
      
      res.json({
        success: true,
        ...result,
        message: feedbackType === 'comment' && !feedbackData.is_approved ? 
          'Your comment has been submitted for moderation' : undefined
      });
    } catch (error) {
      logger.error('Error submitting feedback:', error);
      res.status(500).json({ error: 'Failed to submit feedback' });
    }
  }
);

// Get feedback summary for entire gallery
router.get('/:slug/feedback-summary',
  verifyGalleryAccess,
  async (req, res) => {
    try {
      const event = req.event;
      
      // Get feedback settings
      const settings = await feedbackService.getEventFeedbackSettings(event.id);
      
      if (!settings.feedback_enabled || !settings.show_feedback_to_guests) {
        return res.json({
          enabled: false,
          summary: null
        });
      }
      
      const summary = await feedbackService.getEventFeedbackSummary(event.id);
      
      // Filter data based on what guests should see
      const guestSummary = {
        stats: summary.stats,
        top_rated: summary.photos
          .filter(p => p.average_rating > 0)
          .slice(0, 5)
          .map(p => ({
            id: p.id,
            filename: p.filename,
            average_rating: p.average_rating,
            like_count: p.like_count
          }))
      };
      
      res.json({
        enabled: true,
        settings: {
          allow_ratings: settings.allow_ratings,
          allow_likes: settings.allow_likes,
          allow_comments: settings.allow_comments,
          allow_favorites: settings.allow_favorites
        },
        summary: guestSummary
      });
    } catch (error) {
      logger.error('Error getting feedback summary:', error);
      res.status(500).json({ error: 'Failed to get feedback summary' });
    }
  }
);

// Get user's own feedback for all photos
router.get('/:slug/my-feedback',
  verifyGalleryAccess,
  async (req, res) => {
    try {
      const event = req.event;
      const guestIdentifier = generateGuestIdentifier(req);
      
      const myFeedback = await db('photo_feedback')
        .join('photos', 'photo_feedback.photo_id', 'photos.id')
        .where('photo_feedback.event_id', event.id)
        .where('photo_feedback.guest_identifier', guestIdentifier)
        .select(
          'photo_feedback.*',
          'photos.filename',
          'photos.path'
        )
        .orderBy('photo_feedback.created_at', 'desc');
      
      res.json(myFeedback);
    } catch (error) {
      logger.error('Error getting user feedback:', error);
      res.status(500).json({ error: 'Failed to get your feedback' });
    }
  }
);

// Submit a final photo selection - snapshots the guest's currently favorited
// photos into a locked record, distinct from ad-hoc favoriting which can keep
// changing. This is what notifies the photographer which photos to work from.
router.post('/:slug/selections/submit',
  verifyGalleryAccess,
  async (req, res) => {
    try {
      const event = req.event;
      const guestIdentifier = generateGuestIdentifier(req);
      const guestName = (req.body.guest_name || '').trim();
      const guestEmail = (req.body.guest_email || '').trim();
      const notes = (req.body.notes || '').trim();

      const settings = await feedbackService.getEventFeedbackSettings(event.id);
      if (!settings.feedback_enabled || !settings.allow_favorites) {
        return res.status(403).json({ error: 'Photo selection is not enabled for this gallery' });
      }

      // A name is always required for a submitted selection, even if the
      // event doesn't require identity for casual likes - the photographer
      // needs to know whose final picks these are.
      if (!guestName) {
        return res.status(400).json({ error: 'Please enter your name so we know whose selection this is' });
      }

      const favorited = await db('photo_feedback')
        .join('photos', 'photo_feedback.photo_id', 'photos.id')
        .where({
          'photo_feedback.event_id': event.id,
          'photo_feedback.guest_identifier': guestIdentifier,
          'photo_feedback.feedback_type': 'favorite'
        })
        .select('photos.id');

      if (favorited.length === 0) {
        return res.status(400).json({ error: 'Favorite at least one photo before submitting your selection' });
      }

      const insertResult = await db('gallery_selections')
        .insert({
          event_id: event.id,
          guest_identifier: guestIdentifier,
          guest_name: guestName.slice(0, 100),
          guest_email: guestEmail ? guestEmail.slice(0, 255) : null,
          notes: notes ? notes.slice(0, 2000) : null,
          photo_count: favorited.length,
          submitted_at: new Date()
        })
        .returning('id');
      const selectionId = insertResult[0]?.id || insertResult[0];

      await db('gallery_selection_photos').insert(
        favorited.map(p => ({ selection_id: selectionId, photo_id: p.id }))
      );

      // actor_id is an integer column (admin user id when actor_type='admin');
      // guest actions have no integer id, so leave it null - only actor_name
      // identifies the guest here.
      await logActivity('guest_selection_submitted', {
        selection_id: selectionId,
        photo_count: favorited.length
      }, event.id, {
        type: 'guest',
        id: null,
        name: guestName
      });

      res.json({
        success: true,
        selection: {
          id: selectionId,
          photo_count: favorited.length,
          submitted_at: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Error submitting gallery selection:', error);
      res.status(500).json({ error: 'Failed to submit selection' });
    }
  }
);

// Get the current guest's most recent submitted selection, if any, so
// returning visitors see their submitted state instead of a blank slate.
router.get('/:slug/selections/mine',
  verifyGalleryAccess,
  async (req, res) => {
    try {
      const event = req.event;
      const guestIdentifier = generateGuestIdentifier(req);

      const selection = await db('gallery_selections')
        .where({ event_id: event.id, guest_identifier: guestIdentifier })
        .orderBy('submitted_at', 'desc')
        .first();

      if (!selection) {
        return res.json({ selection: null });
      }

      const photos = await db('gallery_selection_photos')
        .join('photos', 'gallery_selection_photos.photo_id', 'photos.id')
        .where('gallery_selection_photos.selection_id', selection.id)
        .select('photos.id', 'photos.filename');

      res.json({
        selection: {
          id: selection.id,
          photo_count: selection.photo_count,
          submitted_at: selection.submitted_at,
          notes: selection.notes,
          photos
        }
      });
    } catch (error) {
      logger.error('Error getting selection:', error);
      res.status(500).json({ error: 'Failed to get your selection' });
    }
  }
);

module.exports = router;