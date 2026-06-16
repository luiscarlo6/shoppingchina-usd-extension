console.log("[ShoppingChina USD] Extensión cargada (modo tasa + exacto on-hover)");

const PRODUCT_LINK_SELECTOR = [
  'a[href^="/producto/"]',
  'a[href*="shoppingchina.com.py/producto/"]'
].join(",");

const RATE_KEY = "shoppingChinaRate";
const DEFAULT_RATE = 6985; // divisor Gs/USD del régimen TAX FREE (incluye IVA 10%)
const RATE_TTL_MS = 1000 * 60 * 60 * 24; // 24 horas
const RATE_MIN = 5000; // guardarraíles de sanidad para descartar valores absurdos
const RATE_MAX = 9000;
const BADGE_CLASS = "sc-usd-taxfree-badge";
const QUICK_SEARCH_PATH = "/quick_search?search=";

// Capa de exactitud por producto (hover)
const HOVER_DELAY_MS = 400; // hay que quedarse sobre el producto este tiempo
const DIVISOR_KEY_PREFIX = "scDivisor:"; // cache por id de producto
const DIVISOR_TTL_MS = 1000 * 60 * 60 * 24; // 24 horas
const TAXFREE_DIVISOR_MIN = 6700; // divisor >= esto => régimen TAX FREE (sin IVA)

let currentRate = DEFAULT_RATE;
let scanTimer = null;
let refreshing = false;

const hoverTimers = new WeakMap(); // card -> timeout pendiente
const divisorCache = new Map(); // id de producto -> divisor exacto
let exactInFlight = false; // garantiza 1 request de exactitud a la vez

/* ---------------- utilidades numéricas ---------------- */

function parseGsAmount(str) {
  // "Gs. 12.224.000" -> 12224000
  const match = str.match(/Gs\.\s*([\d.]+)/);
  if (!match) return null;
  const n = parseInt(match[1].replace(/\./g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function parseAllGs(text) {
  const amounts = [];
  const re = /Gs\.\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[1].replace(/\./g, ""), 10);
    if (Number.isFinite(n) && n > 0) amounts.push(n);
  }
  return amounts;
}

function parseUsdTaxFree(text) {
  // "U$ 1.750,00 TAX FREE" -> 1750
  const m = text.match(/U\$\s*([\d.]+,\d{2})\s*TAX\s*FREE/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function formatUsd(value) {
  return value.toLocaleString("es-PY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function plausibleRate(r) {
  return Number.isFinite(r) && r >= RATE_MIN && r <= RATE_MAX;
}

function extractProductId(href) {
  if (!href) return null;
  try {
    const path = new URL(href, location.origin).pathname.replace(/\/+$/, "");
    const m = path.match(/(\d+)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/* ---------------- manejo de la tasa estimada ---------------- */

async function loadStoredRate() {
  try {
    const res = await chrome.storage.local.get(RATE_KEY);
    const stored = res[RATE_KEY];
    if (stored && Number.isFinite(stored.value)) {
      currentRate = stored.value;
      return stored;
    }
  } catch (e) {
    console.warn("[ShoppingChina USD] No se pudo leer la tasa guardada:", e);
  }
  return null;
}

function isRateFresh(stored) {
  return Boolean(stored) && Date.now() - stored.savedAt < RATE_TTL_MS;
}

async function saveRate(value, source) {
  const rounded = Math.round(value);
  if (!plausibleRate(rounded)) return;
  currentRate = rounded;
  try {
    await chrome.storage.local.set({
      [RATE_KEY]: { value: rounded, savedAt: Date.now(), source }
    });
    console.log(`[ShoppingChina USD] Tasa estimada actualizada: ${rounded} (${source})`);
  } catch (e) {
    console.warn("[ShoppingChina USD] No se pudo guardar la tasa:", e);
  }
}

function pickSeedTerm() {
  // Usa una palabra del primer producto de la página para que la calibración
  // de la tasa estimada caiga en una categoría representativa.
  const anchor = document.querySelector(PRODUCT_LINK_SELECTOR);
  const text = (anchor?.textContent || "").trim();
  const word = text
    .split(/\s+/)
    .find(w => w.replace(/[^A-Za-z0-9]/g, "").length >= 4);
  return (word || "apple").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

async function refreshRateFromApi() {
  if (refreshing) return false;
  refreshing = true;
  try {
    const seed = pickSeedTerm();
    console.log("[ShoppingChina USD] Calibrando tasa estimada con quick_search:", seed);

    const res = await fetch(QUICK_SEARCH_PATH + encodeURIComponent(seed), {
      credentials: "include"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const items = await res.json();
    // Para la tasa estimada nos quedamos con el régimen TAX FREE (el más alto),
    // que es el de la electrónica de valor. Tomamos la mediana de los divisores
    // cercanos a ese régimen.
    const ratios = [];
    for (const it of items || []) {
      const pyg = parseFloat(it.regular_price_pyg);
      const usd = parseFloat(it.regular_price_usd);
      if (pyg > 0 && usd > 0) {
        const r = pyg / usd;
        if (r >= TAXFREE_DIVISOR_MIN && plausibleRate(r)) ratios.push(r);
      }
    }

    const m = median(ratios);
    if (plausibleRate(m)) {
      await saveRate(m, `quick_search:${seed}`);
      return true;
    }

    console.warn("[ShoppingChina USD] quick_search no dio una tasa TAX FREE válida");
    return false;
  } catch (e) {
    console.warn("[ShoppingChina USD] Falló la calibración por API:", e);
    return false;
  } finally {
    refreshing = false;
  }
}

function calibrateFromFicha() {
  // En la ficha de un producto TAX FREE aparece "U$ ... TAX FREE": calibramos
  // la tasa estimada exacta de ese régimen sin gastar una request.
  if (!location.pathname.includes("/producto/")) return false;

  const body = document.body.innerText || "";
  const cut = body.indexOf("Productos Relacionados");
  const slice = cut > 0 ? body.slice(0, cut) : body;

  const usd = parseUsdTaxFree(slice);
  const gsList = parseAllGs(slice);
  if (!usd || !gsList.length) return false;

  const effectiveGs = Math.min(...gsList);
  const r = effectiveGs / usd;
  if (r >= TAXFREE_DIVISOR_MIN && plausibleRate(r)) {
    saveRate(r, "ficha");
    return true;
  }
  return false;
}

/* ---------------- tarjetas y badges ---------------- */

function findCardFromAnchor(anchor) {
  let card = anchor;
  for (let i = 0; i < 12 && card && card !== document.body; i++) {
    const text = card.innerText || "";
    if (
      /Gs\.\s*[\d.]+/.test(text) &&
      card.querySelector?.(PRODUCT_LINK_SELECTOR)
    ) {
      return card;
    }
    card = card.parentElement;
  }
  return null;
}

function findGuaraniPriceElement(container) {
  // Devuelve el elemento del precio efectivo (el monto en Gs más bajo de la
  // tarjeta), para insertar el badge justo al lado.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return /Gs\.\s*[\d.]+/.test(node.textContent)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });

  let best = null;
  let bestVal = Infinity;
  let node;
  while ((node = walker.nextNode())) {
    const val = parseGsAmount(node.textContent);
    if (val != null && val < bestVal) {
      bestVal = val;
      best = node;
    }
  }
  return best?.parentElement || container;
}

function getOrCreateBadge(card) {
  let badge = card.querySelector("." + BADGE_CLASS);
  if (!badge) {
    const priceEl = findGuaraniPriceElement(card);
    badge = document.createElement("div");
    badge.className = BADGE_CLASS;
    priceEl.insertAdjacentElement("afterend", badge);
  }
  return badge;
}

function effectiveGsOf(card) {
  const gsList = parseAllGs(card.innerText || "");
  return gsList.length ? Math.min(...gsList) : null;
}

function paintEstimate(card) {
  const effectiveGs = effectiveGsOf(card);
  if (effectiveGs == null) return;

  const usd = Math.round(effectiveGs / currentRate);
  if (!Number.isFinite(usd) || usd <= 0) return;

  const existing = card.querySelector("." + BADGE_CLASS);

  // No pisar un badge ya resuelto exacto.
  if (existing && existing.dataset.scExact === "1") return;

  // Evitar re-pintar si nada cambió.
  if (
    existing &&
    existing.dataset.scRate === String(currentRate) &&
    existing.dataset.scGs === String(effectiveGs)
  ) {
    return;
  }

  const badge = getOrCreateBadge(card);
  badge.textContent = `≈ U$ ${formatUsd(usd)} TAX FREE`;
  badge.dataset.scRate = String(currentRate);
  badge.dataset.scGs = String(effectiveGs);
  badge.classList.remove("sc-usd-exact");
}

function setExactBadge(card, usd, taxFree, effectiveGs) {
  const badge = getOrCreateBadge(card);
  badge.textContent = `U$ ${formatUsd(usd)}${taxFree ? " TAX FREE" : ""}`;
  badge.dataset.scExact = "1";
  badge.dataset.scGs = String(effectiveGs);
  badge.classList.add("sc-usd-exact");
}

function paintAll() {
  const anchors = document.querySelectorAll(PRODUCT_LINK_SELECTOR);
  const seen = new Set();
  let painted = 0;

  anchors.forEach(anchor => {
    const card = findCardFromAnchor(anchor);
    if (!card || seen.has(card)) return;
    seen.add(card);
    paintEstimate(card);
    painted++;
  });

  if (painted) {
    console.log(
      `[ShoppingChina USD] ${painted} producto(s) estimado(s) (tasa ${currentRate}). Pasá el mouse para el valor exacto.`
    );
  }
}

function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(paintAll, 300);
}

/* ---------------- exactitud por producto (hover) ---------------- */

async function getExactDivisor(card, id) {
  if (divisorCache.has(id)) return divisorCache.get(id);

  const key = DIVISOR_KEY_PREFIX + id;
  try {
    const res = await chrome.storage.local.get(key);
    const cached = res[key];
    if (
      cached &&
      Number.isFinite(cached.divisor) &&
      Date.now() - cached.savedAt < DIVISOR_TTL_MS
    ) {
      divisorCache.set(id, cached.divisor);
      return cached.divisor;
    }
  } catch {
    /* seguimos al fetch */
  }

  const anchors = [...card.querySelectorAll(PRODUCT_LINK_SELECTOR)];
  const title = anchors
    .map(a => (a.textContent || "").trim().replace(/\s+/g, " "))
    .reduce((longest, t) => (t.length > longest.length ? t : longest), "");
  if (!title) return null;

  console.log("[ShoppingChina USD] Consultando USD exacto:", title);
  const res = await fetch(QUICK_SEARCH_PATH + encodeURIComponent(title), {
    credentials: "include"
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const items = await res.json();
  for (const it of items || []) {
    const itId = extractProductId(it.url_es) || extractProductId(it.url_po);
    const pyg = parseFloat(it.regular_price_pyg);
    const usd = parseFloat(it.regular_price_usd);
    if (itId === id && pyg > 0 && usd > 0) {
      const divisor = pyg / usd;
      if (plausibleRate(divisor)) {
        divisorCache.set(id, divisor);
        chrome.storage.local
          .set({ [key]: { divisor, savedAt: Date.now() } })
          .catch(() => {});
        return divisor;
      }
    }
  }
  return null; // el producto no apareció en quick_search
}

async function resolveExact(card) {
  const anchor = card.querySelector(PRODUCT_LINK_SELECTOR);
  const id = extractProductId(anchor?.href);
  if (!id) return;

  const current = card.querySelector("." + BADGE_CLASS);
  if (current && current.dataset.scExact === "1") return;

  // 1 request de exactitud a la vez.
  while (exactInFlight) {
    await new Promise(r => setTimeout(r, 120));
  }
  const recheck = card.querySelector("." + BADGE_CLASS);
  if (recheck && recheck.dataset.scExact === "1") return;

  exactInFlight = true;
  try {
    const divisor = await getExactDivisor(card, id);
    if (!divisor) return;

    const effectiveGs = effectiveGsOf(card);
    if (effectiveGs == null) return;

    const usd = Math.round(effectiveGs / divisor);
    if (!Number.isFinite(usd) || usd <= 0) return;

    const taxFree = divisor >= TAXFREE_DIVISOR_MIN;
    setExactBadge(card, usd, taxFree, effectiveGs);
    console.log(
      `[ShoppingChina USD] USD exacto: U$ ${usd} (divisor ${Math.round(divisor)}, ${taxFree ? "TAX FREE" : "normal"}) id ${id}`
    );
  } catch (e) {
    console.warn("[ShoppingChina USD] No se pudo traer USD exacto:", e);
  } finally {
    exactInFlight = false;
  }
}

function onPointerOver(event) {
  const anchor = event.target.closest?.(PRODUCT_LINK_SELECTOR);
  if (!anchor) return;
  const card = findCardFromAnchor(anchor);
  if (!card) return;

  const badge = card.querySelector("." + BADGE_CLASS);
  if (badge && badge.dataset.scExact === "1") return;
  if (hoverTimers.has(card)) return;

  const timer = setTimeout(() => {
    hoverTimers.delete(card);
    resolveExact(card);
  }, HOVER_DELAY_MS);
  hoverTimers.set(card, timer);
}

function onPointerOut(event) {
  const anchor = event.target.closest?.(PRODUCT_LINK_SELECTOR);
  if (!anchor) return;
  const card = findCardFromAnchor(anchor);
  if (!card) return;

  const timer = hoverTimers.get(card);
  if (timer) {
    clearTimeout(timer);
    hoverTimers.delete(card);
  }
}

/* ---------------- arranque ---------------- */

async function init() {
  const stored = await loadStoredRate();

  // Calibración gratis (sin red) si estamos dentro de una ficha de producto.
  const calibrated = calibrateFromFicha();

  // Pintamos las estimaciones de inmediato con la mejor tasa disponible.
  paintAll();

  // Solo pedimos al API si la tasa está vencida y no pudimos calibrar en ficha.
  if (!calibrated && !isRateFresh(stored)) {
    const ok = await refreshRateFromApi();
    if (ok) paintAll();
  }

  document.addEventListener("pointerover", onPointerOver, { passive: true });
  document.addEventListener("pointerout", onPointerOut, { passive: true });

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
}

init();
