import { api } from '../config/api';
import type { GalleryInfo, GalleryData, GalleryStats, ResolvedGalleryIdentifier } from '../types';
import { normalizeRequirePassword } from '../utils/accessControl';
import { buildResourceUrl } from '../utils/url';

export const galleryService = {
  // Verify share token
  async verifyToken(slug: string, token: string): Promise<{ valid: boolean }> {
    const response = await api.get<{ valid: boolean }>(`/gallery/${slug}/verify-token/${token}`);
    return response.data;
  },

  // Get basic gallery info (no auth required)
  async getGalleryInfo(slug: string, token?: string): Promise<GalleryInfo> {
    const params = token ? { token } : {};
    const response = await api.get<GalleryInfo>(`/gallery/${slug}/info`, { params });
    const data = response.data;
    return {
      ...data,
      requires_password: normalizeRequirePassword((data as any)?.requires_password, true),
    };
  },

  // Get gallery photos (requires auth)
  async getGalleryPhotos(
    slug: string,
    filter?: 'liked' | 'favorited' | 'commented' | 'rated' | 'all',
    guestId?: string
  ): Promise<GalleryData> {
    const params: any = {};
    if (filter && filter !== 'all') {
      params.filter = filter;
      if (guestId) {
        params.guest_id = guestId;
      }
    }
    const response = await api.get<GalleryData>(`/gallery/${slug}/photos`, { params });
    const data = response.data;
    const normalizedEvent = data?.event
      ? {
          ...data.event,
          require_password: normalizeRequirePassword((data.event as any)?.require_password, true),
        }
      : data.event;
    return {
      ...data,
      event: normalizedEvent,
    };
  },

  // Download single photo
  async downloadPhoto(slug: string, photoId: number, filename: string): Promise<void> {
    try {
      const response = await api.get(`/gallery/${slug}/download/${photoId}`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      // Fallback: use the view endpoint if direct download fails (e.g., missing original)
      try {
        const response = await api.get(`/gallery/${slug}/photo/${photoId}`, {
          responseType: 'blob',
        });
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      } catch (fallbackErr) {
        throw fallbackErr;
      }
    }
  },

  // Download all photos as ZIP
  async downloadAllPhotos(slug: string): Promise<void> {
    // Hand the URL to the browser rather than buffering the archive ourselves.
    //
    // This used to fetch the whole zip with responseType: 'blob' and save it
    // from an object URL, which fails on a phone in two different ways. iOS
    // Safari has a per-tab memory ceiling far below the size of a real gallery,
    // so a ~500MB archive never completes at all. And the Blob was built with
    // no MIME type, so Android's download manager could not confirm the bytes
    // matched the .zip name and appended .txt to it.
    //
    // A direct request streams to disk with no ceiling, and the server's own
    // Content-Type and Content-Disposition decide the type and the filename.
    // The gallery token rides along as a SameSite=Lax cookie, which is sent on
    // a top-level request like this one, so it stays authenticated without the
    // Authorization header the axios client would normally add.
    const link = document.createElement('a');
    link.href = buildResourceUrl(`/api/gallery/${encodeURIComponent(slug)}/download-all`);
    // No value: let Content-Disposition name the file. The attribute is still
    // needed so a non-attachment error response downloads harmlessly instead of
    // navigating the visitor out of the gallery.
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    link.remove();
  },

  // Download selected photos as ZIP
  async downloadSelectedPhotos(slug: string, photoIds: number[]): Promise<void> {
    const response = await api.post(`/gallery/${slug}/download-selected`, { photo_ids: photoIds }, {
      responseType: 'blob',
    });

    // Typed explicitly: an untyped Blob is what made Android append .txt to
    // the filename. This path still buffers, because the selected ids travel
    // in a POST body and so cannot be a plain link, but a selection is a
    // handful of photos rather than the whole gallery.
    const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${slug}-selected.zip`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },

  // Get gallery statistics
  async getGalleryStats(slug: string): Promise<GalleryStats> {
    const response = await api.get<GalleryStats>(`/gallery/${slug}/stats`);
    return response.data;
  },

  async resolveIdentifier(identifier: string): Promise<ResolvedGalleryIdentifier> {
    const response = await api.get<ResolvedGalleryIdentifier>(`/gallery/resolve/${identifier}`);
    return response.data;
  },
};
