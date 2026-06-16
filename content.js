console.log("[ShoppingChina USD] Extensión cargada (modo tasa)");

const PRODUCT_LINK_SELECTOR = [
  'a[href^="/producto/"]',
  'a[href*="shoppingchina.com.py/producto/"]'
].join(",");

const RATE_KEY = "shoppingChinaRate";
const DEFAULT_RATE = 6985; // divisor Gs/USD observado (incluye IVA 10%)
const RATE_TTL_MS = 1000 * 60 * 60 * 24; // 24 horas
const RATE_MIN = 5000; // guardarraíles de sanidad para descartar valores absurdos
const RATE_MAX = 9000;
const BADGE_CLASS = "sc-usd-taxfree-badge";
const QUICK_SEARCH_PATH = "/quick_search?search=";

let currentRate = DEFAULT_RATE;
let scanTimer = null;
let refreshing = false;

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

/* ---------------- manejo de la tasa ---------------- */

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
    console.log(`[ShoppingChina USD] Tasa actualizada: ${rounded} (${source})`);
  } catch (e) {
    console.warn("[ShoppingChina USD] No se pudo guardar la tasa:", e);
  }
}

function pickSeedTerm() {
  // Usa una palabra del primer producto de la página para que la calibración
  // caiga en la misma categoría (mismo IVA) que lo que estás mirando.
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
    console.log("[ShoppingChina USD] Calibrando tasa con quick_search:", seed);

    const res = await fetch(QUICK_SEARCH_PATH + encodeURIComponent(seed), {
      credentials: "include"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const items = await res.json();
    const ratios = [];

    for (const it of items || []) {
      const pyg = parseFloat(it.regular_price_pyg);
      const usd = parseFloat(it.regular_price_usd);
      if (pyg > 0 && usd > 0) {
        const r = pyg / usd;
        if (plausibleRate(r)) ratios.push(r);
      }
    }

    const m = median(ratios);
    if (plausibleRate(m)) {
      await saveRate(m, `quick_search:${seed}`);
      return true;
    }

    console.warn("[ShoppingChina USD] quick_search no devolvió una tasa válida");
    return false;
  } catch (e) {
    console.warn("[ShoppingChina USD] Falló la calibración por API:", e);
    return false;
  } finally {
    refreshing = false;
  }
}

function calibrateFromFicha() {
  // En la ficha del producto aparecen Gs y "U$ ... TAX FREE" como texto:
  // calibramos la tasa exacta sin gastar una request.
  if (!location.pathname.includes("/producto/")) return false;

  const body = document.body.innerText || "";
  const cut = body.indexOf("Productos Relacionados");
  const slice = cut > 0 ? body.slice(0, cut) : body;

  const usd = parseUsdTaxFree(slice);
  const gsList = parseAllGs(slice);
  if (!usd || !gsList.length) return false;

  const effectiveGs = Math.min(...gsList);
  const r = effectiveGs / usd;
  if (plausibleRate(r)) {
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

function paintCard(card) {
  const gsList = parseAllGs(card.innerText || "");
  if (!gsList.length) return;

  const effectiveGs = Math.min(...gsList);
  const usd = Math.round(effectiveGs / currentRate);
  if (!Number.isFinite(usd) || usd <= 0) return;

  let badge = card.querySelector("." + BADGE_CLASS);

  // Evita re-pintar si nada cambió (misma tasa y mismo precio).
  if (
    badge &&
    badge.dataset.scRate === String(currentRate) &&
    badge.dataset.scGs === String(effectiveGs)
  ) {
    return;
  }

  if (!badge) {
    const priceEl = findGuaraniPriceElement(card);
    badge = document.createElement("div");
    badge.className = BADGE_CLASS;
    priceEl.insertAdjacentElement("afterend", badge);
  }

  badge.textContent = `≈ U$ ${formatUsd(usd)} TAX FREE`;
  badge.dataset.scRate = String(currentRate);
  badge.dataset.scGs = String(effectiveGs);
}

function paintAll() {
  const anchors = document.querySelectorAll(PRODUCT_LINK_SELECTOR);
  const seen = new Set();
  let painted = 0;

  anchors.forEach(anchor => {
    const card = findCardFromAnchor(anchor);
    if (!card || seen.has(card)) return;
    seen.add(card);
    paintCard(card);
    painted++;
  });

  if (painted) {
    console.log(
      `[ShoppingChina USD] ${painted} producto(s) con USD calculado (tasa ${currentRate})`
    );
  }
}

function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(paintAll, 300);
}

/* ---------------- arranque ---------------- */

async function init() {
  const stored = await loadStoredRate();

  // Calibración gratis (sin red) si estamos dentro de una ficha de producto.
  const calibrated = calibrateFromFicha();

  // Pintamos de inmediato con la mejor tasa disponible.
  paintAll();

  // Solo pedimos al API si la tasa está vencida y no pudimos calibrar en ficha.
  if (!calibrated && !isRateFresh(stored)) {
    const ok = await refreshRateFromApi();
    if (ok) paintAll();
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
}

init();
