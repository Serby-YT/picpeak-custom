import axios, { AxiosHeaders } from 'axios';
import {
  getActiveGallerySlug,
  getGalleryToken,
  inferGallerySlugFromLocation,
  resolveSlugFromRequestUrl,
} from '../utils/galleryAuthStorage';
import { getApiBaseUrl } from '../utils/url';

// Maintenance mode callback
let maintenanceModeCallback: ((enabled: boolean) => void) | null = null;

export const setMaintenanceModeCallback = (callback: (enabled: boolean) => void) => {
  maintenanceModeCallback = callback;
};

// Create axios instance
export const api = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Request interceptor: drop Content-Type for FormData payloads so the browser can set boundaries
api.interceptors.request.use(
  (config) => {
    if (config.data instanceof FormData) {
      delete config.headers?.['Content-Type'];
    }

    if (typeof window !== 'undefined') {
      const pathSlug = resolveSlugFromRequestUrl(config.url || '');
      const params = config.params as Record<string, unknown> | undefined;
      const paramSlug = typeof params?.slug === 'string' ? (params.slug as string) : null;

      const rawPath = (() => {
        if (!config.url) return '';
        try {
          if (config.url.startsWith('http://') || config.url.startsWith('https://')) {
            return new URL(config.url).pathname;
          }
        } catch (error) {
          return config.url;
        }
        return config.url;
      })();

      const pathname = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

      const isGalleryEndpoint = /^\/gallery\//.test(pathname)
        || /^\/secure-images\//.test(pathname)
        || /^\/auth\/gallery\//.test(pathname);

      const isGallerySessionCheck = pathname === '/auth/session'
        && (!!paramSlug || window.location.pathname.startsWith('/gallery/'));

      if (isGalleryEndpoint || isGallerySessionCheck) {
        const fallbackSlug = getActiveGallerySlug()
          || inferGallerySlugFromLocation();
        const slug = pathSlug || paramSlug || fallbackSlug;

        if (slug) {
          const token = getGalleryToken(slug);
          if (token) {
            if (!config.headers) {
              config.headers = new AxiosHeaders();
            }

            if (config.headers instanceof AxiosHeaders) {
              const existing = config.headers.get('Authorization');
              if (!existing) {
                config.headers.set('Authorization', `Bearer ${token}`);
              }
            } else {
              const headersRecord = config.headers as Record<string, string | undefined>;
              if (!headersRecord.Authorization) {
                headersRecord.Authorization = `Bearer ${token}`;
              }
            }
          }
        }
      }
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Guards against an admin-login/dashboard redirect loop: if the session check
// and a real admin API call ever disagree about whether the token is valid,
// each 401 would otherwise trigger another hard redirect, which re-triggers
// the same disagreement, forever. This caps it to one redirect per window.
const ADMIN_REDIRECT_GUARD_KEY = 'admin_401_redirect_at';
const ADMIN_REDIRECT_GUARD_WINDOW_MS = 5000;

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => {
    if (response.config?.url?.includes('/admin') && !response.config.url.includes('/public/')) {
      sessionStorage.removeItem(ADMIN_REDIRECT_GUARD_KEY);
    }
    return response;
  },
  (error) => {
    // Handle maintenance mode (503)
    if (error.response?.status === 503) {
      const isAdminRoute = error.config?.url?.includes('/admin');
      
      // Only trigger maintenance mode for non-admin routes or unauthenticated admin routes
      if (!isAdminRoute) {
        if (maintenanceModeCallback) {
          maintenanceModeCallback(true);
        }
      }
    }
    
    if (error.response?.status === 401) {
      // Check if it's an admin route (but not public endpoints)
      const isAdminRoute = error.config?.url?.includes('/admin') && !error.config?.url?.includes('/public/');
      const currentPath = window.location.pathname;
      
      if (isAdminRoute) {
        // Only redirect if we're not already on the admin login page
        if (!currentPath.includes('/admin/login')) {
          const lastRedirect = Number(sessionStorage.getItem(ADMIN_REDIRECT_GUARD_KEY) || 0);
          if (Date.now() - lastRedirect > ADMIN_REDIRECT_GUARD_WINDOW_MS) {
            sessionStorage.setItem(ADMIN_REDIRECT_GUARD_KEY, String(Date.now()));
            window.location.href = '/admin/login?session=expired';
          }
          // else: we already redirected here moments ago and bounced straight
          // back to a 401 - stop reloading and let this error surface normally
          // instead of spinning forever.
        }
      } else {
        // For gallery routes, check if the error is from a gallery API call
        const galleryMatch = error.config?.url?.match(/\/gallery\/([^\/]+)/);
        
        // Check if this is an image request (photo or thumbnail)
        const isImageRequest = error.config?.url?.match(/\/(photo|thumbnail)\/\d+$/);
        
        // Don't redirect if we're on any gallery page (to avoid redirect loops during login)
        if (currentPath.startsWith('/gallery/')) {
          // Don't clear tokens for image requests - they might just need a retry
          if (!isImageRequest && galleryMatch && galleryMatch[1]) {
            const gallerySlug = galleryMatch[1];
            sessionStorage.removeItem(`gallery_event_${gallerySlug}`);
          }
          // Don't redirect - let the component handle the auth state
        } else if (galleryMatch) {
          // We're not on a gallery page but got a 401 from a gallery API
          // This shouldn't happen in normal flow, but if it does, redirect to homepage
          window.location.href = '/';
        }
      }
    }

    return Promise.reject(error);
  }
);
