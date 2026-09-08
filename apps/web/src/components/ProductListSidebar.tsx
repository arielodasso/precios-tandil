'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Minus, Plus, Share2, ShoppingCart, Trash2, X } from 'lucide-react';
import { useProductList, type ListEntry, type ListStoreGroup } from './ProductListContext';
import { cn, formatUnit, titleCase } from '@/lib/utils';
import { formatArs } from './HistoryStrip';
import { siteUrl } from '@/lib/site';
import { ProductImage } from './ProductImage';

export function ProductListToggle() {
  const { items } = useProductList();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:border-alerta hover:text-alerta"
        aria-label={`Mi lista (${items.length} productos)`}
      >
        <ShoppingCart className="size-4" />
        <span className="hidden sm:inline">Mi lista</span>
        {items.length > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-alerta text-[10px] font-bold text-black">
            {items.length > 99 ? '99+' : items.length}
          </span>
        )}
      </button>
      {open && <ProductListSidebar onClose={() => setOpen(false)} />}
    </>
  );
}

function ProductListSidebar({ onClose }: { onClose: () => void }) {
  const { items, clear, totalSelected, savings, groupedByStore } = useProductList();

  if (typeof document === 'undefined') return null;

  const groups = [...groupedByStore].sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative flex h-full w-full max-w-md flex-col bg-yellow-100 text-stone-900 shadow-2xl animate-slide-in-right dark:bg-[#2E2A12] dark:text-[#F2E9C4]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Mi lista"
      >
        {/* Encabezado */}
        <div className="flex items-center justify-between border-b-2 border-yellow-300 px-4 py-3 dark:border-[#56502E]">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-stone-900 text-yellow-100 dark:bg-[#FDEC20] dark:text-[#1F1B07]">
              <ShoppingCart className="size-4" />
            </span>
            <h2 className="text-lg font-bold">Mi lista</h2>
            {items.length > 0 && (
              <span className="rounded-full bg-stone-900 px-2 py-0.5 text-xs font-bold text-yellow-100 dark:bg-[#FDEC20] dark:text-[#1F1B07]">
                {items.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-stone-600 transition-colors hover:bg-yellow-200 hover:text-stone-900 dark:text-[#C9BE90] dark:hover:bg-[#3D3820] dark:hover:text-[#FDEC20]"
            aria-label="Cerrar"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Agrupado por fuente elegida */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-stone-600 dark:text-[#B8AE82]">
              Tu lista está vacía. Agregá productos tocando el botón que aparece al lado del precio
              de cada fuente en los listados.
            </p>
          ) : (
            <div className="divide-y divide-yellow-200 dark:divide-[#3B3620]">
              {groups.map((group) => {
                const subtotal = group.entries.reduce((s, e) => s + e.price * e.quantity, 0);
                return (
                  <div key={group.name}>
                    <div className="flex items-center justify-between bg-yellow-200/70 px-4 py-2 dark:bg-[#3D3820]">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-[#F2E9C4]">
                          {group.name}
                        </span>
                        <span className="rounded bg-stone-900/10 px-1.5 py-0.5 text-[10px] font-bold text-stone-700 dark:bg-black/20 dark:text-[#C9BE90]">
                          {group.entries.length} {group.entries.length === 1 ? 'item' : 'items'}
                        </span>
                      </div>
                      <span className="text-xs font-bold text-stone-900 dark:text-[#FFE97A]">
                        {formatArs(subtotal)}
                      </span>
                    </div>
                    <ul className="divide-y divide-yellow-200 bg-yellow-100 dark:divide-[#3B3620] dark:bg-[#2E2A12]">
                      {group.entries.map((entry) => (
                        <EntryRow key={`${entry.slug}-${entry.store}`} entry={entry} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pie: total + ahorro */}
        {items.length > 0 && (
          <div className="border-t-2 border-yellow-300 bg-yellow-200/60 px-4 py-3 dark:border-[#56502E] dark:bg-[#3B3620]/60">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-stone-700 dark:text-[#C9BE90]">
                Total de tu lista
              </span>
              <span className="text-lg font-extrabold text-stone-900 dark:text-[#FFE97A]">
                {formatArs(totalSelected)}
              </span>
            </div>
            {savings > 0 && (
              <div className="mt-2">
                <p className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-sm font-bold text-white">
                  <ShoppingCart className="size-3.5" />
                  Con Precios Tandil ahorraste {formatArs(savings)}
                </p>
              </div>
            )}
            <ShareSavings
              savings={savings}
              totalSelected={totalSelected}
              groupedByStore={groupedByStore}
            />
            <button
              type="button"
              onClick={clear}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-stone-400/60 px-3 py-1.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-700 hover:text-white dark:border-[#6B633C] dark:text-red-400 dark:hover:bg-red-700 dark:hover:text-white"
            >
              <Trash2 className="size-3.5" />
              Limpiar lista
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ShareSavings({
  savings,
  totalSelected,
  groupedByStore,
}: {
  savings: number;
  totalSelected: number;
  groupedByStore: ListStoreGroup[];
}) {
  const lines: string[] = [];
  lines.push('🛒 *Mi lista de compras en Precios Tandil*');

  for (const group of [...groupedByStore].sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
    const subtotal = group.entries.reduce((s, e) => s + e.price * e.quantity, 0);
    lines.push('');
    lines.push(`🏪 *${group.name}* — ${formatArs(subtotal)}`);
    for (const entry of group.entries) {
      const qty = entry.quantity > 1 ? `${entry.quantity} x ` : '';
      lines.push(
        `  • ${qty}${titleCase(entry.name)} — ${formatArs(entry.price * entry.quantity)} (${siteUrl(`/p/${entry.slug}`)})`,
      );
    }
  }

  lines.push('');
  lines.push(`🧾 *Total:* ${formatArs(totalSelected)}`);
  if (savings > 0) {
    lines.push(`✨ Ahorrás ${formatArs(savings)} comprando al mejor precio`);
  }
  lines.push('');
  lines.push(`Mirá los precios y compará acá 👉 ${siteUrl('/')}`);

  const text = lines.join('\n');
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;

  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Mi lista con Precios Tandil',
          text,
          url: siteUrl('/'),
        });
        return;
      } catch {
        /* usuario canceló o share no disponible */
      }
    }
  };

  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-stone-700 dark:text-[#C9BE90]">
        Compartí tu lista por WhatsApp:
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-[#25D366] px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#1fb457]"
          aria-label="Compartir mi lista por WhatsApp"
        >
          <WhatsAppIcon />
          WhatsApp
        </a>
        <button
          type="button"
          onClick={handleShare}
          className="inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-2.5 py-1.5 text-xs font-semibold text-yellow-100 transition-colors hover:bg-stone-700 dark:bg-[#FDEC20] dark:text-[#1F1B07] dark:hover:bg-[#F5E94B]"
          aria-label="Compartir mi lista (WhatsApp, Telegram, etc.)"
        >
          <Share2 className="size-3.5" />
          Compartir
        </button>
      </div>
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

function EntryRow({ entry }: { entry: ListEntry }) {
  const { remove, replace, setQuantity } = useProductList();
  const prices = entry.offers.map((o) => o.price).filter((p): p is number => p != null && p > 0);
  const best = prices.length > 0 ? Math.min(...prices) : null;
  const bestStore = best != null ? entry.offers.find((o) => o.price === best)?.store_name : null;
  const bestOffer = best != null ? entry.offers.find((o) => o.price === best) : null;
  const isBestPick = best != null && entry.price === best;
  const lineTotal = entry.price * entry.quantity;

  const handleSwitch = () => {
    if (!bestOffer) return;
    replace(entry.slug, entry.store, {
      slug: entry.slug,
      name: entry.name,
      brand: entry.brand,
      unit: entry.unit,
      image_url: entry.image_url,
      offers: entry.offers,
      store: bestOffer.store,
      store_name: bestOffer.store_name,
      price: bestOffer.price!,
      source_url: bestOffer.source_url ?? null,
      quantity: entry.quantity,
    });
  };

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-yellow-300 bg-white/80 dark:border-[#56502E] dark:bg-[#3A3523]">
        <ProductImage src={entry.image_url} alt={titleCase(entry.name)} />
      </div>
      <div className="min-w-0 flex-1">
        {entry.source_url ? (
          <a
            href={entry.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-start gap-1 text-sm font-semibold leading-snug text-stone-800 transition-colors hover:text-yellow-600 dark:text-[#F2E9C4] dark:hover:text-[#FDEC20]"
          >
            <span className="line-clamp-2">{titleCase(entry.name)}</span>
            <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-60" />
          </a>
        ) : (
          <p className="line-clamp-2 text-sm font-semibold leading-snug">{titleCase(entry.name)}</p>
        )}
        <p className="mt-0.5 text-xs text-stone-600 dark:text-[#C9BE90]/80">
          {[entry.brand, entry.unit ? formatUnit(entry.unit) : null].filter(Boolean).join(' · ')}
        </p>
        {best != null && !isBestPick && bestStore && bestOffer && (
          <button
            type="button"
            onClick={handleSwitch}
            className="mt-1.5 block w-full rounded bg-emerald-800/10 px-2 py-1 text-left text-[11px] leading-snug font-medium text-emerald-700 transition-colors hover:bg-emerald-800/20 dark:bg-emerald-400/10 dark:text-emerald-400 dark:hover:bg-emerald-400/20"
            aria-label={`Cambiar a la mejor fuente: ${bestStore}`}
          >
            Mejor: <span className="font-bold underline underline-offset-2">{formatArs(best)}</span>{' '}
            en <span className="font-bold underline underline-offset-2">{bestStore}</span>
          </button>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'whitespace-nowrap text-sm font-bold',
              isBestPick
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-stone-900 dark:text-[#FFE97A]',
            )}
          >
            {formatArs(lineTotal)}
          </span>
          <button
            type="button"
            onClick={() => remove(entry.slug, entry.store)}
            className="rounded p-1 text-stone-500 transition-colors hover:bg-red-700 hover:text-white dark:text-[#C9BE90]"
            aria-label={`Quitar ${entry.name} de la lista`}
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className="inline-flex items-center gap-1 rounded-md border border-yellow-400/70 bg-white/60 dark:border-[#6B633C] dark:bg-black/20">
          <button
            type="button"
            onClick={() => setQuantity(entry.slug, entry.store, entry.quantity - 1)}
            disabled={entry.quantity <= 1}
            className="px-1 py-0.5 text-stone-700 transition-colors hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-40 dark:text-[#F2E9C4] dark:hover:bg-[#3D3820]"
            aria-label={`Reducir cantidad de ${entry.name}`}
          >
            <Minus className="size-3" />
          </button>
          <span className="min-w-[1.25rem] text-center text-xs font-bold" aria-live="polite">
            {entry.quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity(entry.slug, entry.store, entry.quantity + 1)}
            className="px-1 py-0.5 text-stone-700 transition-colors hover:bg-yellow-300 dark:text-[#F2E9C4] dark:hover:bg-[#3D3820]"
            aria-label={`Aumentar cantidad de ${entry.name}`}
          >
            <Plus className="size-3" />
          </button>
        </div>
        <span className="text-[10px] text-stone-500 dark:text-[#B8AE82]">
          {formatArs(entry.price)} c/u
        </span>
      </div>
    </li>
  );
}
