/**
 * Migration 076: Photographer credits
 * - photographers: a saved list of other photographers/videographers
 *   (name + portfolio link + default role), typed once and reused, so a
 *   corrected link updates every gallery that credits them
 * - event_photographers: which of them are credited on which gallery, with
 *   a per-gallery role and display order
 */

const { createTableIfNotExists } = require("../helpers");

exports.up = async function(knex) {
  console.log("Running migration: 076_add_photographers");

  await createTableIfNotExists(knex, "photographers", (table) => {
    table.increments("id").primary();
    table.string("name", 100).notNullable();
    table.string("portfolio_url", 500).notNullable();
    table.string("default_role", 60);
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());
  });

  await createTableIfNotExists(knex, "event_photographers", (table) => {
    table.increments("id").primary();
    table.integer("event_id").notNullable().references("id").inTable("events").onDelete("CASCADE");
    table.integer("photographer_id").notNullable().references("id").inTable("photographers").onDelete("CASCADE");
    table.string("role", 60);
    table.integer("sort_order").defaultTo(0);

    table.index(["event_id"]);
    table.unique(["event_id", "photographer_id"]);
  });

  console.log("Migration 076_add_photographers completed");
};

exports.down = async function(knex) {
  console.log("Rollback: 076_add_photographers");
  await knex.schema.dropTableIfExists("event_photographers");
  await knex.schema.dropTableIfExists("photographers");
};
