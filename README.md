# Shopping China USD Tax Free

Extensión de Chrome (Manifest V3) que muestra el precio **U$ ... TAX FREE** en los
listados y búsquedas de [shoppingchina.com.py](https://www.shoppingchina.com.py/),
sin necesidad de entrar a cada ficha de producto.

## Cómo funciona

En las páginas de listado/búsqueda solo aparece el precio en guaraníes (`Gs.`).
La extensión es **híbrida**:

1. **Estimación instantánea** (sin red por producto): lee el `Gs.` efectivo de
   cada tarjeta (si hay descuento, el precio actual, no el tachado) y muestra
   `≈ U$ ... TAX FREE` usando un divisor estimado.
2. **Valor exacto al pasar el mouse**: cuando te quedás ~400 ms sobre un producto,
   consulta el endpoint `quick_search` del sitio, empareja el producto por su
   **id** y muestra el `U$` **exacto** (badge en verde más oscuro, sin el `≈`).

La estimación es inmediata y el exacto solo se pide para los productos que
realmente mirás (1 request liviana a la vez), así no se gatilla el firewall.

### Por qué hay estimación y exacto: los dos regímenes

El precio en dólares de Shopping China no es arbitrario: es el precio en guaraníes
dividido por una tasa interna. Pero **hay dos regímenes, marcados producto por
producto**, y no se distinguen mirando solo el guaraní:

- **TAX FREE → divisor ~6985** (`= tasa_FX × (1 + IVA 10%)`). El precio en Gs
  incluye IVA y el USD es tax free (régimen de turismo, sin IVA). Acá caen
  MacBooks, iPhones y casi toda la electrónica de valor: para estos la estimación
  es **exacta**.
- **Normal → divisor ~6350** (la tasa FX "pelada"). El USD se muestra sin
  "TAX FREE". Acá caen muchos accesorios baratos: para estos la estimación con
  6985 subestima el USD ~10%, y por eso conviene pasar el mouse para el valor
  exacto.

La diferencia entre ambos regímenes (~6985 vs ~6350) es justamente el IVA del 10%.

### Cómo se mantiene al día

- **Divisor estimado** (`shoppingChinaRate` en `chrome.storage.local`, TTL 24 h):
  se calibra gratis desde las fichas TAX FREE que visitás, o con **una** llamada a
  `quick_search` si está vencido.
- **Divisor exacto por producto** (`scDivisor:<id>`, TTL 24 h): se cachea al pasar
  el mouse, así no se vuelve a pedir.

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

Debajo del precio `Gs.` debería aparecer, al instante, la **estimación**:

```
≈ U$ 1.750,00 TAX FREE
```

El símbolo `≈` indica que es estimado. **Pasá el mouse** sobre el producto y, tras
un momento, el badge pasa a verde más oscuro con el **valor exacto** (ya sin `≈`):

```
U$ 1.750,00 TAX FREE      (producto del régimen TAX FREE)
U$ 18,00                  (producto del régimen normal, sin TAX FREE)
```

## Debug (consola)

Abrí DevTools (`F12`) en la pestaña de Shopping China, pestaña **Console**.
Deberías ver logs como:

```
[ShoppingChina USD] Extensión cargada (modo tasa + exacto on-hover)
[ShoppingChina USD] 24 producto(s) estimado(s) (tasa 6985). Pasá el mouse para el valor exacto.
[ShoppingChina USD] Consultando USD exacto: BATERIA EXTERNA ORIENTE IPHONE
[ShoppingChina USD] USD exacto: U$ 18 (divisor 6333, normal) id 828083
```

En una ficha de producto TAX FREE vas a ver `Tasa estimada actualizada: ...
(ficha)` (calibración gratis, sin red).

## Después de editar el código

Cada vez que cambies `content.js`, `styles.css` o `manifest.json`:

1. Andá a `chrome://extensions`.
2. Tocá el botón de **recargar** de la extensión.
3. Refrescá la pestaña de Shopping China.

## Si no funciona (checklist)

1. ¿La extensión aparece activa en `chrome://extensions`?
2. ¿La URL empieza con `https://www.shoppingchina.com.py/`?
3. ¿La consola muestra `[ShoppingChina USD] Extensión cargada (modo tasa + exacto on-hover)`?
4. ¿La consola muestra `N producto(s) estimado(s)`?
5. Al pasar el mouse sobre un producto, ¿aparece `Consultando USD exacto` y luego `USD exacto`?
6. ¿Hay errores rojos en la consola?

- Si no aparece ningún badge, el problema suele estar en `PRODUCT_LINK_SELECTOR`
  o en `findCardFromAnchor` (no encuentra la tarjeta del producto).
- Si la estimación se ve desfasada, entrá a cualquier ficha TAX FREE para
  recalibrar, o borrá la clave `shoppingChinaRate` de `chrome.storage.local`.
- Para el valor exacto siempre podés pasar el mouse: usa el divisor real de ese
  producto (cacheado en `scDivisor:<id>`).

## Notas

- Los precios en guaraníes son para compra online; los precios en dólares
  (TAX FREE) son válidos en Ciudad del Este.
- La estimación (`≈`) es exacta para el régimen TAX FREE (electrónica de valor:
  MacBooks, iPhones, etc.). Para accesorios del régimen normal puede diferir ~10%;
  pasá el mouse para el valor exacto del API.
- Categorías con IVA reducido (5%: algunos alimentos, medicamentos) tendrían un
  divisor ~3-4% menor. La calibración por categoría (usando una palabra de la
  página como semilla de `quick_search`) ayuda a ajustarlo.
