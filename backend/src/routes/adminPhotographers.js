/**
 * Admin routes for photographer credits.
 *
 * A saved list of other photographers (name, portfolio link, default role) and,
 * per gallery, which of them are credited and under what role. Galleries show
 * the credits in the hero, linking to each portfolio.
 */

const express = require("express");
const router = express.Router();
const { db } = require("../database/db");
const { adminAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/permissions");
const logger = require("../utils/logger");

const NAME_MAX = 100;
const URL_MAX = 500;
const ROLE_MAX = 60;

function cleanText(value, max) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

// Only absolute http(s) links: anything else (javascript:, data:, relative)
// would end up as an href on a public gallery page.
function cleanUrl(value) {
  const raw = cleanText(value, URL_MAX + 1);
  if (!raw || raw.length > URL_MAX) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || !url.hostname.includes(".")) return null;
    return url.toString();
  } catch (e) {
    return null;
  }
}

function validatePhotographer(body) {
  const name = cleanText(body.name, NAME_MAX + 1);
  const portfolioUrl = cleanUrl(body.portfolio_url);
  const defaultRole = cleanText(body.default_role, ROLE_MAX);
  if (!name) return { error: "Name is required" };
  if (name.length > NAME_MAX) return { error: `Name must be at most ${NAME_MAX} characters` };
  if (!portfolioUrl) return { error: "Portfolio link must be a valid http(s) address" };
  return { value: { name, portfolio_url: portfolioUrl, default_role: defaultRole || null } };
}

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Saved list, with how many galleries credit each one
router.get("/", adminAuth, requirePermission("events.view"), async (req, res) => {
  try {
    const photographers = await db("photographers as p")
      .leftJoin("event_photographers as ep", "ep.photographer_id", "p.id")
      .groupBy("p.id")
      .select("p.id", "p.name", "p.portfolio_url", "p.default_role")
      .count({ gallery_count: "ep.id" })
      .orderByRaw("lower(p.name) asc");
    res.json({
      photographers: photographers.map(p => ({ ...p, gallery_count: Number(p.gallery_count) || 0 }))
    });
  } catch (error) {
    logger.error("Error listing photographers:", error);
    res.status(500).json({ error: "Failed to load photographers" });
  }
});

router.post("/", adminAuth, requirePermission("events.edit"), async (req, res) => {
  try {
    const { value, error } = validatePhotographer(req.body || {});
    if (error) return res.status(400).json({ error });
    const [row] = await db("photographers").insert(value).returning("id");
    const id = typeof row === "object" ? row.id : row;
    const photographer = await db("photographers").where("id", id).first();
    res.status(201).json({ photographer });
  } catch (error) {
    logger.error("Error creating photographer:", error);
    res.status(500).json({ error: "Failed to create photographer" });
  }
});

router.put("/:id", adminAuth, requirePermission("events.edit"), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid photographer id" });
    const { value, error } = validatePhotographer(req.body || {});
    if (error) return res.status(400).json({ error });
    const updated = await db("photographers").where("id", id).update({ ...value, updated_at: new Date() });
    if (!updated) return res.status(404).json({ error: "Photographer not found" });
    const photographer = await db("photographers").where("id", id).first();
    res.json({ photographer });
  } catch (error) {
    logger.error("Error updating photographer:", error);
    res.status(500).json({ error: "Failed to update photographer" });
  }
});

// Removes them from the saved list and from every gallery that credited them
router.delete("/:id", adminAuth, requirePermission("events.edit"), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid photographer id" });
    const removed = await db.transaction(async (trx) => {
      await trx("event_photographers").where("photographer_id", id).del();
      return trx("photographers").where("id", id).del();
    });
    if (!removed) return res.status(404).json({ error: "Photographer not found" });
    res.json({ success: true });
  } catch (error) {
    logger.error("Error deleting photographer:", error);
    res.status(500).json({ error: "Failed to delete photographer" });
  }
});

async function loadEventCredits(eventId) {
  return db("event_photographers as ep")
    .join("photographers as p", "p.id", "ep.photographer_id")
    .where("ep.event_id", eventId)
    .orderBy([{ column: "ep.sort_order", order: "asc" }, { column: "ep.id", order: "asc" }])
    .select("p.id as photographer_id", "p.name", "p.portfolio_url", "ep.role");
}

// Who is credited on one gallery
router.get("/events/:eventId", adminAuth, requirePermission("events.view"), async (req, res) => {
  try {
    const eventId = parseId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: "Invalid event id" });
    const event = await db("events").where("id", eventId).first("id");
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json({ credits: await loadEventCredits(eventId) });
  } catch (error) {
    logger.error("Error loading event photographers:", error);
    res.status(500).json({ error: "Failed to load gallery photographers" });
  }
});

// Replace the whole credit list of one gallery: [{ photographer_id, role }], in display order
router.put("/events/:eventId", adminAuth, requirePermission("events.edit"), async (req, res) => {
  try {
    const eventId = parseId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: "Invalid event id" });
    const list = req.body && req.body.credits;
    if (!Array.isArray(list) || list.length > 20) {
      return res.status(400).json({ error: "credits must be a list of at most 20 entries" });
    }

    const seen = new Set();
    const rows = [];
    for (const [index, item] of list.entries()) {
      const photographerId = parseId(item && item.photographer_id);
      if (!photographerId) return res.status(400).json({ error: "Each credit needs a photographer_id" });
      if (seen.has(photographerId)) continue;
      seen.add(photographerId);
      rows.push({
        event_id: eventId,
        photographer_id: photographerId,
        role: cleanText(item.role, ROLE_MAX) || null,
        sort_order: index
      });
    }

    const event = await db("events").where("id", eventId).first("id");
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (rows.length) {
      const found = await db("photographers").whereIn("id", [...seen]).pluck("id");
      if (found.length !== seen.size) return res.status(400).json({ error: "Unknown photographer" });
    }

    await db.transaction(async (trx) => {
      await trx("event_photographers").where("event_id", eventId).del();
      if (rows.length) await trx("event_photographers").insert(rows);
    });
    res.json({ credits: await loadEventCredits(eventId) });
  } catch (error) {
    logger.error("Error saving event photographers:", error);
    res.status(500).json({ error: "Failed to save gallery photographers" });
  }
});

module.exports = router;
module.exports.cleanUrl = cleanUrl;
module.exports.loadEventCredits = loadEventCredits;
