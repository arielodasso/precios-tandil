# Feature Specification: Precios Tandil — Motor de Análisis y Plataforma Web de Precios

**Feature Branch**: `001-precios-tandil`

**Created**: 2026-08-20

**Status**: Draft

**Input**: User description: "Motor de análisis y plataforma web de precios para Tandil, desarrollado con Tandil Alerta y motorizado por tecnología Sigma. Ingesta, normalización, comparación y visualización de precios de supermercados (Carrefour, Monarca, Carrefour Maxi/Comerciante, DIA, Cooperativa Obrera, Vea), con experiencia mobile-first para consulta en góndola."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consultar y comparar el precio de un producto en góndola (Priority: P1)

Un vecino de Tandil está parado frente a la góndola del supermercado. Saca el
teléfono, abre Precios Tandil, escribe las primeras letras de un producto
("arroz") o escanea/ingresa el código de barras, y en ≤ 3 segundos ve una
tarjeta de comparación: el producto unificado, el precio más bajo de la ciudad
resaltado en verde, y cuánto cuesta en cada supermercado (Carrefour, Monarca,
Comerciante/Maxi, DIA, Cooperativa Obrera, Vea). Puede filtrar por categoría
instantáneamente.

**Why this priority**: Es el caso de uso central del producto. Sin comparación
rápida y confiable en móvil no hay producto.

**Independent Test**: Se puede probar de forma independiente cargando precios
de al menos 2 supermercados en la base y ejecutando el flujo de búsqueda +
comparación en un dispositivo móvil real. Entrega valor completo por sí sola.

**Acceptance Scenarios**:

1. **Given** existen precios frescos (< 48 h) de "Arroz Gallo Oro 1kg" en 3 supermercados, **When** el usuario busca "arroz gallo" y selecciona el producto, **Then** ve una tarjeta con los 3 precios ordenados de menor a mayor, el menor resaltado en verde con etiqueta textual "Mejor precio", y la diferencia porcentual contra cada competidor.
2. **Given** el usuario tipea "azuc" en el buscador, **When** transcurren ≤ 300 ms desde el último carácter, **Then** aparece autocompletado predictivo con hasta 8 sugerencias relevantes para Tandil.
3. **Given** el usuario está sin conexión estable (3G lento), **When** abre una tarjeta de comparación ya visitada recientemente, **Then** la interfaz responde desde caché y muestra la antigüedad de los datos.
4. **Given** un producto solo existe en 1 supermercado, **When** se muestra su tarjeta, **Then** indica claramente "Solo disponible en [supermercado]" sin comparación vacía.

---

### User Story 2 - Conocer el historial y el mejor precio histórico antes de comprar (Priority: P2)

Un vecino duda si el precio actual de un aceite conviene. Abre la tarjeta del
producto y ve la serie histórica simplificada: precio actual, menor precio de
los últimos 30/90 días, variación porcentual semanal, y un badge claro tipo
"Buen momento para comprar" cuando el precio actual está cerca del mínimo
histórico, o "Está más caro que hace una semana (+12 %)" cuando subió.

**Why this priority**: Agrega el diferencial analítico de Sigma (series
temporales) sobre una simple lista de precios; convierte la curiosidad en
decisión de compra informada.

**Independent Test**: Con datos históricos sintéticos cargados en DB, verificar
cálculos de mínimos y variaciones y su presentación en la tarjeta. No depende
de US1 más allá de compartir la tarjeta de producto.

**Acceptance Scenarios**:

1. **Given** un producto con 90 días de historial cuyo mínimo fue $1.500 y hoy cuesta $1.590, **When** el usuario abre la pestaña "Historial" de la tarjeta, **Then** ve "Mínimo 90 días: $1.500 (-5,7 % vs hoy)" y el badge "Cerca del mínimo histórico".
2. **Given** un producto que subió de $2.000 a $2.400 en 7 días, **When** se muestra su tarjeta, **Then** aparece el indicador "+20 % esta semana" en rojo con etiqueta textual.
3. **Given** un producto con menos de 7 días de datos, **When** se consulta su historial, **Then** la sección indica "Datos insuficientes" en lugar de mostrar métricas engañosas.

---

### User Story 3 - Recibir alertas de oportunidades reales difundidas por Tandil Alerta (Priority: P3)

El equipo de Tandil Alerta identifica automáticamente productos con caídas de
precio significativas u oportunidades de la semana ("Mejor Oportunidad de la
Semana"), las valida desde una vista administrativa simple, y las difunde en
sus canales (redes/mensajería) con un enlace directo a la tarjeta del producto.
Los vecinos también pueden ver en la home los badges de oportunidad vigentes.

**Why this priority**: Es el canal de difusión y crecimiento del producto y el
valor diferencial para Tandil Alerta, pero depende de que US1 y US2 existan.

**Independent Test**: Generar candidatas de alerta desde datos de prueba,
revisarlas en la vista admin y publicar una; verificar badge visible en home y
enlace compartible funcional.

**Acceptance Scenarios**:

1. **Given** un producto bajó ≥ 15 % respecto de su promedio de 30 días, **When** corre el job diario de detección, **Then** el producto queda como candidata de "oportunidad" con evidencia (precios anterior/actual, % descuento, fuente).
2. **Given** una candidata aprobada por Tandil Alerta, **When** se publica, **Then** aparece en la home con badge "Mejor Oportunidad de la Semana" y su URL `/p/<slug>` es compartible con vista previa social (OG tags).
3. **Given** una candidata rechazada, **When** se lista nuevamente, **Then** no vuelve a proponerse durante 14 días.

---

### User Story 4 - Operar y monitorear la ingesta de precios (Priority: P4)

Un operador de Sigma/Tandil Alerta necesita saber cada mañana que la ingesta
nocturna funcionó: qué supermercados se actualizaron, cuántos SKUs se
capturaron, qué adaptadores están en cuarentena y qué matches semánticos
quedaron pendientes de revisión. Desde una vista administrativa protegida ve el
estado y puede relanzar un scraper fallido.

**Why this priority**: Necesario para operación confiable, pero no bloquea el
valor al vecino; puede operarse inicialmente vía CLI/logs.

**Independent Test**: Ejecutar una corrida de ingesta con un adaptador
forzado a fallar y verificar reporte, cuarentena y relanzamiento manual.

**Acceptance Scenarios**:

1. **Given** la corrida nocturna terminó con DIA fallido tras 3 reintentos, **When** el operador abre el panel de ingesta, **Then** ve "DIA: FALLIDO (cuarentena hasta próxima ventana)" con el reporte de errores y el botón "Reintentar ahora".
2. **Given** 40 matches semánticos con score bajo umbral de confianza, **When** el operador revisa la cola, **Then** puede confirmar o rechazar cada match y la decisión queda auditada.
3. **Given** cualquier corrida, **When** finaliza, **Then** existe un reporte estructurado consultable (éxitos, fallos, SKUs capturados/rechazados por tienda).

---

### Edge Cases

- ¿Qué pasa cuando un supermercado deja de responder > 72 h? La UI marca sus
  precios como "sin actualizar desde [fecha]" y los excluye del cálculo de
  "mejor precio" si superan la ventana de frescura máxima (7 días).
- ¿Qué pasa cuando dos SKUs distintos comparten EAN mal cargado por una tienda?
  El sistema detecta conflicto de descripciones muy dispares bajo un mismo EAN,
  separa los grupos y envía a revisión manual.
- ¿Qué pasa cuando un precio capturado varía > 80 % respecto del anterior?
  Se persiste marcado como `suspect` y se excluye de badges/rankings hasta
  confirmación por segunda captura.
- ¿Qué pasa con búsquedas sin resultados? La UI ofrece sugerencias por
  categoría y términos similares; nunca pantalla muerta.
- ¿Qué pasa con productos regionales ausentes en tiendas nacionales? Quedan
  limitados a las tiendas que los catalogan, con etiqueta de cobertura parcial.
- ¿Qué pasa ante cambio total de DOM de un sitio? El adaptador entra en
  cuarentena, el resto del pipeline sigue operativo, y se dispara alerta de
  mantenimiento del adaptador.

## Requirements *(mandatory)*

### Functional Requirements

**Ingesta**

- **FR-001**: El sistema MUST ingestar precios de los 6 supermercados definidos (Carrefour, Monarca, Comerciante/Carrefour Maxi, DIA, Cooperativa Obrera, Vea) mediante adaptadores aislados que implementan un contrato común.
- **FR-002**: Cada adaptador MUST implementar reintentos con backoff exponencial y jitter, rotación de User-Agents y soporte de proxy rotativo configurable.
- **FR-003**: El sistema MUST ejecutar ingesta masiva automatizada en horario de bajo tráfico (00:00–06:00 ART) mediante cron jobs, con idempotencia por corrida.
- **FR-004**: El sistema MUST poner en cuarentena un adaptador tras N fallos consecutivos (default 3) y continuar el pipeline con el resto.
- **FR-005**: Todo precio capturado MUST persistir como registro inmutable append-only con: tienda, SKU de tienda, EAN (si disponible), descripción original, precio, unidad de venta, URL fuente y timestamp UTC de captura.

**Normalización y matching**

- **FR-006**: El normalizador MUST unificar SKUs multi-tienda usando EAN-13 como clave primaria y similitud semántica de descripciones como fallback, marcando el método de match (`ean` | `semantic`) y su score.
- **FR-007**: Los matches semánticos con score inferior al umbral de confianza MUST quedar en cola de revisión manual accesible para operadores.
- **FR-008**: El sistema MUST calcular por producto unificado: variación porcentual diaria/semanal, mínimo histórico (ventanas 30/90 días y todo el histórico) y promedio móvil de 30 días.

**Consulta y API**

- **FR-009**: La API pública MUST exponer búsqueda de productos con autocompletado (respuesta ≤ 300 ms p95 server-side), filtros por categoría y supermercado.
- **FR-010**: La API pública MUST exponer la comparación de precios por producto unificado ordenada por precio ascendente, incluyendo frescura de cada dato.
- **FR-011**: La API pública MUST exponer el historial de precios por producto con agregaciones precalculadas para respuesta p95 < 200 ms.
- **FR-012**: Las respuestas públicas MUST ser cacheables (CDN/Redis) e incluir cabeceras de cache apropiadas según frescura.

**Interfaz web**

- **FR-013**: La web MUST ofrecer buscador global predictivo con autocompletado y filtros instantáneos por categoría, usable con una mano en móvil.
- **FR-014**: La tarjeta de comparación MUST mostrar: producto unificado, precio más bajo resaltado en verde con etiqueta textual "Mejor precio", desglose por supermercado, y diferencia porcentual contra el mínimo.
- **FR-015**: El sistema MUST mostrar badges visuales de "Mejor Oportunidad de la Semana" y de variaciones a la baja, siempre acompañados de texto (nunca solo color).
- **FR-016**: Toda vista de precio MUST indicar la antigüedad del dato ("Actualizado hace X h") y degradar elegantemente datos fuera de ventana de frescura.
- **FR-017**: El sitio MUST implementar co-branding visible: "Tecnología de análisis impulsada por Sigma | Difundido por Tandil Alerta" en footer y páginas clave.
- **FR-018**: El sitio MUST soportar modo claro/oscuro según `prefers-color-scheme`, contraste WCAG 2.1 AA y tipografía base móvil ≥ 16 px.
- **FR-019**: Cada producto MUST tener URL canónica compartible (`/p/<slug>`) optimizada para SEO local con metadatos OG y datos estructurados de producto/oferta.
- **FR-020**: El sistema MUST generar candidatos de "oportunidad" (caída ≥ 15 % vs promedio 30 días, umbral configurable) y exponer vista administrativa para aprobación/rechazo por Tandil Alerta con auditoría.

**Administración**

- **FR-021**: Vista administrativa protegida por autenticación MUST mostrar estado de ingesta por tienda (última corrida, SKUs capturados, fallos, cuarentenas) y permitir relanzar scrapers.
- **FR-022**: El sistema MUST emitir logs estructurados con correlation-id por corrida y métricas de salud (tasa EAN, tasa match multi-tienda, % frescura).

### Key Entities *(include if feature involves data)*

- **Store (Supermercado)**: cadena monitoreada; atributos: nombre, slug, dominio(s), estado del adaptador, configuración de scraping.
- **StoreSku**: SKU tal como lo publica una tienda; relación con Store; código interno de tienda, EAN declarado, descripción original, URL de producto, unidad de venta.
- **Product (Producto Unificado)**: entidad canónica que agrupa StoreSkus equivalentes; nombre normalizado, marca, categoría, imagen representativa, slug.
- **PriceRecord**: observación inmutable de precio (append-only); StoreSku, precio, timestamp, método de captura, flag `suspect`.
- **PriceAggregate**: agregados precalculados por Product (mínimos por ventana, variaciones, promedio móvil) para servir consultas rápidas.
- **MatchLink**: asociación StoreSku ↔ Product con método (`ean`|`semantic`), score, estado (auto/pendiente/confirmado/rechazado).
- **RunReport**: resultado de una corrida de ingesta; tienda, inicio/fin, contadores éxito/fallo/rechazo, errores detallados.
- **DealCandidate / DealPublication**: candidata de oportunidad detectada y su publicación aprobada por Tandil Alerta.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un vecino obtiene la comparación de un producto en ≤ 3 s desde apertura de la app en 4G (medido con Lighthouse/WebPageTest en dispositivo gama media): LCP < 2.5 s, INP < 200 ms.
- **SC-002**: La comparación de precios cubre ≥ 4 de las 6 cadenas objetivo con datos < 48 h de antigüedad en ≥ 90 % de los días calendario tras el primer mes de operación.
- **SC-003**: ≥ 70 % de los SKUs activos tienen EAN-13 confiable y ≥ 60 % logran match multi-tienda automático al tercer mes.
- **SC-004**: Consultas de comparación e historial responden p95 < 200 ms server-side bajo carga nominal (50 rps sostenidas).
- **SC-005**: Tasa de falsos "mejor precio" (precios suspect publicados como válidos) < 0.5 % mensual.
- **SC-006**: Tandil Alerta publica ≥ 3 oportunidades semanales validadas sin intervención técnica (flujo admin autoservicio).
- **SC-007**: Disponibilidad del sitio público ≥ 99.5 % mensual; ningún fallo de scraping individual degrada la disponibilidad.

## Assumptions

- Los precios publicados por los sitios/e-commerce de las cadenas son representativos de las sucursales de Tandil o de entrega a la zona; se asume cobertura inicial online-first con evolución futura a datos por sucursal.
- El volumen inicial estimado es de ~100k–500k registros de precio/mes entre 6 tiendas; PostgreSQL con particionado es suficiente sin necesidad de motor columnar en v1.
- No se requiere cuenta de usuario para consultar precios en v1; las funciones de usuario registrado (listas, favoritos, alertas personalizadas) quedan fuera del alcance inicial.
- Tandil Alerta aporta validación editorial de oportunidades; Sigma opera la infraestructura.
- El acceso a proxies residenciales es un presupuesto operativo disponible para mitigar bloqueos anti-bot.
- Legal: solo se ingieren datos públicos de precios de producto; no se crean cuentas ni compras en sitios de terceros.
