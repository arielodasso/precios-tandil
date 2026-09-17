import type { UnitType } from '@precios/shared';

export interface NormalizeOptions {
  /** Marca declarada por la fuente (snap.brand). Tiene prioridad sobre la heurística. */
  brand?: string | null;
  /** Texto extendido de la fuente (descripción del producto) usado como contexto para tipos y similitud. */
  description?: string | null;
}

export interface NormalizedProduct {
  normName: string;
  tokens: string[];
  brand: string | null;
  brandProvided: boolean;
  unitAmount: number | null;
  unitType: UnitType | null;
  /** Cantidad de unidades idénticas detectada (null si no se manifiesta). 1 = unitario. */
  unitCount: number | null;
  /** Presentación multi-artículo (pack / más de una unidad idéntica). */
  isPack: boolean;
  /** Tipos de producto detectados (p.ej. ['arroz']) en orden de aparición en el texto. */
  typeKeys: string[];
  /** Primer tipo de producto detectado, o null. */
  primaryType: string | null;
  /** Palabras variante del producto (p.ej. 'max', 'fresh', 'plus', 'premium'). */
  variantFlags: string[];
  /** Texto de contexto (descripción + marca) normalizado, usado para similitud en caso de faltar nombre. */
  contextText: string;
  /** Texto completo normalizado (nombre + contexto), usado para detección de tipos. */
  fullText: string;
}

export interface ProductTypeDef {
  key: string;
  terms: readonly string[];
}

/** Vocabulario de tipos de producto para bloqueos duros y boosts por tipo. */
export const PRODUCT_TYPES: readonly ProductTypeDef[] = [
  { key: 'aceite', terms: ['aceite', 'aceites'] },
  { key: 'arroz', terms: ['arroz', 'arroces'] },
  { key: 'azucar', terms: ['azucar', 'edulcorante', 'edulcorantes', 'endulzante', 'endulzantes'] },
  { key: 'harina', terms: ['harina', 'harinas', 'premezcla', 'premezclas', 'fecula', 'maicena'] },
  {
    key: 'fideo',
    terms: [
      'fideo',
      'fideos',
      'tallarin',
      'tallarines',
      'espaguet',
      'mostachol',
      'codito',
      'coditos',
      'cabello angel',
      'ravioles',
    ],
  },
  { key: 'yerba', terms: ['yerba', 'yerbas'] },
  { key: 'leche', terms: ['leche', 'leches'] },
  { key: 'yogur', terms: ['yogur', 'yogurt', 'yoghurt'] },
  { key: 'queso', terms: ['queso', 'quesos', 'ricota'] },
  { key: 'manteca', terms: ['manteca'] },
  { key: 'mayonesa', terms: ['mayonesa', 'mayonesas'] },
  { key: 'aderezo', terms: ['aderezo', 'aderezos', 'alioli', 'mostaza', 'ketchup', 'salsa golf'] },
  { key: 'detergente', terms: ['detergente', 'detergentes', 'lavaplatos'] },
  { key: 'lavandina', terms: ['lavandina', 'lavandinas', 'cloro'] },
  { key: 'jabon', terms: ['jabon', 'jabones'] },
  { key: 'shampoo', terms: ['shampoo', 'shampoo'] },
  { key: 'acondicionador', terms: ['acondicionador', 'crema enjuague', 'enjuague'] },
  {
    key: 'dentifrico',
    terms: ['dentifrico', 'dentrifico', 'pasta dental', 'crema dental', 'pasta de dientes'],
  },
  { key: 'desodorante', terms: ['desodorante', 'desodorantes', 'deodorante'] },
  { key: 'gaseosa', terms: ['gaseosa', 'gaseosas', 'cola', 'limonada', 'tonica'] },
  { key: 'agua', terms: ['agua', 'aguas'] },
  { key: 'cerveza', terms: ['cerveza', 'cervezas'] },
  { key: 'vino', terms: ['vino', 'vinos', 'espumante'] },
  {
    key: 'galletita',
    terms: ['galletita', 'galletitas', 'cookie', 'cookies', 'wafer', 'crackers'],
  },
  { key: 'chocolate', terms: ['chocolate', 'chocolates'] },
  { key: 'cafe', terms: ['cafe', 'cafes'] },
  { key: 'té', terms: ['tes', 'te en hebras', 'te en saquitos', 'te suelto'] },
  {
    key: 'legumbre',
    terms: [
      'arveja',
      'arvejas',
      'lenteja',
      'lentejas',
      'poroto',
      'porotos',
      'garbanzo',
      'garbanzos',
      'legumbre',
      'legumbres',
      'polenta',
    ],
  },
];

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeNumber(n: string): number {
  return Number.parseFloat(n.replace(',', '.'));
}

const STOPWORDS = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'y',
  'en',
  'con',
  'para',
  'por',
  'un',
  'una',
  'x',
]);

const UNIT_ALIASES: Record<string, UnitType> = {
  kg: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kgs: 'kg',
  k: 'kg',
  g: 'g',
  gr: 'g',
  grs: 'g',
  gramo: 'g',
  gramos: 'g',
  l: 'l',
  lt: 'l',
  lts: 'l',
  litro: 'l',
  litros: 'l',
  ml: 'ml',
  cc: 'ml',
  cm3: 'ml',
  'cm³': 'ml',
  un: 'un',
  unid: 'un',
  unidad: 'un',
  unidades: 'un',
};

const UNIT_RE =
  /(?:x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|kilos?|kgs|k|g|grs?|gramos?|l|lts?|litros?|ml|cc|cm[³3]|unid\.?|unidades?)\b/gi;

const UNITLESS_X_RE = /\bx\s*(\d{1,3})\b/gi;

export interface PackInfo {
  /** Cantidad de unidades idénticas declarada (1 = unitario, null si no se manifiesta). */
  count: number | null;
  /** true si el texto manifiesta explícitamente cantidad de unidades o un pack. */
  declared: boolean;
  /** true si la presentación es multi-artículo (pack literal o más de una unidad). */
  isPack: boolean;
}

/** Contenedores "doypack"/"flexpack": NO son multipacks, se enmascaran. */
const PACK_FALSE_POSITIVE_RE = /\bdoy\s*pack(s)?\b|\bflex\s*pack(s)?\b/gi;

/**
 * "6x710ml", "10 x 100g", "3 x 80 gr" → N unidades de medida M por unidad.
 * El lookbehind evita que "alto x ancho x prof: 5.4 x 59 x 51 cm" (cadenas de
 * dimensiones) se interprete como 59 unidades.
 */
const PACK_MULTI_RE =
  /\b(?<!\bx\s?)(\d{1,3})\s*x\s*(\d+(?:[.,]\d+)?)\s*(ml|cc|cm[³3]?|g|grs?|gramos?|kg|kilos?|k|l|lts?|litros?)\b/i;

/** Cantidad de unidades: "4 un", "x 10 Un", "3 uni", "8uds", "40 unidades", "20saq". */
const PACK_UNITS_RE =
  /(?:\b|x)(\d{1,3})\s*(?:x\s*)?(?:un(?:idad(?:es)?|id\.?|i\.?|\.)?|uds?\.?|und\.?|u\.?|saq(?:u(?:ito)?s?)?)\b/i;

const SIX_PACK_RE = /\b(?:six|seis)\s+pack\b/i;

/** "pack 6", "pack de 10", "pack x 40" → cantidad explícita. */
const PACK_COUNT_RE = /[\s(]pack\s+(?:de\s+)?x?\s*([1-9]\d{0,2})\b/i;

/** "pack", "six pack" sueltos → multi-pack sin cantidad explícita. */
const PACK_WORD_RE = /[\s(](?:six\s+)?pack\b/i;

/**
 * Detecta presentaciones multi-artículo ("pack", "6x710ml", "4 unidades") para
 * que el matcher no mezcle una lata sola con una six-pack del mismo producto.
 * Cantidades de un único artículo (p.ej. "x500g", "x1K") no cuentan como pack.
 */
export function detectPackInfo(text: string): PackInfo {
  const masked = text.replace(PACK_FALSE_POSITIVE_RE, ' ');
  const hay = ` ${stripAccents(masked.trim().toLowerCase())} `;

  const multi = hay.match(PACK_MULTI_RE);
  if (multi) {
    const count = Number.parseInt(multi[1]!, 10);
    return { count, declared: true, isPack: count > 1 };
  }

  const units = hay.match(PACK_UNITS_RE);
  if (units) {
    const count = Number.parseInt(units[1]!, 10);
    return { count, declared: true, isPack: count > 1 };
  }

  if (SIX_PACK_RE.test(hay)) return { count: 6, declared: true, isPack: true };

  const countMatch = hay.match(PACK_COUNT_RE);
  if (countMatch) {
    const count = Number.parseInt(countMatch[1]!, 10);
    return { count, declared: true, isPack: count > 1 };
  }

  if (PACK_WORD_RE.test(hay)) return { count: null, declared: true, isPack: true };

  return { count: null, declared: false, isPack: false };
}

/**
 * Presentación agregada de un producto a partir de los nombres de sus SKUs
 * (los nombres describen el empaque real; las descripciones de marketing no).
 * Elige la declaración de pack más frecuente; si no hay ninguna, devuelve un
 * fallback sólo si éste declara pack, y en caso contrario "desconocido".
 */
export function aggregatePackInfo(
  names: ReadonlyArray<string | null | undefined>,
  fallback: string | null = null,
): PackInfo {
  const tally = new Map<string, { info: PackInfo; n: number }>();
  for (const name of names) {
    if (!name) continue;
    const info = detectPackInfo(name);
    const key = `${info.isPack ? 'P' : 'S'}:${info.count ?? 'x'}`;
    const existing = tally.get(key);
    if (existing) existing.n++;
    else tally.set(key, { info, n: 1 });
  }

  let best: { info: PackInfo; n: number } | null = null;
  for (const entry of tally.values()) {
    if (!best) {
      best = entry;
      continue;
    }
    if (entry.info.isPack && !best.info.isPack) {
      best = entry;
    } else if (entry.info.isPack === best.info.isPack && entry.n > best.n) {
      best = entry;
    }
  }

  if (best && best.info.declared) return best.info;
  if (fallback && detectPackInfo(fallback).isPack) return detectPackInfo(fallback);
  return { count: null, declared: false, isPack: false };
}

/** Detecta los tipos de producto presentes en `text` (sin acentos) ordenados por aparición. */
export function detectProductTypes(text: string): { keys: string[]; primary: string | null } {
  const hay = ` ${stripAccents(text.trim().toLowerCase())} `;
  const found: Array<{ key: string; pos: number }> = [];
  for (const type of PRODUCT_TYPES) {
    let minPos = Infinity;
    for (const term of type.terms) {
      const idx = hay.indexOf(` ${term} `);
      if (idx !== -1 && idx < minPos) minPos = idx;
    }
    if (minPos !== Infinity) found.push({ key: type.key, pos: minPos });
  }
  found.sort((a, b) => a.pos - b.pos);
  const keys = found.map((f) => f.key);
  return { keys, primary: keys[0] ?? null };
}

function tokenize(text: string): string[] {
  return text
    .replace(UNIT_RE, ' ')
    .replace(UNITLESS_X_RE, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+([.,]\d+)?$/.test(t));
}

/** Heurística de marca: primer token alfabético largo que no es un término de tipo de producto. */
function guessBrand(tokens: string[], typeKeys: string[]): string | null {
  const stopTerms = new Set(
    PRODUCT_TYPES.flatMap((t) => t.terms).map((t) => stripAccents(t.toLowerCase())),
  );
  for (const token of tokens) {
    if (!/^[a-z]{3,}$/.test(token)) continue;
    if (typeKeys.includes(token)) continue;
    if (stopTerms.has(token)) continue;
    if (NON_BRAND_WORDS.has(token)) continue;
    if (token === 'x') continue;
    return token;
  }
  return null;
}

/**
 * Palabras que describen el tipo/variante del producto y que, si difieren entre
 * dos descripciones, indican que NO son el mismo producto (p.ej. "Max" vs
 * "Fresh", "Simple" vs "Doble Hoja"). Se usan en el matcher para penalizar
 * cuando dos candidatos comparten marca pero tienen variantes distintas.
 */
export const VARIANT_WORDS: ReadonlySet<string> = new Set(
  `max maximo mini mini otra fresh fresco fresca frescas clasico clasica clasicas clasicos
   plus premium super ultra extra ligero ligera light zero cero originales original
   tradicional suave fuerte rejilla simple doble triple activo activa cuádruple
   familiar pack xl xxl grande chico chica pequeño pequeña mediano mediana
   odorless perfumado sin aroma con aroma menta anis clorofila rosas limonaceas
   caia sin olor citrus florar cedron hierba buena`
    .split(/\s+/)
    .map((t) => stripAccents(t.trim().toLowerCase()))
    .filter(Boolean),
);

/** Extrae las palabras variante presentes en los tokens (p.ej. 'max', 'fresh'). */
export function detectVariantFlags(tokens: string[]): string[] {
  const flags: string[] = [];
  for (const token of tokens) {
    const clean = stripAccents(token.trim().toLowerCase());
    if (VARIANT_WORDS.has(clean) && !flags.includes(clean)) flags.push(clean);
  }
  return flags;
}

/**
 * Palabras variante de "línea de producto" que son mutuamente excluyentes:
 * un mismo producto no puede ser "Max" y "Fresh", ni "Original" y "Plus" a la
 * vez. Si dos descripciones declaran flags exclusivos distintos, NO pueden ser
 * el mismo artículo aunque compartan otros flags estructurales (p.ej. "hoja
 * simple"). A diferencia de flags estructurales/de medida (simple, doble, con
 * aroma, grande...), una diferencia aquí es motivo de bloqueo duro.
 */
export const EXCLUSIVE_VARIANT_WORDS: ReadonlySet<string> = new Set(
  `max maximo minimo mini fresh fresca frescas fresco clasico clasica clasicas clasicos
   plus premium super ultra extra ligero ligera light zero cero originales original
   tradicional fuerte suave activo activa familiar economico economica recargable
   eco sustentable cero`
    .split(/\s+/)
    .map((t) => stripAccents(t.trim().toLowerCase()))
    .filter(Boolean),
);

/** Devuelve solo los flags de línea exclusivos presentes entre los flags dados. */
export function exclusiveVariantFlags(flags: string[]): string[] {
  return flags.filter((f) => EXCLUSIVE_VARIANT_WORDS.has(f));
}

/**
 * Palabras que describen el producto (nunca marcas) pero no alcanzan el umbral
 * de ser "tipo de producto". Evitan que la heurística las tome como marca
 * (p.ej. "puré", "tomate", "sal", "postre").
 */
const NON_BRAND_WORDS = new Set(
  `pure pure de tomate tomate salsas salsa pelado enteros clasico clasica clasicas clasicos
  tradicional suave intenso gourmet especial refinada refinado refinados comun comun
  polito multiuso multiusos liquido liq liquida liquidos gel crema cremoso cremosa
  aromatizado aromatizada integral light bajo en sodio cero sin sal sin tacc sin gluten
  neutro neutra negra negro blanca blanco amarillo verde rojo oro lila violeta super premium
  max maximo colchon medias fresco fresca dulce dulces salado salados salada saladas condimentado
  vitaminas proteina frutilla banana manzana uva limon naranja durazno ciruela mora frutos
  rojos tropical vainilla chocolate coco cereales integrales proteico energizante hidratante
  rehidratante clasico clasica perform extra vainillas tostados molido molida ristretto pastillas
  sobres sobre tabletas tabletas solucion gotas frasco frascos pote potes lata latas tarro tarros
  envase envases saquitos saquito hebras blend mezcla blend mezclas verde negro supersuave
  resistente antigrasa antibacterial desinfectante perfumado floral citrico herbal suavizante
  concentrado doypack botella litros mililitros gramos kilogramos pañal pañales toalla toallitas
  apósito algodon hisopo cepillo pasta cepillado bucal antifrizz reparacion reparador cabello
  cuerpo higiene hogar limpieza lavanderia aceite alcohol vinagre sal fina entrefina gruesa
  marinado condimento especias hierbas sabor sabores originales original clasica clasico
  con aceite arroz molinos ala marolio molinos 3 arroz integral dorado largo fino faribalde
  fideos tirabuzon coditos mostachol noodles fideo duros espinaca verduras tomates legumbres
  lentejas arvejas garbanzos porotos choclo atun cerdo vaca pollo lomo pechuga milanesa
  picada hamburguesas nuggets pan rallado rebozador harina de trigo maiz maicena almidon
  fecula mandioca prepizza premezcla bollo pan pago bocado pollo ovoides
  `
    .split(/\s+/)
    .map((t) => stripAccents(t.trim().toLowerCase()))
    .filter(Boolean),
);

export function normalizeDescription(raw: string, opts: NormalizeOptions = {}): NormalizedProduct {
  const clean = stripAccents(raw.toLowerCase());
  const descriptionClean = opts.description ? stripAccents(opts.description.toLowerCase()) : '';
  const brandClean = opts.brand ? stripAccents(opts.brand.toLowerCase()) : '';

  const fullText = [clean, brandClean, descriptionClean].join(' ').trim();
  const { keys: typeKeys, primary: primaryType } = detectProductTypes(fullText);

  let unitAmount: number | null = null;
  let unitType: UnitType | null = null;
  const quantityMatches = [...clean.matchAll(UNIT_RE)];
  if (quantityMatches.length > 0) {
    const last = quantityMatches[quantityMatches.length - 1]!;
    unitAmount = normalizeNumber(last[1]!);
    unitType = UNIT_ALIASES[last[2]!.toLowerCase()] ?? null;
  } else {
    const unitless = [...clean.matchAll(UNITLESS_X_RE)];
    if (unitless.length > 0) {
      const last = unitless[unitless.length - 1]!;
      unitAmount = Number.parseInt(last[1]!, 10);
      unitType = 'un';
    }
  }

  const tokens = tokenize(clean);
  const contextTokens = tokenize(
    brandClean && descriptionClean ? `${brandClean} ${descriptionClean}` : descriptionClean,
  );

  const brand = brandClean.length >= 2 ? brandClean : guessBrand(tokens, typeKeys);

  // La presentación (pack vs suelta) se detecta SOLO desde el nombre del artículo:
  // las descripciones de marketing suelen contener "pack"/dimensiones/medidas que
  // no describen el empaque real y generarían falsos positivos.
  const pack = detectPackInfo(`${clean} ${brandClean}`.trim());
  const contextText = contextTokens.join(' ');

  return {
    normName: tokens.join(' '),
    tokens,
    brand,
    brandProvided: Boolean(brandClean),
    unitAmount,
    unitType,
    unitCount: pack.count,
    isPack: pack.isPack,
    typeKeys,
    primaryType,
    variantFlags: detectVariantFlags(tokens),
    contextText,
    fullText,
  };
}
