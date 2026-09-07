'use strict';

/**
 * Contador de ahorro agregado de los tandilenses.
 *
 * Cada usuario (identificado por un device_id anónimo generado en el cliente)
 * reporta su ahorro actual calculado con su lista. La tabla guarda el último
 * ahorro reportado por usuario y el dashboard suma todos los montos para
 * mostrar "cuánto llevan ahorrado los tandilenses" con información real.
 *
 * Idempotente y seguro de mantener: cada POST hace un UPSERT por device_id.
 */

exports.up = (pgm) => {
  pgm.createTable(
    'user_savings',
    {
      device_id: { type: 'text', notNull: true },
      savings_amount: { type: 'numeric', notNull: true, default: 0 },
      item_count: { type: 'integer', notNull: true, default: 0 },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
    { ifNotExists: true },
  );
  pgm.addConstraint('user_savings', 'user_savings_pkey', {
    primaryKey: ['device_id'],
    ifNotExists: true,
  });
  pgm.createIndex('user_savings', ['updated_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('user_savings', { ifExists: true });
};
