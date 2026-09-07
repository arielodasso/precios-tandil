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
  // ── Desambiguaciones que ganan sobre electrodomésticos ──
  // "tableta", "lavavajillas" y "dolce gusto" son ambiguos: la máquina vs el consumible.
  {
    categoryPath: 'limpieza/detergentes',
    prefixes: [
      'lavavajillas concentrado',
      'lavavajillas limon',
      'lavavajillas tabletas',
      'sun lavavajillas',
      'tableta lavavajillas',
      'tabletas lavavajillas',
    ],
  },
  {
    categoryPath: 'almacen/cafe',
    prefixes: [
      'dolce gusto chocochino',
      'dolce gusto lungo',
      'dolce gusto decafeinado',
      'dolce gusto descafeinado',
      'dolce gusto frappe',
      'dolce gusto latte',
    ],
  },
  {
    categoryPath: 'limpieza/higiene-del-hogar',
    prefixes: [
      'tabletas insecticidas',
      'tabletas insecticida',
      'tabletas raid',
      'tabletas ahuyenta',
      'tableta fuyi',
      'raid aparato tab',
      'raid aparato',
    ],
  },
  {
    categoryPath: 'perfumeria/higiene-bucal',
    prefixes: [
      'tableta limpiadora',
      'tabletas limpiadoras',
      'tabletitas limpiadoras',
      'limpiador protesis',
      'tab limpiador protesis',
    ],
  },
  // ── Electrodomésticos y tecnología ──
  // Van antes que todo: 'cafetera'/'espresso' deben ganar sobre 'almacen/cafe',
  // y evitan que estos productos caigan en 'almacen' (default) o 'almacen/infusiones'.
  {
    categoryPath: 'electrodomesticos',
    prefixes: [
      // Frío / lavado
      'heladera',
      'freezer',
      'frigobar',
      'refrigerador',
      'frider',
      'lavarropas',
      'lavavajillas',
      'secarropas',
      'lavadora',
      'secadora',
      // Cocción
      'anafe',
      'microondas',
      'hornalla',
      'cocina electrica',
      'horno electrico',
      'horno microondas',
      'micro hormito',
      'campana extractora',
      'extractor de aire',
      'campana cocina',
      // Pequeños de cocina
      'licuadora',
      'licuad',
      'batidora',
      'minipimer',
      'mini pimer',
      'mixer',
      'procesadora',
      'juguera',
      'exprimidor',
      'sandwichera',
      'tostadora',
      'pava electrica',
      'pava eléctrica',
      'pava electric',
      'pava electrica',
      'freidora',
      'airfryer',
      'air fryer',
      'fryer',
      'balanza cocina digital',
      'balanza digital cocina',
      // Cafeteras (máquinas). SIN 'cafetera', 'dolce gusto'/'nespresso'/'espresso'
      // puede ser café o cápsulas → las desambiguaciones de arriba se encargan
      // (ej. 'dolce gusto chocochino x10u capsula' → almacen/cafe).
      'cafetera',
      'cafeteras',
      'espresso',
      'expresso',
      'nespresso',
      'dolce gusto',
      'maquina de cafe',
      // Clima
      'ventilador',
      'calefactor',
      'caloventor',
      'aire acondicionado',
      'aireacondicionado',
      'estufa electrica',
      'estufa a gas',
      'calefaccion',
      'pistola de calor',
      'tira de calor',
      'estufa',
      // Planchado
      'plancha',
      'planchita',
      'vaporizador de ropa',
      // Limpieza de pisos
      'aspiradora',
      'robot aspiradora',
      'robot limpiador',
      // Electrónica
      'televisor',
      'smart tv',
      'smarttv',
      'televicion',
      'lcd',
      'led tv',
      // 'tablet ' (con espacio): los dispositivos se escriben con la forma inglesa
      // ("Tablet Samsung Galaxy Tab..."). 'tableta'/'tabletas' (femenino) es casi
      // siempre chocolate o insecticida → va a almacen/chocolates o limpieza.
      'tablet ',
      'tableta grafica',
      'tableta graficas',
      'tableta digitalizadora',
      'ipad',
      'apple ipad',
      'apple iphone',
      'iphone',
      'samsung galaxy',
      'celular',
      'smartphone',
      'telefono',
      'parlante',
      'auricular',
      'auriculares',
      'monitor',
      'notebook',
      'computadora',
      'computadora',
      'cargador',
      'smartwatch',
      'reloj inteligente',
      'videojuego',
      'consola',
      'playstation',
      'xbox',
      'nintendo',
      'impresora',
      'router',
      'camara',
      'webcam',
      'proyector',
    ],
  },
  // ── Desambiguaciones de alto riesgo (van antes que todo) ──
  // "tableta(s)" en femenino casi siempre es chocolate/tableta de repostería.
  // El único electro femenino real es la tableta gráfica (ya resuelto arriba) y
  // las tabletas insecticidas/dentales/lavavajillas (resueltas al inicio).
  {
    categoryPath: 'almacen/chocolates',
    prefixes: ['tableta', 'tabletas', 'tabletitas'],
  },
  { categoryPath: 'perfumeria/cuidado-corporal', prefixes: ['agua micelar'] },
  { categoryPath: 'almacen/condimentos', prefixes: ['nuez moscada'] },
  { categoryPath: 'mascotas', prefixes: ['snack para gato', 'snack para perro'] },
  {
    categoryPath: 'perfumeria/cuidado-cabello',
    prefixes: ['mousse para el cabello', 'mousse cabello', 'mousse ondas'],
  },
  { categoryPath: 'almacen/chocolates', prefixes: ['huevo rosa', 'huevo kinder'] },
  {
    categoryPath: 'congelados/congelados-preparados',
    prefixes: ['milanesa de carne rebozada congelada', 'milanesa de carne congelada'],
  },
  {
    categoryPath: 'congelados/congelados-preparados',
    prefixes: ['bocadito de pollo', 'bocaditos de pollo'],
  },
  { categoryPath: 'almacen/chocolates', prefixes: ['bocadito', 'bocaditos'] },
  // Papas marca/snack vs papa fresca
  { categoryPath: 'almacen/snacks', prefixes: ['papas pringles', 'papas lays', 'papas ruffles'] },
  {
    categoryPath: 'congelados/congelados-preparados',
    prefixes: [
      'papas tradicionales',
      'papas smiles',
      'papas baston',
      'papas golazo',
      'papas horneables',
      'papas freezer',
      'papas mc cain',
    ],
  },
  { categoryPath: 'limpieza/higiene-del-hogar', prefixes: ['toallitas desinfectantes'] },
  { categoryPath: 'perfumeria', prefixes: ['toallitas femeninas', 'toallitas desmaquillantes'] },
  {
    categoryPath: 'almacen/conservas',
    prefixes: ['lomito de atun', 'lomitos de atun', 'lomo de atun', 'lomos de atun'],
  },
  {
    categoryPath: 'congelados/congelados-preparados',
    prefixes: ['palito de pollo', 'palitos de pollo', 'palito pollo', 'palitos pollo'],
  },
  {
    categoryPath: 'almacen/conservas',
    prefixes: [
      'tomate lc',
      'tomates perita',
      'tomates cubeteado',
      'tomates cubeteados',
      'tomate en lata',
      'tomates en lata',
      'extracto simple tomate',
      'extracto simple de tomate',
      'extracto de tomate',
      'extracto tomate',
      'merluza puglisi',
    ],
  },
  {
    categoryPath: 'congelados/congelados-preparados',
    prefixes: [
      'milanesa de soja',
      'milanesa soja',
      'milanesa vegetal',
      'milanesa de vegetales',
      'milanesa granja del sol',
    ],
  },
  {
    categoryPath: 'limpieza/higiene-del-hogar',
    prefixes: ['desodorante glade', 'desodorante despertar'],
  },
  { categoryPath: 'almacen/cafe', prefixes: ['infusion a base de cafe', 'infusion base cafe'] },

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
  {
    categoryPath: 'almacen/prepizzas',
    prefixes: ['prepizza', 'pre-pizza', 'masa pizza', 'masa para pizza'],
  },
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
      'pimienton',
      'pimenton',
      'orégano',
      'comino',
      'curry',
      'paprika',
      'aji molido',
      'zanahoria deshidratada',
      'cebolla deshidratada',
      'verdura deshidratada',
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
      'tomate perita',
      'tomate cubeteado',
      'tomate cubetado',
      'cubeteado',
      'cubetado',
      'merluza en aceite',
      'merluza aceite',
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
    prefixes: [
      'levadura',
      'vanillina',
      'colorante',
      'decoracion',
      'cobertura',
      'merengue',
      'magdalena',
      'madale',
      'budin',
      'budines',
      'pastelito',
    ],
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
    prefixes: ['postre', 'flan', 'crema pastelera', 'tiramisu', 'mousse'],
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
      'bondiola',
      'nalga',
      'peceto',
      'cuadrada',
      'roast beef',
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
      'jamon',
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
      'panes ',
      'panificacion',
      'panificado',
      'bizcochito',
      'factura',
      'chipa',
      'medialuna',
      'gato negro',
      'sacha',
      'pan de miga',
      'tostado',
      'grisines',
      'grisin',
      'pastelito',
      'rebozador',
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
    categoryPath: 'frescos/rotiseria',
    prefixes: ['rotiseria', 'rotisería', 'rotisserie', 'vianda'],
  },
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
      'bocadito de pollo',
      'bocaditos de pollo',
      'patitas',
      'medallon',
      'supremita',
      'formita',
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
      'pano',
      'panuelo',
      'franela',
      'alcohol',
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
    prefixes: [
      'pañal',
      'pañales',
      'toallitas húmedas',
      'toallitas',
      'toallita',
      'toallas humedas',
      'leche bebe',
      'formula',
    ],
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

/** Normaliza un prefix de regla: minúsculas y sin acentos, pero conserva los
 *  espacios (un prefix con espacio de cierre tipo 'pan ' indica límite de palabra). */
function normalizePrefix(p: string): string {
  return p
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Devuelve el path de taxonomía según el nombre del producto. */
export function matchCategoryByName(name: string): string {
  const n = normalizeToken(name);
  for (const rule of NAME_RULES) {
    if (rule.prefixes.some((p) => n.startsWith(normalizePrefix(p)))) return rule.categoryPath;
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
    tokens: ['yerba', 'yerbas', 'yerba-y-infusiones', 'mate'],
  },
  {
    path: 'almacen/fideos',
    tokens: ['fideos', 'fideo', 'pastas', 'pasta', 'fideos-y-pastas', 'pastas-secas'],
  },
  {
    path: 'almacen/harinas',
    tokens: ['harinas', 'harina', 'premezclas', 'harinas-y-premezclas'],
  },
  { path: 'almacen/prepizzas', tokens: ['prepizza', 'prepizzas', 'pre-pizza', 'pre-pizzas'] },
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
  {
    path: 'frescos/rotiseria',
    tokens: ['rotiseria', 'rotisería', 'rotisserie', 'roti', 'comida preparada'],
  },
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
      'papeles',
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

  // ── Electrodomésticos y tecnología ──
  {
    path: 'electrodomesticos',
    tokens: [
      'electrodomesticos',
      'electrodomésticos',
      'electro',
      'electros',
      'electronica',
      'electrónica',
      'tecnologia',
      'tecnología',
      'tech',
      'computacion',
      'computación',
      'small-appliances',
      'pequenos-electrodomesticos',
      'pequenos electrodomesticos',
      'televisores',
      'linea-blanca',
      'linea blanca',
      'electro-hogar',
      'electro hogar',
      'electro y hogar',
    ],
  },
];

/** Devuelve el path de taxonomía a partir del path de categoría de la tienda. */
export function matchCategoryByStorePath(categoryPath: string[] | undefined): string | null {
  if (!categoryPath || categoryPath.length === 0) return null;
  const normed = categoryPath.map(normalizeToken).filter(Boolean);
  let best: { path: string; score: number } | null = null;
  for (const alias of STORE_ALIASES) {
    const depth = alias.path.split('/').length;
    for (const raw of alias.tokens) {
      const token = normalizeToken(raw);
      if (!token) continue;
      for (const seg of normed) {
        // Match exacto de segmento sobre el token manda (ej: 'panal' -> pañales).
        let weight = 0;
        if (seg === token) weight = 100;
        // Substring solo para tokens no ambiguos (>= 4 chars). Un token corto
        // como 'pan' NO debe absorber 'pana', 'panal', 'pan de miga', etc.
        else if (token.length >= 4 && seg.includes(token)) weight = 50;
        else if (seg.length >= 4 && token.includes(seg)) weight = 30;
        if (weight === 0) continue;
        const score = weight + depth;
        if (!best || score > best.score) best = { path: alias.path, score };
      }
    }
  }
  return best?.path ?? null;
}
