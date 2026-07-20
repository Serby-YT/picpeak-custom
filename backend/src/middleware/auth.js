const jwt = require('jsonwebtoken');
const { db } = require('../database/db');
const { formatBoolean } = require('../utils/dbCompat');
const { isTokenRevoked } = require('../utils/tokenRevocation');
const logger = require('../utils/logger');
const { getAdminTokenFromRequest, getGalleryTokenFromRequest } = require('../utils/tokenUtils');

/**
 * Core admin token verification, shared by the adminAuth middleware and the
 * /auth/session endpoint. Having a single implementation makes it impossible
 * for the two to disagree about whether a token is valid - a prior asymmetry
 * here (session check looser than the real middleware) caused a login/dashboard
 * redirect loop: /session reported a token valid, the dashboard's own API calls
 * rejected the same token, and the two pages bounced off each other forever.
 */
async function resolveAdminToken(token, req = {}) {
  if (!token) {
    return { ok: false, status: 401, body: { error: 'No token provided' } };
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'picpeak-auth',
      complete: true
    });
    decoded = decoded.payload;
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return { ok: false, status: 401, body: { error: 'Token expired', code: 'TOKEN_EXPIRED' } };
    }
    logger.warn('Admin token failed verification', { reason: err.name, message: err.message });
    return { ok: false, status: 401, body: { error: 'Invalid token' } };
  }

  // Check if token is revoked
  if (await isTokenRevoked(decoded)) {
    logger.warn('Revoked token used', {
      userId: decoded.id,
      tokenType: decoded.type
    });
    return { ok: false, status: 401, body: { error: 'Token has been revoked', code: 'TOKEN_REVOKED' } };
  }

  // Verify token type
  if (decoded.type !== 'admin') {
    logger.warn('Non-admin token used for admin endpoint', {
      userId: decoded.id,
      tokenType: decoded.type
    });
    return { ok: false, status: 403, body: { error: 'Insufficient permissions' } };
  }

  // IP validation (optional - can be strict or just log)
  const currentIp = req.ip || req.connection?.remoteAddress;
  if (decoded.ip && currentIp && decoded.ip !== currentIp) {
    logger.warn('Token used from different IP', {
      userId: decoded.id,
      tokenIp: decoded.ip,
      currentIp: currentIp
    });
  }

  // Check if admin still exists and is active, including role info
  // Use try/catch to handle case where roles table doesn't exist yet (upgrade scenario)
  let admin;
  try {
    admin = await db('admin_users')
      .leftJoin('roles', 'roles.id', 'admin_users.role_id')
      .where({ 'admin_users.id': decoded.id, 'admin_users.is_active': formatBoolean(true) })
      .select(
        'admin_users.id',
        'admin_users.username',
        'admin_users.email',
        'admin_users.password_changed_at',
        'roles.id as role_id',
        'roles.name as role_name'
      )
      .first();
  } catch (joinError) {
    // Fallback: roles table may not exist yet during upgrade
    // Query without role join - user will have no role info but can still authenticate
    logger.debug('Roles table not available, falling back to basic auth', { error: joinError.message });
    admin = await db('admin_users')
      .where({ id: decoded.id, is_active: formatBoolean(true) })
      .select('id', 'username', 'email', 'password_changed_at')
      .first();
    if (admin) {
      admin.role_id = null;
      admin.role_name = 'super_admin'; // Assume super_admin for existing users during upgrade
    }
  }

  if (!admin) {
    logger.warn('Admin token valid but no matching active admin found', { userId: decoded.id });
    return { ok: false, status: 401, body: { error: 'Invalid token' } };
  }

  // Check if password was changed after token was issued
  if (admin.password_changed_at) {
    const passwordChangedTime = new Date(admin.password_changed_at).getTime() / 1000;
    if (decoded.iat < passwordChangedTime) {
      logger.warn('Token used after password change', { userId: decoded.id });
      return {
        ok: false,
        status: 401,
        body: { error: 'Token invalid due to password change', code: 'PASSWORD_CHANGED' }
      };
    }
  }

  return {
    ok: true,
    decoded,
    admin: {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      roleId: admin.role_id,
      roleName: admin.role_name
    }
  };
}

/**
 * Enhanced admin authentication middleware with revocation checking
 */
async function adminAuth(req, res, next) {
  try {
    const token = getAdminTokenFromRequest(req);
    const result = await resolveAdminToken(token, req);

    if (!result.ok) {
      return res.status(result.status).json(result.body);
    }

    // Add user info to request (enhanced with role)
    req.admin = result.admin;
    req.token = token; // Store token for potential revocation

    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * Enhanced gallery authentication middleware with revocation checking
 */
async function galleryAuth(req, res, next) {
  try {
    const slug = req.params?.slug || req.requestedSlug;
    const token = getGalleryTokenFromRequest(req, slug);
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'picpeak-auth',
        complete: true
      });
      decoded = decoded.payload;
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Session expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid session' });
    }
    
    // Check if token is revoked
    if (await isTokenRevoked(decoded)) {
      return res.status(401).json({ error: 'Session has been invalidated', code: 'TOKEN_REVOKED' });
    }
    
    // Verify token type
    if (decoded.type !== 'gallery') {
      return res.status(403).json({ error: 'Invalid access token' });
    }
    
    // Check if event still exists and is active
    const event = await db('events')
      .where({ 
        id: decoded.eventId, 
        is_active: true, 
        is_archived: false 
      })
      .first();
    
    if (!event) {
      return res.status(404).json({ error: 'Gallery not found or expired' });
    }
    
    // Check if gallery has expired (only if expires_at is set)
    // Galleries with null expires_at never expire
    if (event.expires_at && new Date(event.expires_at) < new Date()) {
      return res.status(410).json({
        error: 'Gallery has expired',
        code: 'GALLERY_EXPIRED'
      });
    }
    
    // Add event info to request
    req.event = event;
    req.galleryToken = decoded;
    req.token = token;
    
    next();
  } catch (error) {
    logger.error('Gallery auth middleware error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * Photo access authentication
 * Validates both admin and gallery tokens for photo access
 */
async function photoAuth(req, res, next) {
  try {
    const slug = req.params?.slug || req.requestedSlug;
    const token = getAdminTokenFromRequest(req) || getGalleryTokenFromRequest(req, slug);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Check if token is revoked
    if (await isTokenRevoked(decoded)) {
      return res.status(401).json({ error: 'Token has been revoked', code: 'TOKEN_REVOKED' });
    }

    // Allow both admin and gallery tokens
    if (decoded.type === 'admin') {
      const admin = await db('admin_users')
        .where({ id: decoded.id, is_active: formatBoolean(true) })
        .first();

      if (!admin) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      req.auth = { type: 'admin', user: admin };
    } else if (decoded.type === 'gallery') {
      const event = await db('events')
        .where({
          id: decoded.eventId,
          is_active: true,
          is_archived: false
        })
        .first();

      if (!event) {
        return res.status(404).json({ error: 'Gallery not found' });
      }

      // For gallery tokens, ensure they can only access their event's photos
      req.auth = { type: 'gallery', event: event };
    } else {
      return res.status(403).json({ error: 'Invalid token type' });
    }

    next();
  } catch (error) {
    logger.error('Photo auth middleware error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * Verify gallery access for specific operations
 */
async function verifyGalleryAccess(req, res, next) {
  try {
    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { eventId } = req.params;

    // Admins can access any gallery
    if (req.auth.type === 'admin') {
      return next();
    }

    // Gallery tokens can only access their own event
    if (req.auth.type === 'gallery') {
      if (req.auth.event.id !== parseInt(eventId)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      return next();
    }

    res.status(403).json({ error: 'Access denied' });
  } catch (error) {
    res.status(500).json({ error: 'Access verification failed' });
  }
}

module.exports = {
  adminAuth,
  galleryAuth,
  photoAuth,
  verifyGalleryAccess,
  resolveAdminToken
};
