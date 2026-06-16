# Shopping China USD Tax Free

Extensión de Chrome (Manifest V3) que muestra el precio **U$ ... TAX FREE** en los
listados y búsquedas de [shoppingchina.com.py](https://www.shoppingchina.com.py/),
sin necesidad de entrar a cada ficha de producto.

## Cómo funciona

En las páginas de listado/búsqueda solo aparece el precio en guaraníes (`Gs.`).
La extensión calcula el USD **localmente**, sin consultar cada ficha:

1. Lee el precio efectivo en `Gs.` de cada tarjeta (si hay descuento, toma el
   precio actual, no el tachado).
2. Convierte a dólares con un **divisor** (tasa interna del sitio):
   `USD = round(Gs / divisor)`.
3. Inyecta un badge `≈ U$ ... TAX FREE` al lado del precio en guaraníes.

El cálculo es instantáneo y **no genera ningún request por producto**, así que no
hay riesgo de que el firewall del sitio te bloquee.

### De dónde sale el divisor

El precio en dólares de Shopping China no es arbitrario: es el precio en guaraníes
dividido por una tasa interna casi constante (~6985 al momento de escribir esto).
Esa tasa equivale a `tasa_cambio × (1 + IVA 10%)`, porque el precio en guaraníes
**incluye IVA** y el precio en dólares es **tax free** (régimen de turismo, sin
IVA). Por eso queda ~13% por encima de la cotización oficial del guaraní.

La extensión mantiene el divisor al día de dos formas, sin costo de red por
producto:

- **Calibración en ficha**: cuando entrás a la página de un producto (que muestra
  `Gs.` y `U$ ... TAX FREE` como texto), recalcula el divisor exacto. Gratis.
- **Calibración por API**: si el divisor está vencido (TTL 24 h), hace **una**
  llamada liviana a `/quick_search` (el mismo endpoint del buscador del sitio, que
  devuelve `regular_price_pyg` y `regular_price_usd`) y guarda la mediana.

El divisor se guarda en `chrome.storage.local`. Si Shopping China ajusta su tasa,
la próxima calibración lo corrige solo.

## Archivos

```
shoppingchina-usd-extension/
  manifest.json   -> configuración, permisos y dónde se inyecta
  content.js      -> cálculo de USD por tasa + inyección de badges
  styles.css      -> estilos del badge
```

## Instalación (para vos y tus amigos)

### Opción 1 — Clonar con git (recomendada, fácil de actualizar)

```bash
git clone https://github.com/luiscarlo6/shoppingchina-usd-extension.git
```

Para actualizar a la última versión más adelante:

```bash
cd shoppingchina-usd-extension
git pull
```

### Opción 2 — Descargar el ZIP

En la página del repo: botón verde **Code** → **Download ZIP** → descomprimir.

### Cargar en Chrome

1. Abrí `chrome://extensions`.
2. Activá **Developer mode** (arriba a la derecha).
3. Clic en **Load unpacked**.
4. Seleccioná la carpeta `shoppingchina-usd-extension` (la que contiene el
   `manifest.json`).
5. Listo: la extensión se activa sola en `shoppingchina.com.py`.

> Nota: al ser una extensión sin empaquetar (modo desarrollador), Chrome puede
> mostrar un aviso de "deshabilitar extensiones en modo desarrollador" al
> iniciar. Se ignora sin problema. Si actualizás el código con `git pull`,
> acordate de tocar el botón de **recargar** de la extensión en
> `chrome://extensions`.

## Probar

Abrí una búsqueda o un listado, por ejemplo:

- https://www.shoppingchina.com.py/site/search?query=macbook
- https://www.shoppingchina.com.py/marcas/550-apple

Debajo del precio `Gs.` debería aparecer, al instante, algo como:

```
≈ U$ 1.750,00 TAX FREE
```

El símbolo `≈` indica que es un valor calculado (estimado a partir del divisor).
En la práctica coincide con el USD real del sitio.

## Debug (consola)

Abrí DevTools (`F12`) en la pestaña de Shopping China, pestaña **Console**.
Deberías ver logs como:

```
[ShoppingChina USD] Extensión cargada (modo tasa)
[ShoppingChina USD] 24 producto(s) con USD calculado (tasa 6985)
[ShoppingChina USD] Calibrando tasa con quick_search: macbook
[ShoppingChina USD] Tasa actualizada: 6985 (quick_search:macbook)
```

En una ficha de producto vas a ver `Tasa actualizada: ... (ficha)` (calibración
gratis, sin red).

## Después de editar el código

Cada vez que cambies `content.js`, `styles.css` o `manifest.json`:

1. Andá a `chrome://extensions`.
2. Tocá el botón de **recargar** de la extensión.
3. Refrescá la pestaña de Shopping China.

## Si no funciona (checklist)

1. ¿La extensión aparece activa en `chrome://extensions`?
2. ¿La URL empieza con `https://www.shoppingchina.com.py/`?
3. ¿La consola muestra `[ShoppingChina USD] Extensión cargada (modo tasa)`?
4. ¿La consola muestra `N producto(s) con USD calculado`?
5. ¿Hay errores rojos en la consola?

- Si no aparece ningún badge, el problema suele estar en `PRODUCT_LINK_SELECTOR`
  o en `findCardFromAnchor` (no encuentra la tarjeta del producto).
- Si los valores USD se ven desfasados, puede que el divisor esté desactualizado:
  entrá a cualquier ficha de producto para forzar una recalibración exacta, o
  borrá la clave `shoppingChinaRate` de `chrome.storage.local`.

## Notas

- Los precios en guaraníes son para compra online; los precios en dólares
  (TAX FREE) son válidos en Ciudad del Este.
- El valor mostrado es **calculado** (`≈`). Reproduce el USD real del sitio en
  todos los casos observados, pero un producto con precio en dólares fijado a mano
  fuera del divisor podría diferir.
- Categorías con IVA reducido (5%: algunos alimentos, medicamentos) tendrían un
  divisor ~3-4% menor. La calibración por categoría (usando una palabra de la
  página como semilla de `quick_search`) ayuda a ajustarlo.
