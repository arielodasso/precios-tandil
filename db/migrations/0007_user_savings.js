'use strict';

/**
 * Contador de ahorro agregado de los tandilenses.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS "user_savings" (
      "device_id" text NOT NULL,
      "savings_amount" numeric DEFAULT 0 NOT NULL,
      "item_count" integer DEFAULT 0 NOT NULL,
      "updated_at" timestamptz DEFAULT now() NOT NULL
    );
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'user_savings_pkey'
      ) THEN
        ALTER TABLE "user_savings" ADD CONSTRAINT "user_savings_pkey" PRIMARY KEY ("device_id");
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS "user_savings_updated_at_index" ON "user_savings" ("updated_at");
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('user_savings', { ifExists: true });
};
