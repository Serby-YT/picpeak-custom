/**
 * Migration 075: Add hover-preview clip path to photos table
 * - photos.preview_path: path to the short muted montage played on hover
 *   (desktop) or when the tile scrolls into view (mobile). Videos only.
 */

const { addColumnIfNotExists } = require('../helpers');

exports.up = async function(knex) {
  console.log('Running migration: 075_add_preview_path');

  // photos.preview_path (nullable - only videos ever get one)
  await addColumnIfNotExists(knex, 'photos', 'preview_path', (table) => {
    table.string('preview_path', 512);
  });

  console.log('Migration 075_add_preview_path completed');
};

exports.down = async function(knex) {
  console.log('Rollback: 075_add_preview_path');
  // Keep columns (safe rollback not removing data). Intentionally no-op.
};
