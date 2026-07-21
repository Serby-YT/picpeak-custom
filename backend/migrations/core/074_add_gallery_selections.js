/**
 * Migration 074: Add gallery selections (client proofing)
 * - gallery_selections: a snapshot of a guest's final photo picks at the
 *   moment they submit, distinct from ad-hoc favoriting which can keep
 *   changing after the fact
 * - gallery_selection_photos: the specific photo IDs captured in that
 *   snapshot
 */

const { createTableIfNotExists } = require('../helpers');

exports.up = async function(knex) {
  console.log('Running migration: 074_add_gallery_selections');

  await createTableIfNotExists(knex, 'gallery_selections', (table) => {
    table.increments('id').primary();
    table.integer('event_id').references('id').inTable('events').onDelete('CASCADE');
    table.string('guest_identifier', 64).notNullable();
    table.string('guest_name', 100).notNullable();
    table.string('guest_email', 255);
    table.text('notes');
    table.integer('photo_count').defaultTo(0);
    table.timestamp('submitted_at').defaultTo(knex.fn.now());

    table.index(['event_id']);
    table.index(['guest_identifier']);
  });

  await createTableIfNotExists(knex, 'gallery_selection_photos', (table) => {
    table.increments('id').primary();
    table.integer('selection_id').references('id').inTable('gallery_selections').onDelete('CASCADE');
    table.integer('photo_id').references('id').inTable('photos').onDelete('CASCADE');

    table.index(['selection_id']);
    table.index(['photo_id']);
  });

  console.log('Migration 074_add_gallery_selections completed');
};

exports.down = async function(knex) {
  console.log('Rollback: 074_add_gallery_selections');
  await knex.schema.dropTableIfExists('gallery_selection_photos');
  await knex.schema.dropTableIfExists('gallery_selections');
};
