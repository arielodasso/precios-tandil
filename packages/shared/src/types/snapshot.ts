import { z } from 'zod';

export const listOrPromoSchema = z.enum(['list', 'promo']);
export type ListOrPromo = z.infer<typeof listOrPromoSchema>;

export const unitTypeSchema = z.enum(['kg', 'g', 'l', 'ml', 'un']);
export type UnitType = z.infer<typeof unitTypeSchema>;

export const productSnapshotSchema = z.object({
  externalId: z.string().min(1),
  url: z.string().url(),
  rawDescription: z.string().min(1).max(500),
  ean: z
    .string()
    .regex(/^\d{13}$/)
    .optional(),
  brand: z.string().min(1).max(120).optional(),
  categoryPath: z.array(z.string().min(1)).optional(),
  unitLabel: z.string().max(60).optional(),
  price: z.object({
    amount: z.number().max(99_999_999),
    listOrPromo: listOrPromoSchema.default('list'),
    promoLabel: z.string().max(120).optional(),
    unitPrice: z.number().positive().optional(),
  }),
  imageUrl: z.string().url().optional(),
  capturedAt: z.string().datetime({ offset: true }),
});

export type ProductSnapshot = z.infer<typeof productSnapshotSchema>;
