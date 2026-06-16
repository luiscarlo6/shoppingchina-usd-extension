# Shopping China USD Tax Free

Extensión de Chrome (Manifest V3) que muestra el precio **U$ ... TAX FREE** en los
listados y búsquedas de [shoppingchina.com.py](https://www.shoppingchina.com.py/),
sin necesidad de entrar a cada ficha de producto.

## Cómo funciona

En las páginas de listado/búsqueda solo aparece el precio en guaraníes (`Gs.`).
La extensión funciona **on-demand por hover** (para no gatillar el firewall del
sitio):

1. Cuando pasás el mouse sobre un producto y te quedás ~450 ms, detecta su link
   (`/producto/...`).
2. Hace **un** `fetch()` de esa ficha (1 request a la vez, nunca en ráfaga).
3. Extrae el texto `U$ ... TAX FREE` del HTML con una regex.
4. Inyecta un badge al lado del precio en guaraníes.
5. Cachea el resultado en `chrome.storage.local` por 12 horas (al volver, es
   instantáneo y no genera requests).

Solo consulta los productos que realmente mirás, con un tope de seguridad de 15
fichas por sesión de página. Así el ritmo es "humano" y evita el bloqueo por
rate-limit.

## Archivos

```
shoppingchina-usd-extension/
  manifest.json   -> configuración, permisos y dónde se inyecta
  content.js      -> lógica de scraping + inyección de badges
  styles.css      -> estilos del badge
```

## Cargar en Chrome (prueba local)

1. Abrí `chrome://extensions`.
2. Activá **Developer mode** (arriba a la derecha).
3. Clic en **Load unpacked**.
4. Seleccioná esta carpeta (`shoppingchina-usd-extension`).

## Probar

Abrí una búsqueda o un listado, por ejemplo:

- https://www.shoppingchina.com.py/site/search?query=macbook
- https://www.shoppingchina.com.py/marcas/550-apple

**Pasá el mouse sobre un producto** y, debajo del precio `Gs.`, debería aparecer
algo como:

```
U$ 1.750,00 TAX FREE
```

o, mientras carga: `Buscando U$...`

## Debug (consola)

Abrí DevTools (`F12`) en la pestaña de Shopping China, pestaña **Console**.
Deberías ver logs como:

```
[ShoppingChina USD] Extensión cargada
[ShoppingChina USD] Links encontrados: 24
[ShoppingChina USD] Consultando ficha: https://www.shoppingchina.com.py/producto/...
[ShoppingChina USD] Precio encontrado: U$ 1.750,00 TAX FREE
```

## Después de editar el código

Cada vez que cambies `content.js`, `styles.css` o `manifest.json`:

1. Andá a `chrome://extensions`.
2. Tocá el botón de **recargar** de la extensión.
3. Refrescá la pestaña de Shopping China.

## Si no funciona (checklist)

1. ¿La extensión aparece activa en `chrome://extensions`?
2. ¿La URL empieza con `https://www.shoppingchina.com.py/`?
3. ¿La consola muestra `[ShoppingChina USD] Extensión cargada`?
4. ¿La consola muestra `Links encontrados`?
5. ¿Hay errores rojos en la consola?
6. ¿En la pestaña **Network** aparecen requests a `/producto/...`?

- Si el paso 3 funciona pero `Links encontrados: 0`, el problema está en
  `PRODUCT_LINK_SELECTOR`.
- Si encuentra links pero no precio USD, ajustá la regex:
  `/U\$\s*([\d.]+,\d{2})\s*TAX\s*FREE/i`

## Notas

- Los precios en guaraníes son para compra online; los precios en dólares
  (TAX FREE) son válidos en Ciudad del Este.
- Esto es scraping de HTML, así que es frágil: si el sitio cambia el formato
  del texto `U$ ... TAX FREE`, hay que ajustar la regex.
- Próximo paso para robustez: revisar en DevTools si existe un endpoint JSON
  que ya devuelva el precio USD y consumirlo en vez de scrapear cada ficha.
