# Setup notes for this fork

This is a customized fork of [PicPeak](https://github.com/the-luap/picpeak) — most fixes and
the redesign are baked into the code, but a few things are runtime settings you'll need to
configure yourself after first install (each admin's SMTP/domain differ, so these can't be
hardcoded).

## Getting it running

Follow PicPeak's own `SIMPLE_SETUP.md` / `DEPLOYMENT_GUIDE.md` in this repo — same install
process. Use `docker-compose.production.yml`; both `frontend` and `backend` now build from
source (no prebuilt images), so the fixes below are already active out of the box.

**Recommended exposure**: Cloudflare Tunnel (`cloudflared`), not direct port-forwarding —
no exposed ports, no public IP needed. Note: Cloudflare's proxy caps request bodies at
**100MB** — the upload code already batches under that, so uploads work correctly through
a tunnel without any changes needed.

## Settings to configure after first login (Admin → Settings)

- **SMTP** (Admin → Email Settings) — needed for gallery-created/expiry notification emails.
  A Gmail app-password works fine for low volume.
- **Allowed file types** — add video extensions if you want video upload support:
  `jpg,jpeg,png,gif,webp,mp4,m4v,mov,webm,avi` (default is images-only).

## Getting the redesigned look

Pick the **"Dark Modern"** theme preset when creating a gallery (Admin → new event → Theme).
It already has the full-bleed hero, Pinterest-style masonry (no cropping), Poppins font, and
tight letter-spacing baked in as the preset's defaults — no manual tweaking needed.

## What's different from upstream PicPeak

See the git log — two commits: one with all backend fixes + the frontend redesign, one
removing the upstream CI workflows (not applicable to a personal fork). Summary in the first
commit message.
