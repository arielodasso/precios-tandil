/**
 * Resolución de categorías de la taxonomía local.
 *
 * La taxonomía local usa slugs (ej: `almacen/arroz`, `lacteos/leches`, `bebidas/cervezas`)
 * mientras que los adapters reportan el path de categoría con los nombres
 * visibles de cada tienda (ej: `["Almacén","Arroz"]`, `["Lácteos","Leche"]`,
 * `["Higiene","Shampoo"]`). Por eso el match exacto nunca coincidía y los
 * productos quedaban con `category_id = null`.
 *
 * Este módulo mapea esos tokens de tienda (y, en última instancia, el nombre
 * del producto) a un path de la taxonomía local.
 *
 * La estrategia de match por path usa tokens normalizados y busca la
 * coincidencia más específica (más profunda en la taxonomía).
 */

export interface CategoryRule {
  categoryPath: string;
  prefixes: string[];
}

// ---- Match por nombre de producto (fallback) ----
// Orden importa: el primero que matchea gana. Reglas más específicas primero.
const NAME_RULES: CategoryRule[] = [
  // ── Almacén sub-categorías (específicas primero) ──
  { categoryPath: 'almacen/arroz', prefixes: ['arroz'] },
  { categoryPath: 'almacen/aceite', prefixes: ['aceite'] },
  {
    categoryPath: 'almacen/azucar',
    prefixes: ['azucar', 'edulcorante', 'endulzan', 'stevia', 'sucralosa'],
  },
  { categoryPath: 'almacen/yerba', prefixes: ['yerba', 'mate cocido'] },
  {
    categoryPath: 'almacen/fideos',
    prefixes: [
      'fideo',
      'fideos',
      'pasta seca',
      'spaghetti',
      'tallarin',
      'tallarini',
      'ñoquis',
      'ravioles secos',
      'cintas',
    ],
  },
  { categoryPath: 'almacen/harinas', prefixes: ['harina', 'premezcla', 'polenta', 'maicena'] },
  { categoryPath: 'almacen/cafe', prefixes: ['cafe', 'cafecito', 'espresso', 'moka'] },
  {
    categoryPath: 'almacen/galletitas',
    prefixes: ['galletita', 'galletitas', 'cookie', 'sobao', 'avana'],
  },
  {
    categoryPath: 'almacen/snacks',
    prefixes: [
      'snack',
      'snacks',
      'papas fritas',
      'palitos',
      'bastoncitos',
      'popcorn',
      'maní',
      'nuez',
      'almendra',
    ],
  },
  {
    categoryPath: 'almacen/condimentos',
    prefixes: [
      'condimento',
      'condimentos',
      'pimienta',
      'orégano',
      'comino',
      'curry',
      'paprika',
      'aji molido',
    ],
  },
  {
    categoryPath: 'almacen/salsas',
    prefixes: ['salsa', 'ketchup', 'mayonesa', 'mostaza', 'aderezo', 'mayonesa'],
  },
  {
    categoryPath: 'almacen/conservas',
    prefixes: [
      'conserva',
      'atún',
      'atun',
      'tomate triturado',
      'pure de tomate',
      'verduras enlatadas',
    ],
  },
  {
    categoryPath: 'almacen/infusiones',
    prefixes: ['te ', 'te,', 'te:', 'infusion', 'infusiones', 'capuccino', 'chocolate en polvo'],
  },
  {
    categoryPath: 'almacen/chocolates',
    prefixes: ['chocolate', 'bonbon', 'bombon', 'caramelo', 'caramelo', 'gomita', 'gominola'],
  },
  {
    categoryPath: 'almacen/cereales',
    prefixes: ['cereal', 'avena', 'granola', 'muesli', 'fruta seca'],
  },
  {
    categoryPath: 'almacen/reposteria',
    prefixes: ['levadura', 'vanillina', 'colorante', 'decoracion', 'cobertura', 'merengue'],
  },

  // ── Bebidas sub-categorías ──
  { categoryPath: 'bebidas/gaseosas', prefixes: ['gaseosa', 'cola', 'soda', 'sprite', 'fanta'] },
  { categoryPath: 'bebidas/aguas', prefixes: ['agua', 'agua saborizada'] },
  { categoryPath: 'bebidas/jugos', prefixes: ['jugo', 'jugo', 'nectar', 'extracto'] },
  {
    categoryPath: 'bebidas/cervezas',
    prefixes: ['cerveza', 'cervezas', 'stout', 'lager', 'ipa', 'amber'],
  },
  {
    categoryPath: 'bebidas/vinos',
    prefixes: ['vino', 'vinos', 'malbec', 'cabernet', 'chardonnay', 'merlot'],
  },
  {
    categoryPath: 'bebidas/bebidas-alcoholicas',
    prefixes: [
      'fernet',
      'whisky',
      'whiskey',
      'ginebra',
      'ron',
      'vodka',
      'licor',
      'brandy',
      'sangria',
      'champan',
      'champaña',
      'espumante',
    ],
  },
  {
    categoryPath: 'bebidas/isotonicas',
    prefixes: ['isotonico', 'energizante', 'powerade', 'gatorade', 'red bull'],
  },

  // ── Lácteos sub-categorías ──
  { categoryPath: 'lacteos/leches', prefixes: ['leche'] },
  { categoryPath: 'lacteos/yogures', prefixes: ['yogur', 'yoghurt', 'yogurt', 'yogurisimo'] },
  {
    categoryPath: 'lacteos/quesos',
    prefixes: [
      'queso',
      'quesos',
      'muzzarella',
      'mozzarella',
      'parmesano',
      'cottage',
      'ricotta',
      'cream cheese',
    ],
  },
  { categoryPath: 'lacteos/manteca', prefixes: ['manteca', 'margarina'] },
  { categoryPath: 'lacteos/dulce-de-leche', prefixes: ['dulce de leche'] },
  {
    categoryPath: 'lacteos/postres-frescos',
    prefixes: ['postre', 'flan', 'budin', 'crema pastelera', 'tiramisu', 'mousse'],
  },
  { categoryPath: 'lacteos', prefixes: ['lacteo', 'lacteos'] },

  // ── Frescos sub-categorías ──
  {
    categoryPath: 'frescos/carnes',
    prefixes: [
      'carne',
      'cerdo',
      'pollo',
      'milanesa',
      'hamburguesa',
      'salchicha',
      'chorizo',
      'jamon',
      'bondiola',
      'nalga',
      'peceto',
      'cuadrada',
      'roast beef',
      'panceta',
      'matambre',
      'costillas',
      'pollo entero',
      'pechuga',
    ],
  },
  {
    categoryPath: 'frescos/fiambres',
    prefixes: [
      'fiambre',
      'fiambres',
      'mortadela',
      'salamin',
      'salame',
      'lomito',
      'panceta',
      'jamon cocido',
      'jamon crudo',
    ],
  },
  {
    categoryPath: 'frescos/panaderia',
    prefixes: [
      'pan ',
      'pan,',
      'pan:',
      'panificado',
      'bizcochito',
      'factura',
      'chipa',
      'medialuna',
      'gato negro',
      'sacha',
      'pan de miga',
      'tostado',
    ],
  },
  {
    categoryPath: 'frescos/pastas-frescas',
    prefixes: ['pastas frescas', 'raviol', 'sorrentinos', 'ñoquis frescos'],
  },
  {
    categoryPath: 'frescos/frutas-y-verduras',
    prefixes: [
      'verdura',
      'fruta',
      'lechuga',
      'papa',
      'cebolla',
      'banana',
      'tomate',
      'zanahoria',
      'zapallo',
      'berenjena',
      'pimiento',
      'apio',
      'pepino',
      'naranja',
      'manzana',
      'pera',
      'uva',
      'limon',
      'mandarina',
    ],
  },
  { categoryPath: 'frescos/huevos', prefixes: ['huevo', 'huevos'] },
  {
    categoryPath: 'frescos/pescados',
    prefixes: [
      'pescado',
      'salmón',
      'salmon',
      'merluza',
      'atun fresco',
      'camaron',
      'langostinos',
      'mariscos',
    ],
  },
  { categoryPath: 'frescos', prefixes: ['fresco', 'frescos', 'fresca'] },

  // ── Congelados sub-categorías ──
  { categoryPath: 'congelados/helados', prefixes: ['helado', 'helados', 'sorbetes', 'gelato'] },
  {
    categoryPath: 'congelados/verduras-congeladas',
    prefixes: [
      'verdura congelada',
      'verduras congeladas',
      'arvejas congeladas',
      'espárragos congelados',
      'maíz congelado',
    ],
  },
  {
    categoryPath: 'congelados/congelados-preparados',
    prefixes: [
      'congelado preparado',
      'empanada congelada',
      'nuggets',
      'papas fritas congeladas',
      'prepizza',
      'pizza congelada',
      'tarta congelada',
    ],
  },
  { categoryPath: 'congelados', prefixes: ['congelado', 'congelados', 'freezer'] },

  // ── Limpieza sub-categorías ──
  { categoryPath: 'limpieza/detergentes', prefixes: ['detergente', 'lavavajilla'] },
  { categoryPath: 'limpieza/lavandinas', prefixes: ['lavandina', 'cloro', 'lejia'] },
  {
    categoryPath: 'limpieza/higiene-del-hogar',
    prefixes: [
      'limpiador',
      'limpia',
      'desengrasante',
      'prod. limpieza',
      'aromatizante',
      'insecticida',
      'papel higienico',
    ],
  },
  {
    categoryPath: 'limpieza/bolsas',
    prefixes: ['bolsa de residuo', 'bolsas de residuo', 'bolsa basura'],
  },
  {
    categoryPath: 'limpieza',
    prefixes: [
      'suavizante',
      'suavizantes',
      'desodorante de ambientes',
      'esponja',
      'trapo',
      'escoba',
      'palita',
    ],
  },

  // ── Perfumería sub-categorías ──
  {
    categoryPath: 'perfumeria/cuidado-cabello',
    prefixes: ['shampoo', 'shampu', 'acondicionador', 'mascarilla capilar', 'tinte'],
  },
  {
    categoryPath: 'perfumeria/cuidado-corporal',
    prefixes: ['jabon', 'crema corporal', 'locion', 'aceite corporal', 'exfoliante'],
  },
  {
    categoryPath: 'perfumeria/higiene-bucal',
    prefixes: ['dentifrico', 'pasta dental', 'enjuague bucal', 'hilo dental', 'cepillo de dientes'],
  },
  { categoryPath: 'perfumeria/desodorantes', prefixes: ['desodorante', 'antitranspirante'] },
  {
    categoryPath: 'perfumeria/pañales',
    prefixes: ['pañal', 'pañales', 'toallitas húmedas', 'leche bebe', 'formula'],
  },
  {
    categoryPath: 'perfumeria',
    prefixes: ['perfume', 'colonial', 'after shave', 'algodon', 'hisopo'],
  },

  // ── Mascotas ──
  {
    categoryPath: 'mascotas',
    prefixes: [
      'gato',
      'perro',
      'mascota',
      'mascotas',
      'alimento gato',
      'alimento perro',
      'arena para gatos',
      'comedero',
    ],
  },
];

const NAME_DEFAULT = 'almacen';

/** Normaliza un token: minúsculas y sin acentos. */
export function normalizeToken(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Devuelve el path de taxonomía según el nombre del producto. */
export function matchCategoryByName(name: string): string {
  const n = normalizeToken(name);
  for (const rule of NAME_RULES) {
    if (rule.prefixes.some((p) => n.startsWith(p))) return rule.categoryPath;
  }
  return NAME_DEFAULT;
}

// ---- Match por path de categoría de la tienda ----
// path de taxonomía -> tokens normalizados que lo identifican.
// Se ordenan de más específico a menos específico para que el match
// más profundo gane (gracias al rank por profundidad del path).
const STORE_ALIASES: Array<{ path: string; tokens: string[] }> = [
  // ── Almacén sub-categorías ──
  { path: 'almacen/aceite', tokens: ['aceite', 'aceites', 'aceites-y-vinagres', 'vinagres'] },
  { path: 'almacen/arroz', tokens: ['arroz', 'arroces', 'arroz-y-legumbres', 'legumbres'] },
  {
    path: 'almacen/azucar',
    tokens: ['azucar', 'edulcorante', 'edulcorantes', 'azucar-y-edulcorantes'],
  },
  {
    path: 'almacen/yerba',
    tokens: ['yerba', 'yerbas', 'yerba-y-infusiones', 'mate', 'infusiones'],
  },
  {
    path: 'almacen/fideos',
    tokens: ['fideos', 'fideo', 'pastas', 'pasta', 'fideos-y-pastas', 'pastas-secas'],
  },
  {
    path: 'almacen/harinas',
    tokens: ['harinas', 'harina', 'premezclas', 'harinas-y-premezclas', 'prepizza', 'panificados'],
  },
  { path: 'almacen/cafe', tokens: ['cafe', 'café', 'cafes', 'cafetería'] },
  { path: 'almacen/galletitas', tokens: ['galletitas', 'galletita', 'galletas', 'cookies'] },
  { path: 'almacen/snacks', tokens: ['snacks', 'snack', 'picadas', 'papas-fritas'] },
  { path: 'almacen/condimentos', tokens: ['condimentos', 'condimento', 'especias', 'especia'] },
  {
    path: 'almacen/salsas',
    tokens: ['salsas', 'salsa', 'aderezos', 'aderezo', 'mayonesa', 'ketchup', 'mostaza'],
  },
  { path: 'almacen/conservas', tokens: ['conservas', 'conserva', 'enlatados', 'enlatado'] },
  {
    path: 'almacen/infusiones',
    tokens: ['te', 'infusiones', 'infusion', 'te-y-infusiones', 'capuccino'],
  },
  {
    path: 'almacen/chocolates',
    tokens: ['chocolates', 'chocolate', 'bombones', 'caramelos', 'dulces'],
  },
  { path: 'almacen/cereales', tokens: ['cereales', 'cereal', 'avena', 'granola', 'frutas-secas'] },
  { path: 'almacen/reposteria', tokens: ['reposteria', 'repostería', 'reposteros', 'decoracion'] },
  { path: 'almacen', tokens: ['almacen', 'almacén', 'despensa', 'alimentos'] },

  // ── Bebidas sub-categorías ──
  { path: 'bebidas/gaseosas', tokens: ['gaseosa', 'gaseosas', 'soda', 'refrescos'] },
  { path: 'bebidas/aguas', tokens: ['agua', 'aguas', 'aguas-saborizadas'] },
  { path: 'bebidas/jugos', tokens: ['jugos', 'jugo', 'nectares', 'extractos', 'jugos-y-nectares'] },
  { path: 'bebidas/cervezas', tokens: ['cerveza', 'cervezas', 'cerveceria'] },
  {
    path: 'bebidas/vinos',
    tokens: ['vino', 'vinos', 'vinos-y-espumantes', 'espumantes', 'vino-tinto', 'vino-blanco'],
  },
  {
    path: 'bebidas/bebidas-alcoholicas',
    tokens: [
      'bebidas-alcoholicas',
      'licores',
      'licor',
      'fernet',
      'whisky',
      'ginebra',
      'ron',
      'vodka',
      'brandy',
      'sangria',
      'champagne',
    ],
  },
  {
    path: 'bebidas/isotonicas',
    tokens: ['isotonicas', 'isotonico', 'energizantes', 'energizante', 'bebidas-energeticas'],
  },
  { path: 'bebidas', tokens: ['bebida', 'bebidas', 'aguas'] },

  // ── Lácteos sub-categorías ──
  { path: 'lacteos/leches', tokens: ['leches', 'leche'] },
  { path: 'lacteos/yogures', tokens: ['yogures', 'yogur', 'yoghurt', 'yogurt'] },
  {
    path: 'lacteos/quesos',
    tokens: ['quesos', 'queso', 'fiambres', 'fiambre', 'fiambreria', 'quesos-y-fiambres'],
  },
  { path: 'lacteos/manteca', tokens: ['manteca', 'margarina'] },
  { path: 'lacteos/dulce-de-leche', tokens: ['dulce-de-leche'] },
  {
    path: 'lacteos/postres-frescos',
    tokens: ['postres', 'postre', 'flanes', 'flan', 'dulces-cremosos'],
  },
  { path: 'lacteos', tokens: ['lacteo', 'lacteos', 'lácteos'] },

  // ── Frescos sub-categorías ──
  {
    path: 'frescos/carnes',
    tokens: [
      'carnes',
      'carne',
      'carniceria',
      'carnicería',
      'polleria',
      'pollería',
      'cerdo',
      'pollo',
      'vacuno',
      'carnes-y-pescados',
    ],
  },
  {
    path: 'frescos/fiambres',
    tokens: ['fiambres', 'fiambre', 'fiambreria', 'fiambrería', 'embutidos'],
  },
  {
    path: 'frescos/panaderia',
    tokens: ['panaderia', 'panadería', 'panificados', 'pan', 'bollería', 'bolleria'],
  },
  {
    path: 'frescos/pastas-frescas',
    tokens: ['pastas-frescas', 'pastas_frescas', 'pastas frescas', 'pasta-fresca'],
  },
  {
    path: 'frescos/frutas-y-verduras',
    tokens: [
      'frutas',
      'verduras',
      'frutas-y-verduras',
      'verduleria',
      'verdulería',
      'frutas-y-verduras-y-hierbas',
      'fruteria',
    ],
  },
  { path: 'frescos/huevos', tokens: ['huevos', 'huevo'] },
  {
    path: 'frescos/pescados',
    tokens: ['pescados', 'pescado', 'mariscos', 'pescados-y-mariscos', 'pescadería'],
  },
  { path: 'frescos/rotiseria', tokens: ['rotiseria', 'rotisería', 'roti'] },
  { path: 'frescos', tokens: ['frescos', 'fresco', 'fresca'] },

  // ── Congelados sub-categorías ──
  { path: 'congelados/helados', tokens: ['helados', 'helado', 'heladeria'] },
  {
    path: 'congelados/verduras-congeladas',
    tokens: ['verduras-congeladas', 'verduras congeladas'],
  },
  {
    path: 'congelados/congelados-preparados',
    tokens: [
      'congelados-preparados',
      'congelados preparados',
      'empanadas-congeladas',
      'pizzas-congeladas',
    ],
  },
  { path: 'congelados', tokens: ['congelado', 'congelados', 'freezer', 'freezers'] },

  // ── Limpieza sub-categorías ──
  { path: 'limpieza/detergentes', tokens: ['detergentes', 'detergente', 'lavavajillas'] },
  { path: 'limpieza/lavandinas', tokens: ['lavandinas', 'lavandina', 'cloro'] },
  {
    path: 'limpieza/higiene-del-hogar',
    tokens: [
      'higiene-del-hogar',
      'higiene del hogar',
      'limpieza-del-hogar',
      'limpieza de cocina',
      'limpieza-de-bano',
      'prod-limpieza',
      'aromatizantes',
    ],
  },
  { path: 'limpieza/bolsas', tokens: ['bolsas', 'bolsas-de-residuo', 'residuos'] },
  {
    path: 'limpieza',
    tokens: ['limpieza', 'lavanderia', 'suavizantes', 'suavizante', 'casa-y-jardin', 'hogar'],
  },

  // ── Perfumería sub-categorías ──
  {
    path: 'perfumeria/cuidado-cabello',
    tokens: [
      'cuidado-cabello',
      'cuidado-del-cabello',
      'cuidado-e-higiene-cabello',
      'cabello',
      'shampoo',
    ],
  },
  {
    path: 'perfumeria/cuidado-corporal',
    tokens: ['cuidado-corporal', 'cuidado-de-cuerpo', 'cuerpo', 'cuidado-de-la-piel'],
  },
  {
    path: 'perfumeria/higiene-bucal',
    tokens: ['higiene-bucal', 'higiene bucal', 'cuidado-bucal', 'cuidado dental'],
  },
  { path: 'perfumeria/desodorantes', tokens: ['desodorantes', 'desodorante'] },
  {
    path: 'perfumeria/pañales',
    tokens: [
      'pañales',
      'pañal',
      'bebes',
      'bebés',
      'mundo-bebe',
      'mundo bebe',
      'bebes-y-ninos',
      'baby',
    ],
  },
  {
    path: 'perfumeria',
    tokens: [
      'perfumeria',
      'perfumería',
      'belleza',
      'cuidado-personal',
      'higiene-personal',
      'tocador',
      'maquillaje',
    ],
  },

  // ── Mascotas ──
  {
    path: 'mascotas',
    tokens: ['mascotas', 'mascota', 'mascots', 'pet', 'perro', 'gato', 'alimento-mascotas'],
  },
];

/** Devuelve el path de taxonomía a partir del path de categoría de la tienda. */
export function matchCategoryByStorePath(categoryPath: string[] | undefined): string | null {
  if (!categoryPath || categoryPath.length === 0) return null;
  const normed = categoryPath.map(normalizeToken).filter(Boolean);
  let best: { path: string; rank: number } | null = null;
  for (const alias of STORE_ALIASES) {
    for (const token of alias.tokens) {
      const hit = normed.some((t) => t === token || t.includes(token) || token.includes(t));
      if (hit) {
        const rank = alias.path.split('/').length;
        if (!best || rank > best.rank) best = { path: alias.path, rank };
      }
    }
  }
  return best?.path ?? null;
}
