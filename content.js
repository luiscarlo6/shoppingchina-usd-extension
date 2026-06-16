console.log("[ShoppingChina USD] Extensión cargada (modo hover)");

const PRODUCT_LINK_SELECTOR = [
  'a[href^="/producto/"]',
  'a[href*="shoppingchina.com.py/producto/"]'
].join(",");

const CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12 horas
const HOVER_DELAY_MS = 450; // hay que quedarse sobre el producto este tiempo
const MAX_FETCHES_PER_PAGE = 15; // tope de seguridad por sesión de página

const processedUrls = new Set(); // URLs ya resueltas (badge inyectado)
const hoverTimers = new WeakMap(); // card -> timeout pendiente
let fetchesThisPage = 0;
let isFetching = false; // garantiza 1 request a la vez

function normalizeUrl(href) {
  return new URL(href, window.location.origin).toString().split("#")[0];
}

function cacheKey(url) {
  return `shoppingChinaUsd:${url}`;
}

async function getFromCache(url) {
  const key = cacheKey(url);
  const result = await chrome.storage.local.get(key);
  const cached = result[key];

  if (!cached) return null;

  const isFresh = Date.now() - cached.savedAt < CACHE_TTL_MS;
  if (!isFresh) return null;

  return cached.value;
}

async function saveToCache(url, value) {
  await chrome.storage.local.set({
    [cacheKey(url)]: {
      value,
      savedAt: Date.now()
    }
  });
}

function extractUsdTaxFreeFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const text = doc.body.textContent.replace(/\s+/g, " ");

  const match = text.match(/U\$\s*([\d.]+,\d{2})\s*TAX\s*FREE/i);
  if (!match) return null;

  return `U$ ${match[1]} TAX FREE`;
}

async function fetchUsdPrice(productUrl) {
  const cached = await getFromCache(productUrl);
  if (cached) {
    console.log("[ShoppingChina USD] Cache hit:", productUrl, cached);
    return cached;
  }

  if (fetchesThisPage >= MAX_FETCHES_PER_PAGE) {
    throw new Error("Tope de consultas por página alcanzado");
  }

  // 1 request a la vez: si hay otra en curso, esperamos.
  while (isFetching) {
    await new Promise(r => setTimeout(r, 150));
  }

  isFetching = true;
  fetchesThisPage += 1;

  try {
    console.log("[ShoppingChina USD] Consultando ficha:", productUrl);

    const response = await fetch(productUrl, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const usdPrice = extractUsdTaxFreeFromHtml(html);

    if (usdPrice) {
      await saveToCache(productUrl, usdPrice);
    }

    return usdPrice;
  } finally {
    isFetching = false;
  }
}

function findGuaraniPriceElement(container) {
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        return /Gs\.\s*[\d.]+/.test(node.textContent)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    }
  );

  const node = walker.nextNode();
  return node?.parentElement || container;
}

function setBadge(card, text, stateClass) {
  let badge = card.querySelector(".sc-usd-taxfree-badge");

  if (!badge) {
    const priceElement = findGuaraniPriceElement(card);
    badge = document.createElement("div");
    badge.className = "sc-usd-taxfree-badge";
    priceElement.insertAdjacentElement("afterend", badge);
  }

  badge.textContent = text;
  badge.classList.remove("sc-usd-loading", "sc-usd-error");
  if (stateClass) badge.classList.add(stateClass);

  return badge;
}

function findProductContext(target) {
  const anchor = target.closest(PRODUCT_LINK_SELECTOR);

  let card = anchor || target;
  for (let i = 0; i < 12 && card && card !== document.body; i++) {
    const text = card.innerText || "";
    const hasGuaraniPrice = /Gs\.\s*[\d.]+/.test(text);
    const hasProductLink = card.querySelector?.(PRODUCT_LINK_SELECTOR);

    if (hasGuaraniPrice && hasProductLink) {
      const link = card.querySelector(PRODUCT_LINK_SELECTOR);
      if (link) {
        return { card, url: normalizeUrl(link.href) };
      }
    }

    card = card.parentElement;
  }

  return null;
}

async function resolveCard(card, url) {
  if (processedUrls.has(url)) return;
  processedUrls.add(url);

  setBadge(card, "Buscando U$...", "sc-usd-loading");

  try {
    const usdPrice = await fetchUsdPrice(url);

    if (usdPrice) {
      setBadge(card, usdPrice, null);
      console.log("[ShoppingChina USD] Precio encontrado:", usdPrice, url);
    } else {
      setBadge(card, "U$ no disponible", "sc-usd-error");
      console.warn("[ShoppingChina USD] Sin precio USD:", url);
    }
  } catch (error) {
    processedUrls.delete(url); // permitir reintento en otro hover
    setBadge(card, "U$ no disponible", "sc-usd-error");
    console.error("[ShoppingChina USD] Error:", url, error);
  }
}

function onPointerOver(event) {
  const ctx = findProductContext(event.target);
  if (!ctx) return;

  const { card, url } = ctx;
  if (!url.includes("/producto/")) return;
  if (processedUrls.has(url)) return;
  if (hoverTimers.has(card)) return;

  const timer = setTimeout(() => {
    hoverTimers.delete(card);
    resolveCard(card, url);
  }, HOVER_DELAY_MS);

  hoverTimers.set(card, timer);
}

function onPointerOut(event) {
  const ctx = findProductContext(event.target);
  if (!ctx) return;

  const { card } = ctx;
  const timer = hoverTimers.get(card);

  if (timer) {
    clearTimeout(timer);
    hoverTimers.delete(card);
  }
}

document.addEventListener("pointerover", onPointerOver, { passive: true });
document.addEventListener("pointerout", onPointerOut, { passive: true });

console.log(
  "[ShoppingChina USD] Pasá el mouse sobre un producto para ver su precio U$."
);
