/**
 * Vortex Smart Shelves - Script Cliente
 * Prateleiras inteligentes para lojas VNDA
 *
 * Instalacao via GTM:
 *   var _shelvesKey = "SUA_API_KEY";
 *   var _shelvesBase = "https://dash.seudominio.com.br";
 *   (function(){var s=document.createElement('script');s.async=true;
 *   s.src=_shelvesBase+'/shelves.js';document.head.appendChild(s)})();
 */
(function () {
  "use strict";

  // --- Config ---
  var API_KEY = window._shelvesKey || "";
  var API_BASE = window._shelvesBase || "";

  // Try to detect API_BASE from script src if not explicitly set
  if (!API_BASE) {
    if (document.currentScript && document.currentScript.src) {
      API_BASE = document.currentScript.src.replace("/shelves.js", "");
    } else {
      var scripts = document.querySelectorAll('script[src*="shelves.js"]');
      for (var i = 0; i < scripts.length; i++) {
        if (scripts[i].src.indexOf("shelves.js") !== -1) {
          API_BASE = scripts[i].src.replace("/shelves.js", "");
          break;
        }
      }
    }
  }

  if (!API_KEY) {
    console.warn("[Shelves] Missing _shelvesKey. Set window._shelvesKey before loading.");
    return;
  }

  if (!API_BASE) {
    console.error("[Shelves] Missing API_BASE. Set window._shelvesBase or load from correct domain.");
    return;
  }

  // --- Security helpers ---

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function safeUrl(url) {
    if (!url) return "#";
    var u = String(url).trim();
    if (u.indexOf("http://") === 0 || u.indexOf("https://") === 0 || u.indexOf("/") === 0) return u;
    return "#";
  }

  // --- Cookie / Session helpers ---

  function getCookie(name) {
    var match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return match ? match[2] : null;
  }

  function setCookie(name, value, days) {
    var expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = name + "=" + value + "; expires=" + expires + "; path=/; SameSite=Lax";
  }

  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // Consumer ID (persistent - 1 year cookie)
  var consumerId = getCookie("_vtx_cid");
  if (!consumerId) {
    consumerId = uuid();
    setCookie("_vtx_cid", consumerId, 365);
  }

  // Session ID (per browser session)
  var sessionId = null;
  try {
    sessionId = sessionStorage.getItem("_vtx_sid");
    if (!sessionId) {
      sessionId = uuid();
      sessionStorage.setItem("_vtx_sid", sessionId);
    }
  } catch (e) {
    sessionId = uuid();
  }

  // --- Page detection ---

  function detectPageType() {
    var path = window.location.pathname.toLowerCase();
    var body = document.body;

    if (path === "/" || path === "/home" || path === "") return "home";

    // VNDA specific body classes / data attributes (most reliable)
    if (body.classList.contains("page-product") || body.getAttribute("data-page") === "product") {
      return "product";
    }
    if (
      body.classList.contains("page-tag") ||
      body.classList.contains("page-category") ||
      body.getAttribute("data-page") === "tag" ||
      body.getAttribute("data-page") === "category"
    ) {
      return "category";
    }

    // VNDA patterns in URL
    if (/\/(produto|product|p)\//.test(path)) return "product";
    if (/\/(categoria|category|c)\//.test(path)) return "category";
    if (/\/(carrinho|cart|checkout)/.test(path)) return "cart";

    // Fallback detection by DOM elements - ONLY if not already detected as something else
    // We check for .product-section which is more specific than just any [data-product-id]
    if (document.querySelector(".product-section") || document.querySelector(".main-product-container")) {
      return "product";
    }

    return "other";
  }

  // True when the current PDP is a "kit" product. The Bulking storefront uses
  // /produto/kit-<slug> as the canonical URL pattern for bundles. The body
  // fallback covers themes that flag kits with a class name.
  function isKitProduct() {
    try {
      var path = (window.location.pathname || "").toLowerCase();
      if (/\/produto\/kit-/.test(path)) return true;
      if (document.body && /\bkit\b/.test(document.body.className || "")) return true;
    } catch (e) { /* swallow */ }
    return false;
  }

  // Anchor for kit PDPs. The promo tag row (#vtx-promo-tag-row) is already
  // rendered OUTSIDE the size/buy panel in the Bulking theme — so for kits
  // we just drop the coupon countdown and the benefits block right below it.
  //
  // Two-step lookup:
  //   1. If the row already exists (because applyPromoTagsPDP ran), use it.
  //   2. Otherwise force-create it via getOrCreatePromoTagRow(). That function
  //      anchors off the price element; if even that hasn't rendered yet,
  //      returns null and the caller is expected to retry.
  function findKitDropAnchor() {
    var existing = document.getElementById("vtx-promo-tag-row");
    if (existing) return existing;
    if (typeof getOrCreatePromoTagRow === "function") {
      return getOrCreatePromoTagRow();
    }
    return null;
  }

  function extractProductId() {
    // Try meta tag first
    var meta = document.querySelector('meta[property="product:retailer_item_id"]');
    if (meta && meta.content) return meta.content;

    // Try VNDA hidden input (common in many themes)
    var rmktId = document.getElementById("rmkt-product-id");
    if (rmktId && rmktId.value) return rmktId.value;

    // Try data attribute on a main container (avoiding individual product cards in a list)
    var el = document.querySelector(".product-section [data-product-id], .main-product [data-product-id], #product-form [data-product-id]");
    if (el) return el.getAttribute("data-product-id");

    // Generic data attribute check (if the above didn't find specific ones)
    if (!el) {
       el = document.querySelector("[data-product-id]");
       // If we're on a category page (detected earlier), we shouldn't trust a random data-product-id
       if (el && detectPageType() === "category") return null;
    }
    if (el) return el.getAttribute("data-product-id");

    // Try VNDA product page JSON
    try {
      var jsonScripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < jsonScripts.length; i++) {
        var content = jsonScripts[i].textContent;
        if (content.indexOf('"@type":"Product"') !== -1 || content.indexOf('"@type": "Product"') !== -1) {
          var ld = JSON.parse(content);
          if (ld.sku) return ld.sku;
          if (ld["@type"] === "Product" && ld.productID) return ld.productID;
          if (Array.isArray(ld)) {
            for (var j = 0; j < ld.length; j++) {
              if (ld[j]["@type"] === "Product" && ld[j].sku) return ld[j].sku;
            }
          }
        }
      }
    } catch (e) {
      // ignore
    }

    return null;
  }

  // --- Auto-injection: create anchor elements at strategic positions ---

  var INJECTION_POINTS = {
    home: [
      { after: "section.banners-grid" },
      { after: "section.products" },
      { after: "section.section-icons" },
      { before: "footer, .footer" },
      { before: "footer, .footer" }
    ],
    product: [
      { before: "#yv-reviews, .product-reviews, footer, .footer" },
      { before: "#yv-reviews, .product-reviews, footer, .footer" },
      { before: "#yv-reviews, .product-reviews, footer, .footer" },
      { before: "#yv-reviews, .product-reviews, footer, .footer" }
    ],
    category: [
      { after: "section.products, .category-products" },
      { before: "footer, .footer" }
    ],
    cart: [
      { before: "footer, .footer" }
    ]
  };

  function findElement(selectorList) {
    var selectors = selectorList.split(",");
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i].trim());
      if (el) return el;
    }
    return null;
  }

  function getOrCreateAnchor(shelf, pageType, index) {
    // 1. Try explicit anchor_selector from config
    if (shelf.anchor_selector) {
      var el = document.querySelector(shelf.anchor_selector);
      if (el) return el;
    }

    // 2. Check if auto-created anchor already exists
    var existingId = "vtx-shelf-" + shelf.position;
    var existing = document.getElementById(existingId);
    if (existing) return existing;

    // 3. Auto-create and inject at strategic position
    var anchor = document.createElement("div");
    anchor.id = existingId;
    anchor.className = "vtx-shelf-container";

    var points = INJECTION_POINTS[pageType] || [{ before: "footer, .footer" }];
    var point = points[index] || points[points.length - 1];

    var ref = null;
    if (point.after) {
      ref = findElement(point.after);
      if (ref && ref.parentNode) {
        ref.parentNode.insertBefore(anchor, ref.nextSibling);
        console.log("[Shelves] Injected #" + existingId, "after", point.after);
        return anchor;
      }
    }
    if (point.before) {
      ref = findElement(point.before);
      if (ref && ref.parentNode) {
        ref.parentNode.insertBefore(anchor, ref);
        console.log("[Shelves] Injected #" + existingId, "before", point.before);
        return anchor;
      }
    }

    // Last resort: append to main or body
    var container = document.querySelector("main") || document.body;
    container.appendChild(anchor);
    console.log("[Shelves] Injected #" + existingId, "at end of", container.tagName);
    return anchor;
  }

  // --- API calls ---

  function fetchJSON(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function fetchConfig(pageType) {
    return fetchJSON(
      API_BASE + "/api/shelves/config?key=" + API_KEY + "&page_type=" + pageType
    );
  }

  function fetchRecommend(shelf, extraParams) {
    var url =
      API_BASE +
      "/api/shelves/recommend?key=" + API_KEY +
      "&algorithm=" + shelf.algorithm +
      "&consumer_id=" + consumerId +
      "&limit=" + shelf.max_products;

    if (shelf.tags && Array.isArray(shelf.tags) && shelf.tags.length > 0) {
      url += "&tags=" + encodeURIComponent(shelf.tags.join(","));
    }

    if (shelf.price_min !== undefined && shelf.price_min !== null) {
      url += "&price_min=" + encodeURIComponent(shelf.price_min);
    }
    if (shelf.price_max !== undefined && shelf.price_max !== null) {
      url += "&price_max=" + encodeURIComponent(shelf.price_max);
    }

    if (extraParams) {
      Object.keys(extraParams).forEach(function (k) {
        if (extraParams[k]) url += "&" + k + "=" + encodeURIComponent(extraParams[k]);
      });
    }

    return fetchJSON(url);
  }

  function trackEvent(eventType, productId, shelfConfigId) {
    var body = {
      key: API_KEY,
      session_id: sessionId,
      consumer_id: consumerId,
      event_type: eventType,
      product_id: productId || null,
      page_type: detectPageType(),
      shelf_config_id: shelfConfigId || null,
    };

    var payload = JSON.stringify(body);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        API_BASE + "/api/shelves/track",
        new Blob([payload], { type: "application/json" })
      );
    } else {
      fetch(API_BASE + "/api/shelves/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(function () {});
    }
  }

  // --- GA4 events ---

  function fireGA4Impression(shelf, products) {
    var dl = window.dataLayer;
    if (!dl) return;

    var algorithmMap = {
      bestsellers: "best-sellers",
      news: "news",
      offers: "offers",
      most_popular: "most-popular",
      last_viewed: "last-viewed",
      related_products: "related-products",
      custom_tags: "custom-tags",
      price_range: "price-range",
    };

    var listId = "vortex-" + (algorithmMap[shelf.algorithm] || shelf.algorithm);

    dl.push({
      event: "view_item_list",
      item_list_id: listId,
      item_list_name: shelf.title,
      items: products.map(function (p, idx) {
        return {
          item_id: p.product_id,
          item_name: p.name,
          price: p.sale_price || p.price,
          index: idx,
          item_list_id: listId,
          item_list_name: shelf.title,
        };
      }),
    });
  }

  function fireGA4Click(shelf, product, position) {
    var dl = window.dataLayer;
    if (!dl) return;

    var algorithmMap = {
      bestsellers: "best-sellers",
      news: "news",
      offers: "offers",
      most_popular: "most-popular",
      last_viewed: "last-viewed",
      related_products: "related-products",
      custom_tags: "custom-tags",
      price_range: "price-range",
    };

    var listId = "vortex-" + (algorithmMap[shelf.algorithm] || shelf.algorithm);

    dl.push({
      event: "select_item",
      item_list_id: listId,
      item_list_name: shelf.title,
      items: [
        {
          item_id: product.product_id,
          item_name: product.name,
          price: product.sale_price || product.price,
          index: position,
          item_list_id: listId,
        },
      ],
    });
  }

  // --- Render ---

  function formatPrice(value) {
    if (!value && value !== 0) return "0,00";
    var parts = parseFloat(value).toFixed(2).split(".");
    return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + parts[1];
  }

  function buildProductCard(product) {
    var hasDiscount = product.sale_price && product.sale_price < product.price;
    var tags = (product.tags && typeof product.tags === 'object') ? product.tags : {};
    
    // Badge based on VNDA tags or algorithm
    var badgeLabel = "";
    if (tags.vnda_tags && Array.isArray(tags.vnda_tags)) {
      var isBestseller = tags.vnda_tags.some(function(t) { return t.name === 'Mais Vendidos'; });
      if (isBestseller) badgeLabel = "MAIS VENDIDOS";
    }
    if (!badgeLabel && (product.algorithm === 'bestsellers' || product.algorithm === 'most_popular')) {
       badgeLabel = "MAIS VENDIDOS";
    }

    var priceHTML = "";
    if (hasDiscount) {
      var pct = Math.round(((product.price - product.sale_price) / product.price) * 100);
      priceHTML =
        '<div class="vtx-price-row">' +
          '<div class="vtx-price-top">' +
            (pct > 0 ? '<span class="vtx-discount-badge">-' + pct + '%</span>' : '') +
            '<span class="vtx-price-old">R$ ' + formatPrice(product.price) + '</span>' +
          '</div>' +
          '<span class="vtx-price-main">R$ ' + formatPrice(product.sale_price) + '</span>' +
        '</div>';
    } else {
      priceHTML =
        '<div class="vtx-price-row">' +
          '<span class="vtx-price-main">R$ ' + formatPrice(product.price) + '</span>' +
        '</div>';
    }

    var imgOriginal = normalizeUrl(product.image_url || "");
    var imgOriginal2 = normalizeUrl(product.image_url_2 || "");
    var imgSrc = cleanUrl(product.image_url || "");
    var imgSrc2 = cleanUrl(product.image_url_2 || "");
    var hasHoverImage = !!(imgSrc2 && imageKey(imgSrc2) !== imageKey(imgSrc));
    var link = product.product_url || "#";
    
    // Fix link suffix if missing
    var sufix = "-" + product.product_id;
    if (link !== "#" && product.product_id && link.indexOf(sufix, link.length - sufix.length) === -1) {
       // Only append if it doesn't already have a numeric suffix that looks like an ID
       if (!/-\d+$/.test(link)) {
         link = link.replace(/\/$/, "") + sufix;
       }
    }

    return (
      '<div class="product-block" data-vtx-product-id="' + escapeHtml(product.product_id) + '">' +
        '<div class="images">' +
          (badgeLabel ? '<div class="vtx-badge">' + escapeHtml(badgeLabel) + '</div>' : '') +
          '<a href="' + safeUrl(link) + '">' +
            '<figure class="image' + (hasHoverImage ? " has-hover-image" : "") + '">' +
              '<img class="vtx-product-img vtx-product-img-primary" alt="' + escapeHtml(product.name) + '" src="' + escapeHtml(imgSrc) + '" data-vtx-primary-src="' + escapeHtml(imgSrc) + '" data-vtx-primary-fallback-src="' + escapeHtml(imgOriginal) + '" data-vtx-fallback-src="' + escapeHtml(imgOriginal) + '"' +
                (hasHoverImage ? ' data-vtx-secondary-src="' + escapeHtml(imgSrc2) + '" data-vtx-secondary-fallback-src="' + escapeHtml(imgOriginal2) + '"' : '') +
                ' loading="lazy">' +
              (hasHoverImage
                ? '<img class="vtx-product-img vtx-product-img-secondary" alt="' + escapeHtml(product.name) + '" src="' + escapeHtml(imgSrc2) + '" data-vtx-fallback-src="' + escapeHtml(imgOriginal2 || imgSrc2) + '" data-vtx-image-role="secondary" loading="lazy" aria-hidden="true">'
                : '') +
            "</figure>" +
          "</a>" +
        "</div>" +
        '<div class="description">' +
          '<h3 class="name"><a href="' + safeUrl(link) + '">' + escapeHtml(product.name) + "</a></h3>" +
          priceHTML +
        "</div>" +
      "</div>"
    );
  }

  function normalizeUrl(url) {
    if (!url) return "";
    var u = url;
    if (u && u.indexOf("//") === 0) u = "https:" + u;
    return u;
  }

  function cleanUrl(url) {
    var u = normalizeUrl(url);
    if (!u) return "";
    if (u.indexOf("cdn.vnda.com.br") !== -1) {
      u = u.replace(/cdn\.vnda\.com\.br\/(?:(?:\d+x(?:\d+)?|x\d+)\/)?/, "cdn.vnda.com.br/800x/");
    }
    return u;
  }

  function imageKey(url) {
    var u = normalizeUrl(url);
    if (!u) return "";
    try {
      var parsed = new URL(u, window.location.origin);
      var path = parsed.pathname.replace(/^\/(?:\d+x(?:\d+)?|x\d+)\//i, "/");
      return (parsed.hostname + path).toLowerCase();
    } catch (e) {
      return u
        .replace(/^https?:\/\//i, "//")
        .replace(/(\/\/cdn\.vnda\.com\.br\/)(?:(?:\d+x(?:\d+)?|x\d+)\/)/i, "$1")
        .split("?")[0]
        .split("#")[0]
        .toLowerCase();
    }
  }

  function getViewAllUrl(algorithm) {
    switch (algorithm) {
      case "news":           return "/lancamentos";
      case "bestsellers":    return "/mais-vendidos";
      case "offers":         return "/mais-vendidos";
      case "most_popular":   return "/mais-vendidos";
      default:               return "/todos";
    }
  }

  function buildShelfHTML(shelf, products) {
    var slides = products
      .map(function (p) {
        return '<div class="swiper-slide">' + buildProductCard(p) + "</div>";
      })
      .join("");

    return (
      '<section class="section products carousel container vtx-shelf" data-vtx-algorithm="' + escapeHtml(shelf.algorithm) + '">' +
        '<div class="header">' +
          '<h2 class="title">' + escapeHtml(shelf.title) + "</h2>" +
          '<a href="' + getViewAllUrl(shelf.algorithm) + '" class="view-all">ver todas <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></a>' +
        "</div>" +
        '<div class="swiper vtx-swiper">' +
          '<div class="swiper-wrapper">' +
            slides +
          "</div>" +
          '<div class="swiper-button-prev"></div>' +
          '<div class="swiper-button-next"></div>' +
        "</div>" +
      "</section>"
    );
  }

  function initSwiper(container) {
    var swiperEl = container.querySelector(".vtx-swiper");
    if (!swiperEl) return;

    function tryInit() {
      if (window.Swiper) {
        new Swiper(swiperEl, {
          slidesPerView: 2,
          spaceBetween: 16,
          navigation: {
            nextEl: swiperEl.querySelector(".swiper-button-next"),
            prevEl: swiperEl.querySelector(".swiper-button-prev"),
          },
          breakpoints: {
            660: { slidesPerView: 2, spaceBetween: 15 },
            1030: { slidesPerView: 3, spaceBetween: 22 },
            1280: { slidesPerView: 3.4, spaceBetween: 24 },
          },
        });
        console.log("[Shelves] Swiper initialized");
      } else {
        // Load Swiper if not present
        if (!document.getElementById("vtx-swiper-js")) {
          var s = document.createElement("script");
          s.id = "vtx-swiper-js";
          s.src = "https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js";
          document.head.appendChild(s);
          
          var l = document.createElement("link");
          l.rel = "stylesheet";
          l.href = "https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css";
          document.head.appendChild(l);
        }
        setTimeout(tryInit, 300);
      }
    }
    tryInit();
  }


  // --- Inject minimal CSS ---

  function injectStyles() {
    var css =
      ".vtx-shelf-container { width: 100%; max-width: none; }" +
      ".vtx-shelf { margin: 40px auto; font-family: 'Inter', sans-serif; position: relative; width: calc(100% - clamp(24px, 3vw, 56px)); max-width: 1680px; padding: 0; box-sizing: border-box; }" +
      ".vtx-shelf .header { text-align: center; margin-bottom: 24px; position: relative; }" +
      ".vtx-shelf .header .title { font-size: 24px; font-weight: 900; color: #000; text-transform: uppercase; letter-spacing: 1px; margin: 0; }" +
      ".vtx-shelf .header .view-all { display: block; font-size: 12px; color: #666; text-decoration: none; margin-top: 8px; text-transform: lowercase; }" +
      ".vtx-shelf .product-block { position: relative; padding: 0; transition: transform 0.2s; cursor: pointer; text-align: left; }" +
      ".vtx-shelf .images { position: relative; margin-bottom: 12px; overflow: hidden; border-radius: 4px; background: #f5f5f5; width: 100%; }" +
      ".vtx-shelf .images .image { margin: 0; aspect-ratio: 2 / 3; position: relative; width: 100%; display: block; }" +
      ".vtx-shelf .images .image img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity 0.3s; }" +
      ".vtx-shelf .images .image.has-hover-image .vtx-product-img-primary { backface-visibility: hidden; opacity: 1; }" +
      ".vtx-shelf .images .image .vtx-product-img-secondary { opacity: 0; z-index: 2; }" +
      ".vtx-shelf .images:hover .image.has-hover-image .vtx-product-img-primary, .vtx-shelf .images .image.has-hover-image:hover .vtx-product-img-primary, .vtx-shelf .images .image.has-hover-image.vtx-hovering .vtx-product-img-primary { opacity: 0; }" +
      ".vtx-shelf .images:hover .image.has-hover-image .vtx-product-img-secondary, .vtx-shelf .images .image.has-hover-image:hover .vtx-product-img-secondary, .vtx-shelf .images .image.has-hover-image.vtx-hovering .vtx-product-img-secondary { opacity: 1; }" +
      ".vtx-badge { position: absolute; top: 10px; right: 10px; background: #fff; color: #000; padding: 4px 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; z-index: 10; border: 1px solid #eee; }" +
      ".vtx-discount-circle { position: absolute; bottom: 10px; left: 10px; background: #ff0000; color: #fff; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 900; z-index: 10; }" +
      ".vtx-shelf .description { text-align: left; }" +
      ".vtx-shelf .name { font-size: 13px; font-weight: 600; text-transform: uppercase; color: #333; margin: 0 0 4px; }" +
      ".vtx-shelf .name a { color: inherit; text-decoration: none; }" +
      ".vtx-stars { display: flex !important; align-items: center !important; gap: 2px !important; margin-bottom: 8px !important; white-space: nowrap !important; flex-wrap: nowrap !important; line-height: 1 !important; width: 100% !important; overflow: hidden !important; }" +
      ".vtx-stars .star { color: #ffd700 !important; font-size: 11px !important; display: inline-block !important; flex-shrink: 0 !important; }" +
      ".vtx-stars .count { font-size: 10px !important; color: #999 !important; margin-left: 4px !important; font-weight: 500 !important; display: inline-block !important; flex-shrink: 0 !important; }" +
      ".vtx-price-row { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }" +
      ".vtx-price-top { display: flex; align-items: center; gap: 8px; }" +
      ".vtx-price-old { font-size: 12px; color: #999; text-decoration: line-through; }" +
      ".vtx-price-main { font-size: 20px; font-weight: 900; color: #000; line-height: 1; }" +
      ".vtx-discount-badge { background: #ff0000; color: #fff; padding: 2px 4px; font-size: 10px; font-weight: 900; border-radius: 2px; }" +
      ".vtx-swiper { padding: 0 0 20px; position: relative; }" +
      ".vtx-swiper .swiper-pagination { display: none !important; }" +
      ".vtx-swiper .swiper-button-next, .vtx-swiper .swiper-button-prev { color: #333 !important; width: 34px; height: 34px; background: #fff; border-radius: 50%; box-shadow: 0 2px 8px rgba(0,0,0,0.15); transition: opacity 0.2s; }" +
      ".vtx-swiper .swiper-button-next:after, .vtx-swiper .swiper-button-prev:after { font-size: 14px; font-weight: bold; }" +
      ".vtx-skel-title { width: 200px; height: 24px; background: #eee; border-radius: 4px; margin: 0 auto 24px; }" +
      ".vtx-skel-card { flex: 0 0 31%; aspect-ratio: 2 / 3; background: #eee; border-radius: 4px; animation: vtx-pulse 1.5s infinite; }" +
      "@keyframes vtx-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }" +
      "@media (max-width: 768px) {" +
        ".vtx-shelf { width: 100%; padding: 0 15px; }" +
        ".vtx-shelf .header .title { font-size: 18px; }" +
        ".vtx-shelf .images .image { aspect-ratio: 9 / 16; }" +
        ".vtx-price-main { font-size: 18px; }" +
        ".vtx-skel-card { flex: 0 0 47%; aspect-ratio: 9 / 16; }" +
      "}";

    var style = document.createElement("style");
    style.id = "vtx-shelf-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // --- Mobile sticky buy bar enhancement (Aramis-style) ---
  // The VNDA theme already creates a native mobile sticky buy bar (.form-floating,
  // built on scroll via data-floating-button). It ships with two problems:
  //   1) transition: all 10s ease-in  -> the bar crawls in over 10s, so it only
  //      becomes visible "way further down" as you scroll (the user's complaint).
  //   2) default styling is a flat light-gray block with a loud green button.
  // We override ONLY via CSS (no extra button, no DOM changes) so the existing bar
  // snaps in fast (.22s) and reads like Aramis: clean white bar + dark CTA.
  //
  // ROLLOUT/REVERT knob:
  //   "1271" -> test on a single PDP (BASIC PRETA)
  //   null   -> enable on ALL product pages
  //   ""     -> disabled (full revert, no CSS injected)
  var BUYBAR_ENHANCE_PRODUCT_ID = "1271";

  function enhanceMobileBuyBar(productId) {
    if (!BUYBAR_ENHANCE_PRODUCT_ID && BUYBAR_ENHANCE_PRODUCT_ID !== null) return; // "" = off
    if (BUYBAR_ENHANCE_PRODUCT_ID && productId !== BUYBAR_ENHANCE_PRODUCT_ID) return;
    if (document.getElementById("bk-buybar-enhance")) return;
    var css =
      "@media (max-width: 767px) {" +
        // 1) behavior: kill the 10s lag so the native bar appears instantly
        ".form-floating { transition: all .22s ease !important; }" +
        // 2) style: clean white floating bar with separation from the page
        ".form-floating .block-info { background:#fff !important; box-shadow:0 -8px 26px rgba(0,0,0,.16) !important; border-top:1px solid #ececec !important; padding:10px 14px calc(10px + env(safe-area-inset-bottom)) !important; gap:8px !important; }" +
        ".form-floating .block-info .attributes { margin:0 0 4px !important; }" +
        ".form-floating .block-info .attributes .option-Tamanho { gap:6px !important; }" +
        // 3) CTA: brand-dark, full-width, compact (overrides the native 2rem green)
        ".form-floating .actions-wrapper { font-size:15px !important; }" +
        ".form-floating .add-to-cart-button { background:#111 !important; color:#fff !important; border:none !important; border-radius:10px !important; width:100% !important; height:50px !important; font-size:15px !important; font-weight:800 !important; letter-spacing:.04em !important; text-transform:uppercase !important; }" +
      "}";
    var style = document.createElement("style");
    style.id = "bk-buybar-enhance";
    style.textContent = css;
    document.head.appendChild(style);
    console.log("[Shelves] Mobile buy bar enhanced (Aramis-style) for product", productId);
  }

  function attachImageFallbacks(container) {
    var imgs = container.querySelectorAll(".vtx-product-img");
    for (var i = 0; i < imgs.length; i++) {
      (function (img) {
        if (img.getAttribute("data-vtx-fallback-bound") === "1") return;
        img.setAttribute("data-vtx-fallback-bound", "1");
        img.addEventListener("error", function () {
          var fallback = img.getAttribute("data-vtx-fallback-src") || "";
          if (fallback && img.src !== fallback && img.getAttribute("data-vtx-used-fallback") !== "1") {
            img.setAttribute("data-vtx-used-fallback", "1");
            img.src = fallback;
            return;
          }

          var figure = img.closest(".image");
          if (figure && (img.getAttribute("data-vtx-image-mode") === "secondary" || img.getAttribute("data-vtx-image-role") === "secondary")) {
            disableProductImageHover(figure);
          }
        });
      })(imgs[i]);
    }
  }

  function setProductImageSource(img, src, fallback, mode) {
    if (!img || !src) return;
    img.removeAttribute("data-vtx-used-fallback");
    img.setAttribute("data-vtx-image-mode", mode || "primary");
    img.setAttribute("data-vtx-fallback-src", fallback || src);
    if (img.getAttribute("src") !== src) img.setAttribute("src", src);
  }

  function restoreProductPrimaryImage(figure, img) {
    if (!img) return;
    figure.classList.remove("vtx-hovering");
    setProductImageSource(
      img,
      img.getAttribute("data-vtx-primary-src") || "",
      img.getAttribute("data-vtx-primary-fallback-src") || "",
      "primary"
    );
  }

  function disableProductImageHover(figure) {
    if (!figure) return;
    figure.classList.remove("has-hover-image", "vtx-hovering");
    figure.setAttribute("data-vtx-hover-disabled", "1");
    var primary = figure.querySelector(".vtx-product-img-primary");
    var secondary = figure.querySelector(".vtx-product-img-secondary");
    if (secondary) secondary.style.display = "none";
    if (primary) restoreProductPrimaryImage(figure, primary);
  }

  function attachProductImageHover(container) {
    var figures = container.querySelectorAll(".image.has-hover-image");
    for (var i = 0; i < figures.length; i++) {
      (function (figure) {
        if (figure.getAttribute("data-vtx-hover-bound") === "1") return;
        figure.setAttribute("data-vtx-hover-bound", "1");

        var img = figure.querySelector(".vtx-product-img-primary");
        if (!img) return;
        var secondaryImg = figure.querySelector(".vtx-product-img-secondary");

        var primarySrc = img.getAttribute("data-vtx-primary-src") || "";
        var primaryFallback = img.getAttribute("data-vtx-primary-fallback-src") || "";
        var secondarySrc = img.getAttribute("data-vtx-secondary-src") || "";
        var secondaryFallback = img.getAttribute("data-vtx-secondary-fallback-src") || "";
        if (!secondarySrc || imageKey(secondarySrc) === imageKey(primarySrc)) {
          figure.classList.remove("has-hover-image");
          return;
        }

        var activeSecondarySrc = secondarySrc;
        var probe = new Image();
        probe.onload = function () { activeSecondarySrc = secondarySrc; };
        probe.onerror = function () {
          if (secondaryFallback && secondaryFallback !== secondarySrc) {
            var fallbackProbe = new Image();
            fallbackProbe.onload = function () {
              activeSecondarySrc = secondaryFallback;
              if (secondaryImg) secondaryImg.setAttribute("src", secondaryFallback);
            };
            fallbackProbe.onerror = function () { disableProductImageHover(figure); };
            fallbackProbe.src = secondaryFallback;
            return;
          }
          disableProductImageHover(figure);
        };
        probe.src = secondarySrc;

        function on() {
          if (figure.getAttribute("data-vtx-hover-disabled") === "1") return;
          figure.classList.add("vtx-hovering");
          if (!secondaryImg) {
            setProductImageSource(img, activeSecondarySrc, secondaryFallback || activeSecondarySrc, "secondary");
          }
        }
        function off() {
          if (!secondaryImg) {
            setProductImageSource(img, primarySrc, primaryFallback || primarySrc, "primary");
          }
          figure.classList.remove("vtx-hovering");
        }

        var trigger = figure.closest(".images") || figure;
        trigger.addEventListener("mouseenter", on);
        trigger.addEventListener("mouseleave", off);
        trigger.addEventListener("pointerenter", on);
        trigger.addEventListener("pointerleave", off);
        figure.addEventListener("focusin", on);
        figure.addEventListener("focusout", off);
      })(figures[i]);
    }
  }

  // --- Main ---

  function renderShelf(shelf, products, anchor) {
    var html = buildShelfHTML(shelf, products);
    anchor.innerHTML = html;
    attachImageFallbacks(anchor);
    attachProductImageHover(anchor);

    // Init Swiper carousel
    initSwiper(anchor);

    // Fire GA4 impression
    fireGA4Impression(shelf, products);

    // Attach click handlers
    var cards = anchor.querySelectorAll(".product-block[data-vtx-product-id]");
    for (var i = 0; i < cards.length; i++) {
      (function (card, idx) {
        card.addEventListener("click", function (e) {
          var pid = card.getAttribute("data-vtx-product-id");
          var product = null;
          for (var j = 0; j < products.length; j++) {
            if (products[j].product_id === pid) {
              product = products[j];
              break;
            }
          }
          if (!product) product = products[idx];

          if (product) {
            trackEvent("click", pid, shelf.id);
            fireGA4Click(shelf, product, idx);
          }
        });
      })(cards[i], i);
    }

    // Track shelf impression
    trackEvent("impression", null, shelf.id);
  }

  function showSkeleton(anchor) {
    anchor.innerHTML =
      '<section class="vtx-shelf vtx-skeleton">' +
        '<div class="header"><div class="vtx-skel-title"></div></div>' +
        '<div style="display:flex;gap:16px;overflow:hidden">' +
          '<div class="vtx-skel-card"></div>' +
          '<div class="vtx-skel-card"></div>' +
          '<div class="vtx-skel-card"></div>' +
          '<div class="vtx-skel-card"></div>' +
        '</div>' +
      '</section>';
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function fetchWithTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error("Timeout")); }, ms);
      })
    ]);
  }

  function init() {
    var pageType = detectPageType();
    var productId = extractProductId();

    console.log("[Shelves] Initializing on page type:", pageType, "with product ID:", productId);

    if (pageType === "product" && !productId) {
      console.warn("[Shelves] Product page detected but no product ID found. Retrying in 1s...");
      setTimeout(init, 1000);
      return;
    }
    if (pageType === "other") return;

    // Inject styles
    injectStyles();

    // Enhance the native mobile sticky buy bar (Aramis-style) on PDPs
    if (pageType === "product") enhanceMobileBuyBar(productId);

    // Fetch config
    fetchConfig(pageType)
      .then(function (configData) {
        var shelves = configData.shelves || [];
        console.log("[Shelves] Config received:", shelves.length, "shelves definitions");

        if (shelves.length === 0) {
          console.warn("[Shelves] No enabled shelves found for page type:", pageType);
          return;
        }

        // Build extra params for product pages
        var extraParams = {};
        if (pageType === "product") {
          var pid = extractProductId();
          if (pid) {
            extraParams.product_id = pid;
            trackEvent("pageview", pid, null);
          }
        }

        // Create anchors and show skeletons immediately
        var anchors = [];
        shelves.forEach(function (shelf, index) {
          var anchor = getOrCreateAnchor(shelf, pageType, index);
          anchors.push(anchor);
          if (anchor) showSkeleton(anchor);
        });

        // Fetch and render each shelf independently (progressive rendering)
        shelves.forEach(function (shelf, index) {
          var anchor = anchors[index];
          if (!anchor) return;

          fetchWithTimeout(fetchRecommend(shelf, extraParams), 8000)
            .then(function (data) {
              // Algoritmos rankeados preservam a ordem do servidor; o resto embaralha p/ variedade.
              var PRESERVE_ORDER = { bestseller_camisetas: 1 };
              var raw = data.products || [];
              var products = PRESERVE_ORDER[shelf.algorithm] ? raw : shuffle(raw);
              console.log("[Shelves] " + shelf.algorithm + " -> " + products.length + " products");

              if (products.length === 0) {
                console.warn("[Shelves] " + shelf.algorithm + " - no products found");
                anchor.innerHTML = "";
                return;
              }

              renderShelf(shelf, products, anchor);
              console.log("[Shelves] Rendered '" + shelf.algorithm + "' at pos " + shelf.position);
            })
            .catch(function (err) {
              console.error("[Shelves] " + shelf.algorithm + " error:", err);
              anchor.innerHTML = "";
            });
        });
      })
      .catch(function (err) {
        console.error("[Shelves] Fatal Init Error:", err);
      });
  }

  // ============================================================
  // --- Gift Progress Bar (Régua de Brinde) ---
  // ============================================================

  function parseBRL(text) {
    if (!text) return 0;
    // Extract the first valid price format (e.g. "R$ 178,00" -> "178,00")
    // This avoids merging numbers like "12x de R$ 18,27" into "1218.27"
    var match = String(text).match(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/);
    if (match) {
      var clean = match[1].replace(/\./g, "").replace(",", ".");
      return parseFloat(clean) || 0;
    }
    // Fallback
    var cleanFallback = String(text).replace(/[^\d,.]/g, "").replace(/\./g, "").replace(",", ".");
    return parseFloat(cleanFallback) || 0;
  }

  function formatBRL(value) {
    var parts = parseFloat(value).toFixed(2).split(".");
    return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + parts[1];
  }

  function querySelectorAllDeep(selector, root) {
    root = root || document;
    var elements = Array.prototype.slice.call(root.querySelectorAll(selector));
    var allNodes = root.querySelectorAll('*');
    for (var i = 0; i < allNodes.length; i++) {
      if (allNodes[i].shadowRoot) {
        elements = elements.concat(querySelectorAllDeep(selector, allNodes[i].shadowRoot));
      }
    }
    return elements;
  }

  function getCartTotal(callback) {
    try {
      // 1. Try DOM: cart total elements first (most reliable for AJAX updates)
      var selectors = [
        "[data-cart-total]",
        ".cart-total",
        ".order-total .value",
        ".cart-subtotal",
        ".cart-drawer-total",
        ".CartDrawer-total",
        "#cart-total",
        "[data-total-price]",
        ".cart-drawer-subtotal-value",
        ".cart-drawer-total-value",
        ".card-drawer-cta",
        "tr.total .value",
        ".summary-total",
        ".c-summary__total-value",
        "p.total span",
        "[data-checkout-total]"
      ];
      for (var i = 0; i < selectors.length; i++) {
        var els = querySelectorAllDeep(selectors[i]);
        for (var j = 0; j < els.length; j++) {
          var el = els[j];
          var val = parseBRL(el.textContent || el.getAttribute("data-cart-total") || el.getAttribute("data-total-price"));
          if (val > 0) return callback(val);
        }
      }

      // 2. Try global cart objects (VNDA themes fallback)
      if (window.cart && typeof window.cart.total === "number" && window.cart.total > 0) {
        return callback(window.cart.total);
      }
      if (window.vnda && window.vnda.cart && typeof window.vnda.cart.total === "number" && window.vnda.cart.total > 0) {
        return callback(window.vnda.cart.total);
      }

      // 3. Fetch /carrinho and parse (last resort)
      // Use include_bundle_items=true to avoid 302 redirect on some VNDA stores
      fetch("/carrinho?include_bundle_items=true", { credentials: "same-origin" })

        .then(function (r) { return r.text(); })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, "text/html");
          for (var j = 0; j < selectors.length; j++) {
            var found = doc.querySelector(selectors[j]);
            if (found) {
              var v = parseBRL(found.textContent || found.getAttribute("data-cart-total") || found.getAttribute("data-total-price"));
              if (v > 0) return callback(v);
            }
          }
          callback(0);
        })
        .catch(function () { callback(0); });
    } catch (e) {
      callback(0);
    }
  }

  function setupCartListeners(onUpdate) {
    // The current store theme only dispatches `vnda:cart-drawer-loaded`
    // (re-fired whenever the drawer re-renders after an add/remove/update).
    // The old `vnda:cart-drawer-*-item` / `-coupon-*` names are no longer
    // emitted, so those were dead no-op listeners. The fetch hook and the
    // MutationObserver below remain the primary, theme-independent triggers;
    // this just adds the lighter, direct signal the theme actually fires.
    var CART_EVENTS = ["vnda:cart-drawer-loaded"];

    var debounceTimer = null;
    function debouncedUpdate() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        getCartTotal(onUpdate);
      }, 500);
    }

    // Listen for VNDA cart events
    CART_EVENTS.forEach(function (evt) {
      window.addEventListener(evt, debouncedUpdate);
    });

    // Intercept fetch calls to cart endpoints
    if (window.fetch && !window._vtxFetchPatched) {
      var origFetch = window.fetch;
      window._vtxFetchPatched = true;
      window.fetch = function () {
        var result = origFetch.apply(this, arguments);
        var url = typeof arguments[0] === "string" ? arguments[0] : (arguments[0] && arguments[0].url) || "";
        if (url.indexOf("/carrinho") !== -1 || url.indexOf("/cart") !== -1) {
          result.then(function () {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function () {
              getCartTotal(onUpdate);
            }, 800);
          }).catch(function () {});
        }
        return result;
      };
    }

    // MutationObserver for cart total changes anywhere in the body
    var observer = new MutationObserver(debouncedUpdate);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }


  // Inline SVGs for step icons (24x24, currentColor)
  var GB_ICONS = {
    truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>',
    gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>',
    percent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
    sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.7L19.6 10.6 13.9 12.5 12 18.2l-1.9-5.7L4.4 10.6 10.1 8.7z"/><path d="M19 3v4"/><path d="M21 5h-4"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
    crown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    medal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="M13 12l5.88-9.8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/></svg>',
    shirt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  function renderIcon(icon) {
    if (!icon) return GB_ICONS.gift;
    if (typeof icon !== "string") return GB_ICONS.gift;
    if (icon.indexOf("http") === 0) {
      return '<img src="' + escapeHtml(icon) + '" alt="" style="width:60%;height:60%;object-fit:contain">';
    }
    if (GB_ICONS[icon]) return GB_ICONS[icon];
    return '<span style="font-size:18px">' + escapeHtml(icon) + '</span>';
  }

  function injectGiftBarModalCSSOnce() {
    if (document.getElementById("vtx-gb-modal-styles")) return;
    var css =
      "#vtx-gb-modal{position:fixed;inset:0;z-index:99999;display:none}" +
      "#vtx-gb-modal.vtx-gb-modal-open{display:block}" +
      ".vtx-gb-modal-backdrop{position:absolute;inset:0;background:rgba(17,24,39,.55);backdrop-filter:blur(2px)}" +
      ".vtx-gb-modal-card{position:relative;max-width:520px;width:calc(100% - 32px);margin:60px auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px 24px 22px;box-shadow:0 20px 50px -10px rgba(17,24,39,.25);font-family:'Inter',system-ui,sans-serif;color:#111827}" +
      ".vtx-gb-modal-close{position:absolute;top:10px;right:14px;background:none;border:none;font-size:26px;line-height:1;color:#9ca3af;cursor:pointer;padding:4px 8px;border-radius:6px}" +
      ".vtx-gb-modal-close:hover{color:#374151;background:#f3f4f6}" +
      ".vtx-gb-modal-title{margin:0 0 12px;font-size:17px;font-weight:600;color:#111827}" +
      ".vtx-gb-modal-body{font-size:14px;line-height:1.55;color:#374151}" +
      ".vtx-gb-modal-body table{width:100%;border-collapse:collapse;margin:8px 0;font-size:13px}" +
      ".vtx-gb-modal-body th,.vtx-gb-modal-body td{padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:left}" +
      ".vtx-gb-modal-body th{background:#f9fafb;font-weight:600;color:#4b5563;font-size:12px;text-transform:uppercase;letter-spacing:.04em}" +
      ".vtx-gb-modal-body tr:last-child td{border-bottom:none}" +
      ".vtx-gb-modal-body p{margin:0 0 8px}" +
      "@media(max-width:768px){.vtx-gb-modal-card{margin:32px auto}}";
    var style = document.createElement("style");
    style.id = "vtx-gb-modal-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function injectGiftBarModalOnce() {
    injectGiftBarModalCSSOnce();
    if (document.getElementById("vtx-gb-modal")) return;
    var modal = document.createElement("div");
    modal.id = "vtx-gb-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<div class="vtx-gb-modal-backdrop"></div>' +
      '<div class="vtx-gb-modal-card" role="dialog" aria-modal="true">' +
        '<button type="button" class="vtx-gb-modal-close" aria-label="Fechar">×</button>' +
        '<h3 class="vtx-gb-modal-title"></h3>' +
        '<div class="vtx-gb-modal-body"></div>' +
      '</div>';
    document.body.appendChild(modal);

    function closeModal() {
      modal.classList.remove("vtx-gb-modal-open");
      modal.setAttribute("aria-hidden", "true");
    }
    modal.querySelector(".vtx-gb-modal-backdrop").addEventListener("click", closeModal);
    modal.querySelector(".vtx-gb-modal-close").addEventListener("click", closeModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
  }

  function openGiftBarModal(title, bodyHtml) {
    injectGiftBarModalOnce();
    var modal = document.getElementById("vtx-gb-modal");
    modal.querySelector(".vtx-gb-modal-title").textContent = title || "";
    modal.querySelector(".vtx-gb-modal-body").innerHTML = bodyHtml || "";
    modal.classList.add("vtx-gb-modal-open");
    modal.setAttribute("aria-hidden", "false");
  }

  // Product Benefits: vertical list rendered below the buy button on PDP
  function renderProductBenefits(cfg, retries) {
    retries = retries || 0;
    var benefits = Array.isArray(cfg.product_benefits) ? cfg.product_benefits : [];
    if (benefits.length === 0) return;
    if (document.getElementById("vtx-product-benefits")) return;

    // Inject styles once
    if (!document.getElementById("vtx-product-benefits-styles")) {
      var pbCss =
        "#vtx-product-benefits{margin:24px 0;padding:20px 0;border-top:1px solid #e5e7eb;font-family:'Inter',system-ui,sans-serif;color:#1f2937}" +
        ".vtx-pb-title{margin:0 0 16px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6b7280}" +
        ".vtx-pb-list{display:flex;flex-direction:column;gap:18px}" +
        ".vtx-pb-item{display:flex;align-items:flex-start;gap:14px}" +
        ".vtx-pb-icon{flex:0 0 auto;width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:#111827}" +
        ".vtx-pb-icon svg{width:100%;height:100%}" +
        ".vtx-pb-text{flex:1;min-width:0}" +
        ".vtx-pb-title-line{margin:0;font-size:15px;font-weight:500;color:#111827;line-height:1.35}" +
        ".vtx-pb-link{display:inline-block;margin-top:2px;font-size:14px;color:#6b7280;text-decoration:underline;text-underline-offset:2px;cursor:pointer;background:none;border:none;padding:0;font-family:inherit}" +
        ".vtx-pb-link:hover{color:#111827}" +
        "@media(max-width:768px){#vtx-product-benefits{margin:16px 0;padding:16px 0}.vtx-pb-title-line{font-size:14px}.vtx-pb-link{font-size:13px}}";
      var pbStyle = document.createElement("style");
      pbStyle.id = "vtx-product-benefits-styles";
      pbStyle.textContent = pbCss;
      document.head.appendChild(pbStyle);
    }

    // Build block
    var block = document.createElement("div");
    block.id = "vtx-product-benefits";
    var html =
      '<p class="vtx-pb-title">' + escapeHtml(cfg.product_benefits_title || "Nossos benefícios") + "</p>" +
      '<div class="vtx-pb-list">';
    for (var i = 0; i < benefits.length; i++) {
      var b = benefits[i];
      var hasModal = b.modal_body && String(b.modal_body).trim().length > 0;
      html +=
        '<div class="vtx-pb-item">' +
          '<div class="vtx-pb-icon">' + renderIcon(b.icon) + '</div>' +
          '<div class="vtx-pb-text">' +
            '<p class="vtx-pb-title-line">' + escapeHtml(b.title || "") + '</p>' +
            (b.link_label
              ? (hasModal
                  ? '<button type="button" class="vtx-pb-link" data-pb-idx="' + i + '">' + escapeHtml(b.link_label) + '</button>'
                  : '<span class="vtx-pb-link" style="cursor:default">' + escapeHtml(b.link_label) + '</span>')
              : "") +
          '</div>' +
        '</div>';
    }
    html += '</div>';
    block.innerHTML = html;

    // Find anchor: admin override → fallback selectors.
    // Kit products render benefits OUTSIDE the size/buy selection box
    // (visually above it), matching where the promo tag row already sits.
    var anchor = null;
    var insertBefore = false;
    if (cfg.product_benefits_anchor) {
      anchor = document.querySelector(cfg.product_benefits_anchor);
    }
    if (!anchor && isKitProduct()) {
      var kitAnchor = findKitDropAnchor();
      if (kitAnchor) {
        anchor = kitAnchor;
        // ProductBenefits is inserted as anchor.nextSibling by default — that's
        // exactly what we want here: drop right below the promo tag row.
      } else if (retries < 8) {
        // Promo tag row not in DOM yet (price element may still be rendering
        // or applyPromoTagsPDP hasn't run). Retry shortly so we don't fall
        // through to the in-skeleton .product-buy fallback.
        setTimeout(function () { renderProductBenefits(cfg, retries + 1); }, 250);
        return;
      }
    }
    if (!anchor) {
      var fallbacks = [
        ".product-buy",
        ".product-form",
        "[data-product-buy]",
        "form[data-product-form]",
        ".product__buy",
        ".product-info",
        ".product__details",
        ".product-purchase",
        ".add-to-cart",
        ".add-to-cart-button",
        ".actions-wrapper"
      ];
      for (var s = 0; s < fallbacks.length; s++) {
        anchor = document.querySelector(fallbacks[s]);
        if (anchor) break;
      }
    }
    if (!anchor) {
      console.warn("[ProductBenefits] No anchor found — set product_benefits_anchor in admin");
      return;
    }
    if (insertBefore) {
      anchor.parentNode.insertBefore(block, anchor);
    } else {
      anchor.parentNode.insertBefore(block, anchor.nextSibling);
    }

    // Wire up modals
    var btns = block.querySelectorAll(".vtx-pb-link[data-pb-idx]");
    for (var j = 0; j < btns.length; j++) {
      (function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          var idx = Number(btn.getAttribute("data-pb-idx"));
          var benefit = benefits[idx];
          if (!benefit) return;
          openGiftBarModal(benefit.modal_title || benefit.title || "", benefit.modal_body || "");
        });
      })(btns[j]);
    }

    console.log("[ProductBenefits] Rendered", benefits.length, "benefits");
  }

  // Static gift-bar variant injected into the Bulking cart drawer.
  // The drawer is a JS-mounted off-canvas component (#component-cart-drawer-root)
  // shown on every page on mobile, so we don't depend on detectPageType.
  // Reads the cart total from any visible "R$ ..." subtotal element and
  // re-renders progress/labels whenever the drawer DOM mutates.
  function attachGiftBarToCartDrawer(cfg) {
    var drawerRoot = document.getElementById("component-cart-drawer-root");
    if (!drawerRoot) return;

    // Inject styles once — reuse the existing #vtx-gift-bar look but scoped.
    if (!document.getElementById("vtx-gift-bar-drawer-styles")) {
      var ds = document.createElement("style");
      ds.id = "vtx-gift-bar-drawer-styles";
      ds.textContent =
        "#vtx-gift-bar-drawer{" +
          "position:relative;margin:10px 12px 16px;" +
          "border:1px solid #e5e7eb;border-radius:10px;" +
          "background:" + escapeHtml(cfg.bg_color) + ";" +
          "color:" + escapeHtml(cfg.text_color) + ";" +
          "padding:12px 14px;" +
          "font-family:'Inter',system-ui,sans-serif;font-size:12.5px;" +
        "}" +
        "#vtx-gift-bar-drawer.vtx-gb-achieved{" +
          "background:" + escapeHtml(cfg.achieved_bg_color) + "!important;" +
          "color:" + escapeHtml(cfg.achieved_text_color) + "!important;" +
        "}" +
        "#vtx-gift-bar-drawer .vtx-gb-text{margin:0 0 8px;font-weight:600;text-align:center;line-height:1.3}" +
        "#vtx-gift-bar-drawer .vtx-gb-track-wrap{position:relative;padding:7px 8px 22px}" +
        "#vtx-gift-bar-drawer .vtx-gb-track{position:relative;width:100%;height:5px;" +
          "background:" + escapeHtml(cfg.bar_bg_color) + ";border-radius:999px;overflow:visible}" +
        "#vtx-gift-bar-drawer .vtx-gb-fill{height:100%;" +
          "background:" + escapeHtml(cfg.bar_color) + ";border-radius:999px;transition:width .4s ease;width:0}" +
        "#vtx-gift-bar-drawer .vtx-gb-steps{position:absolute;top:7px;left:8px;right:8px;height:5px;pointer-events:none}" +
        "#vtx-gift-bar-drawer .vtx-gb-step{position:absolute;top:50%;transform:translate(-50%, -50%);display:flex;flex-direction:column;align-items:center;pointer-events:auto}" +
        "#vtx-gift-bar-drawer .vtx-gb-step-icon{width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:" + escapeHtml(cfg.bar_bg_color) + ";color:" + escapeHtml(cfg.text_color) + ";box-shadow:0 0 0 2px " + escapeHtml(cfg.bg_color) + ";transition:all .25s ease}" +
        "#vtx-gift-bar-drawer .vtx-gb-step-icon svg{width:55%;height:55%}" +
        "#vtx-gift-bar-drawer .vtx-gb-step.vtx-gb-step-active .vtx-gb-step-icon{background:" + escapeHtml(cfg.bar_color) + ";color:#fff}" +
        "#vtx-gift-bar-drawer .vtx-gb-step-label{position:absolute;top:calc(100% + 4px);left:50%;transform:translateX(-50%);white-space:nowrap;font-size:9.5px;font-weight:500;opacity:.85;line-height:1.1}";
      document.head.appendChild(ds);
    }

    var hasSteps = Array.isArray(cfg.steps) && cfg.steps.length > 0;
    var steps = hasSteps
      ? cfg.steps.slice().sort(function (a, b) { return Number(a.threshold) - Number(b.threshold); })
      : [];
    var maxThreshold = hasSteps
      ? Number(steps[steps.length - 1].threshold) || cfg.threshold
      : Number(cfg.threshold);

    function buildBar() {
      var bar = document.createElement("div");
      bar.id = "vtx-gift-bar-drawer";
      var stepsHtml = "";
      if (hasSteps && maxThreshold > 0) {
        stepsHtml = '<div class="vtx-gb-steps">';
        for (var i = 0; i < steps.length; i++) {
          var s = steps[i];
          var pct = Math.max(0, Math.min(100, (Number(s.threshold) / maxThreshold) * 100));
          stepsHtml +=
            '<div class="vtx-gb-step" data-threshold="' + Number(s.threshold) + '" style="left:' + pct.toFixed(2) + '%">' +
              '<div class="vtx-gb-step-icon">' + renderIcon(s.icon) + '</div>' +
              '<div class="vtx-gb-step-label">' + escapeHtml(s.label || "") + '</div>' +
            '</div>';
        }
        stepsHtml += '</div>';
      }
      bar.innerHTML =
        '<p class="vtx-gb-text"></p>' +
        '<div class="vtx-gb-track-wrap">' +
          '<div class="vtx-gb-track"><div class="vtx-gb-fill"></div></div>' +
          stepsHtml +
        '</div>';
      return bar;
    }

    // Reads the largest "R$ X,YY" looking number inside the drawer — on
    // VNDA cart drawers the subtotal is the highest visible price.
    function readDrawerTotal() {
      var max = 0;
      var nodes = drawerRoot.querySelectorAll("*");
      var seen = {};
      for (var i = 0; i < nodes.length; i++) {
        var t = nodes[i].textContent || "";
        if (t.length > 200) continue;
        var m = t.match(/R\$\s*([\d.]+,\d{2})/);
        if (!m) continue;
        var v = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
        if (!isFinite(v) || v <= 0) continue;
        if (seen[m[0]]) continue;
        seen[m[0]] = true;
        if (v > max) max = v;
      }
      return max;
    }

    function updateBar(bar, total) {
      var textEl = bar.querySelector(".vtx-gb-text");
      var fillEl = bar.querySelector(".vtx-gb-fill");
      if (!textEl || !fillEl) return;

      var pct = maxThreshold > 0 ? Math.min(100, (total / maxThreshold) * 100) : 0;
      fillEl.style.width = pct.toFixed(2) + "%";

      // Token replacement covers BOTH the legacy single-threshold names
      // ({remaining}, {gift}, {threshold}, {total}) and the multi-step names
      // ({gap}, {next_label}, {next_threshold}, {total}). Admins can mix any
      // of them in any message field — same convention as the sticky bar.
      var msg;
      if (total <= 0) {
        msg = cfg.message_empty || cfg.message_progress || "";
        bar.classList.remove("vtx-gb-achieved");
      } else if (hasSteps) {
        var next = null;
        for (var i = 0; i < steps.length; i++) {
          if (total < Number(steps[i].threshold)) { next = steps[i]; break; }
        }
        if (next) {
          msg = cfg.message_next_step || cfg.message_progress || "Faltam R$ {gap} para o proximo {next_label}!";
          bar.classList.remove("vtx-gb-achieved");
        } else {
          msg = cfg.message_all_achieved || cfg.message_achieved || "Parabéns!";
          bar.classList.add("vtx-gb-achieved");
        }
      } else if (total >= Number(cfg.threshold)) {
        msg = cfg.message_achieved || "";
        bar.classList.add("vtx-gb-achieved");
      } else {
        msg = cfg.message_progress || "Faltam {remaining} para ganhar {gift}!";
        bar.classList.remove("vtx-gb-achieved");
      }

      var nextStep = null;
      if (hasSteps) {
        for (var ns = 0; ns < steps.length; ns++) {
          if (total < Number(steps[ns].threshold)) { nextStep = steps[ns]; break; }
        }
      }
      var gap = nextStep ? Math.max(Number(nextStep.threshold) - total, 0) : Math.max(Number(cfg.threshold) - total, 0);
      var nextLabel = nextStep ? (nextStep.label || cfg.gift_name || "") : (cfg.gift_name || "");
      var nextThreshold = nextStep ? Number(nextStep.threshold) : Number(cfg.threshold);

      msg = (msg || "")
        .replace(/\{gap\}/g, formatBRL(gap))
        .replace(/\{remaining\}/g, formatBRL(gap))
        .replace(/\{next_label\}/g, nextLabel)
        .replace(/\{gift\}/g, nextLabel)
        .replace(/\{next_threshold\}/g, formatBRL(nextThreshold))
        .replace(/\{threshold\}/g, formatBRL(nextThreshold))
        .replace(/\{total\}/g, formatBRL(total));
      textEl.textContent = msg;

      // Activate steps
      var stepEls = bar.querySelectorAll(".vtx-gb-step");
      for (var k = 0; k < stepEls.length; k++) {
        var th = Number(stepEls[k].getAttribute("data-threshold"));
        if (total >= th) stepEls[k].classList.add("vtx-gb-step-active");
        else stepEls[k].classList.remove("vtx-gb-step-active");
      }
    }

    var injectInProgress = false;
    var lastTotal = -1;
    function maybeInject() {
      if (injectInProgress) return;
      injectInProgress = true;
      try {
        // No content yet (drawer closed or empty) — wait for next mutation
        if (!drawerRoot.children.length) {
          lastTotal = -1;
          return;
        }

        var total = readDrawerTotal();
        var existing = drawerRoot.querySelector("#vtx-gift-bar-drawer");
        if (existing) {
          // Skip the paint when nothing relevant changed — kills the flicker
          // while the drawer animation settles in.
          if (total === lastTotal) return;
          lastTotal = total;
          updateBar(existing, total);
          return;
        }

        var bar = buildBar();
        // Try to find a sensible content container (drawer body) inside,
        // else insert as the first element of the drawer root.
        var target =
          drawerRoot.querySelector("[class*='Body'], [class*='body'], [class*='content'], [class*='Content']") ||
          drawerRoot.firstElementChild ||
          drawerRoot;
        if (target.tagName) {
          // Prefer inserting at the very top of the inner panel.
          target.insertBefore(bar, target.firstChild);
        } else {
          drawerRoot.insertBefore(bar, drawerRoot.firstChild);
        }
        lastTotal = total;
        updateBar(bar, total);
      } finally {
        injectInProgress = false;
      }
    }

    // Initial check (drawer might already be open from SSR/hydration)
    maybeInject();

    if (window.MutationObserver) {
      var debounce = null;
      var obs = new MutationObserver(function (muts) {
        // Filter out mutations that originate INSIDE our own bar — the
        // updateBar() call mutates style/classList/textContent and we
        // don't want it to retrigger this observer in a tight loop.
        var hasExternal = false;
        for (var i = 0; i < muts.length; i++) {
          var t = muts[i].target;
          var fromSelf = false;
          while (t && t !== drawerRoot.parentNode) {
            if (t.id === "vtx-gift-bar-drawer") { fromSelf = true; break; }
            t = t.parentNode;
          }
          if (!fromSelf) { hasExternal = true; break; }
        }
        if (!hasExternal) return;

        clearTimeout(debounce);
        // 250ms is long enough for the drawer's open animation to finish
        // populating its body before we re-read the cart total.
        debounce = setTimeout(maybeInject, 250);
      });
      obs.observe(drawerRoot, { childList: true, subtree: true });
    }
  }

  function initGiftBar() {
    fetchJSON(API_BASE + "/api/gift-bar/public-config?key=" + API_KEY)
      .then(function (data) {
        if (!data.gift_bar) return;
        var cfg = data.gift_bar;
        var pageType = detectPageType();

        // Product Benefits block (independent of gift bar enabled flag)
        if (cfg.show_product_benefits && pageType === "product") {
          renderProductBenefits(cfg);
        }

        if (!cfg.enabled) return;

        // Bulking storefront has a side cart-drawer (#component-cart-drawer-root)
        // that mounts on top of any page when the user taps the cart icon —
        // most mobile users hit checkout through it instead of /carrinho.
        // Watch for it being populated and inject a copy of the gift bar
        // there so the benefits track shows up regardless of the URL.
        attachGiftBarToCartDrawer(cfg);

        // User requested to completely remove the gift bar from the PDP
        // (but keep it on cart/checkout). Force sticky mode for non-PDP
        // pages so the bar still renders even if pdp_inline was on.
        if (pageType === "product") return;
        var inlineMode = false;
        if (cfg.show_on_pages.indexOf("all") === -1 && cfg.show_on_pages.indexOf(pageType) === -1) return;

        var hasSteps = Array.isArray(cfg.steps) && cfg.steps.length > 0;
        var steps = hasSteps
          ? cfg.steps.slice().sort(function (a, b) { return Number(a.threshold) - Number(b.threshold); })
          : [];
        var maxThreshold = hasSteps
          ? Number(steps[steps.length - 1].threshold) || cfg.threshold
          : Number(cfg.threshold);

        // Inject styles (track + steps + modal)
        var css =
          "#vtx-gift-bar{" +
            (inlineMode
              ? "position:relative;margin:18px 0;border:1px solid #e5e7eb;border-radius:10px;"
              : "position:sticky;z-index:90;" + (cfg.position === "bottom" ? "bottom:0;" : "top:0;") + "box-shadow:0 1px 3px rgba(0,0,0,.1);"
            ) +
            "background:" + escapeHtml(cfg.bg_color) + ";" +
            "color:" + escapeHtml(cfg.text_color) + ";" +
            "padding:" + (inlineMode ? "15px 16px" : "9px 14px") + ";" +
            "font-family:'Inter',system-ui,sans-serif;" +
            "font-size:" + escapeHtml(cfg.font_size) + ";" +
          "}" +
          "#vtx-gift-bar.vtx-gb-achieved{" +
            "background:" + escapeHtml(cfg.achieved_bg_color) + "!important;" +
            "color:" + escapeHtml(cfg.achieved_text_color) + "!important;" +
          "}" +
          ".vtx-gb-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;gap:12px}" +
          ".vtx-gb-img{width:28px;height:28px;object-fit:contain;border-radius:4px}" +
          ".vtx-gb-content{flex:1;min-width:0}" +
          ".vtx-gb-text{margin:0;font-weight:600;text-align:center;font-size:12.5px;letter-spacing:.01em;line-height:1.3}" +
          ".vtx-gb-text .vtx-gb-cashback-inline{display:none;font-weight:500;opacity:.78;font-size:11px;margin-left:8px;padding-left:8px;border-left:1px solid currentColor}" +
          ".vtx-gb-text .vtx-gb-cashback-inline.vtx-gb-cashback-show{display:inline}" +
          ".vtx-gb-text .vtx-gb-cashback-inline strong{font-weight:700;opacity:1}" +
          // Track + fill (slimmer, modern)
          ".vtx-gb-track-wrap{position:relative;padding:7px 14px 22px}" +
          ".vtx-gb-track{position:relative;width:100%;height:5px;" +
            "background:" + escapeHtml(cfg.bar_bg_color) + ";" +
            "border-radius:999px;overflow:visible}" +
          ".vtx-gb-fill{height:100%;" +
            "background:" + escapeHtml(cfg.bar_color) + ";" +
            "border-radius:999px;transition:width .5s ease;width:0}" +
          // Multi-step (steps positioned by threshold % along the track)
          ".vtx-gb-steps{position:absolute;top:7px;left:14px;right:14px;height:5px;pointer-events:none}" +
          ".vtx-gb-step{position:absolute;top:50%;transform:translate(-50%, -50%);display:flex;flex-direction:column;align-items:center;pointer-events:auto}" +
          ".vtx-gb-step-icon{width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:" + escapeHtml(cfg.bar_bg_color) + ";color:" + escapeHtml(cfg.text_color) + ";box-shadow:0 0 0 2px " + escapeHtml(cfg.bg_color) + ";transition:all .25s ease}" +
          ".vtx-gb-step-icon svg{width:55%;height:55%}" +
          ".vtx-gb-step.vtx-gb-step-active .vtx-gb-step-icon{background:" + escapeHtml(cfg.bar_color) + ";color:#fff}" +
          ".vtx-gb-step-label{position:absolute;top:calc(100% + 4px);left:50%;transform:translateX(-50%);white-space:nowrap;font-size:10px;font-weight:500;letter-spacing:.01em;opacity:.8;line-height:1.1}" +
          ".vtx-gb-step-modal{cursor:pointer;border-bottom:1px dotted currentColor;padding-bottom:1px}" +
          "@media(max-width:768px){" +
            "#vtx-gift-bar{position:relative;padding:8px 10px;font-size:11px}" +
            ".vtx-gb-img{width:20px;height:20px}" +
            ".vtx-gb-text{font-size:11.5px}" +
            ".vtx-gb-track-wrap{padding:6px 10px 18px}" +
            ".vtx-gb-steps{top:6px;left:10px;right:10px}" +
            ".vtx-gb-step-icon{width:16px;height:16px}" +
            ".vtx-gb-step-label{font-size:9px}" +
          "}";

        var style = document.createElement("style");
        style.id = "vtx-gift-bar-styles";
        style.textContent = css;
        document.head.appendChild(style);

        // Build steps HTML — each step positioned absolutely by threshold ratio
        var stepsHtml = "";
        if (hasSteps && maxThreshold > 0) {
          stepsHtml = '<div class="vtx-gb-steps">';
          for (var i = 0; i < steps.length; i++) {
            var s = steps[i];
            var hasModal = s.modal_body && String(s.modal_body).trim().length > 0;
            var labelHtml = escapeHtml(s.label || "");
            if (hasModal) {
              labelHtml = '<span class="vtx-gb-step-modal" data-step-idx="' + i + '">' +
                escapeHtml(s.label || "") + '</span>';
            }
            var pct = Math.max(0, Math.min(100, (Number(s.threshold) / maxThreshold) * 100));
            stepsHtml +=
              '<div class="vtx-gb-step" data-threshold="' + Number(s.threshold) + '" style="left:' + pct.toFixed(2) + '%">' +
                '<div class="vtx-gb-step-icon">' + renderIcon(s.icon) + '</div>' +
                '<div class="vtx-gb-step-label">' + labelHtml + '</div>' +
              '</div>';
          }
          stepsHtml += '</div>';
        }

        // Create bar
        var bar = document.createElement("div");
        bar.id = "vtx-gift-bar";
        bar.innerHTML =
          '<div class="vtx-gb-inner">' +
            (!hasSteps && cfg.gift_image_url ?
              '<img class="vtx-gb-img" src="' + escapeHtml(cfg.gift_image_url) + '" alt="' + escapeHtml(cfg.gift_name) + '" onerror="this.style.display=\'none\'">' : "") +
            '<div class="vtx-gb-content">' +
              '<p class="vtx-gb-text"><span class="vtx-gb-text-main"></span><span class="vtx-gb-cashback-inline"></span></p>' +
              '<div class="vtx-gb-track-wrap">' +
                '<div class="vtx-gb-track"><div class="vtx-gb-fill"></div></div>' +
                stepsHtml +
              '</div>' +
            '</div>' +
          '</div>';

        // Insert in page
        var isMobile = window.innerWidth <= 768;
        if (inlineMode) {
          var pdpAnchor = null;
          var pdpInsertBefore = false;
          if (cfg.product_benefits_anchor) {
            pdpAnchor = document.querySelector(cfg.product_benefits_anchor);
          }
          if (!pdpAnchor && isKitProduct()) {
            var kitAnchor2 = findKitDropAnchor();
            if (kitAnchor2) {
              pdpAnchor = kitAnchor2;
              // Default insertion (anchor.nextSibling) is what we want.
            }
          }
          if (!pdpAnchor) {
            var pdpFallbacks = [
              ".product-buy",
              ".product-form",
              "[data-product-buy]",
              "form[data-product-form]",
              ".product__buy",
              ".product-info",
              ".product__details",
              ".product-purchase",
              ".add-to-cart",
              ".add-to-cart-button",
              ".actions-wrapper"
            ];
            for (var pa = 0; pa < pdpFallbacks.length; pa++) {
              pdpAnchor = document.querySelector(pdpFallbacks[pa]);
              if (pdpAnchor) break;
            }
          }
          if (!pdpAnchor) {
            console.warn("[GiftBar] inline-PDP: no anchor found — set product_benefits_anchor in admin");
            return;
          }
          if (pdpInsertBefore) {
            pdpAnchor.parentNode.insertBefore(bar, pdpAnchor);
          } else {
            pdpAnchor.parentNode.insertBefore(bar, pdpAnchor.nextSibling);
          }
        } else if (cfg.position === "bottom") {
          document.body.appendChild(bar);
        } else if (isMobile) {
          var header = document.querySelector("header, .header, nav.main-nav, .top-bar, #header");
          if (header) {
            header.parentNode.insertBefore(bar, header.nextSibling);
          } else {
            document.body.insertBefore(bar, document.body.firstChild);
          }
        } else {
          document.body.insertBefore(bar, document.body.firstChild);
        }

        // Wire up modal triggers
        if (hasSteps) {
          var triggers = bar.querySelectorAll(".vtx-gb-step-modal");
          for (var t = 0; t < triggers.length; t++) {
            (function (trigger) {
              trigger.addEventListener("click", function (e) {
                e.preventDefault();
                var idx = Number(trigger.getAttribute("data-step-idx"));
                var step = steps[idx];
                if (!step) return;
                openGiftBarModal(step.modal_title || step.label || "", step.modal_body || "");
              });
            })(triggers[t]);
          }
        }

        var giftAchieved = false;
        var stepFiredFlags = {};

        function updateBar(cartTotal) {
          var textEl = bar.querySelector(".vtx-gb-text-main") || bar.querySelector(".vtx-gb-text");
          var fillEl = bar.querySelector(".vtx-gb-fill");
          var cashbackEl = bar.querySelector(".vtx-gb-cashback-inline");
          if (!textEl || !fillEl) return;

          // Inline cashback: "+ R$ X,XX cashback (10%)"
          var cashbackPct = Number(cfg.cashback_percent) || 0;
          if (cashbackEl) {
            if (cashbackPct > 0 && cartTotal > 0) {
              var cashbackValue = (cartTotal * cashbackPct) / 100;
              cashbackEl.innerHTML =
                '+ <strong>' + formatBRL(cashbackValue) +
                '</strong> cashback (' + cashbackPct + '%)';
              cashbackEl.classList.add("vtx-gb-cashback-show");
            } else {
              cashbackEl.classList.remove("vtx-gb-cashback-show");
            }
          }

          if (hasSteps) {
            var pct = Math.min((cartTotal / maxThreshold) * 100, 100);
            fillEl.style.width = pct + "%";

            var nextStep = null;
            for (var i = 0; i < steps.length; i++) {
              if (cartTotal < Number(steps[i].threshold)) {
                nextStep = steps[i];
                break;
              }
            }

            // Update step active states
            var stepEls = bar.querySelectorAll(".vtx-gb-step");
            for (var k = 0; k < stepEls.length; k++) {
              var thr = Number(stepEls[k].getAttribute("data-threshold"));
              if (cartTotal >= thr) {
                stepEls[k].classList.add("vtx-gb-step-active");
                if (!stepFiredFlags[thr] && window.dataLayer) {
                  stepFiredFlags[thr] = true;
                  window.dataLayer.push({
                    event: "vtx_gift_bar_step_reached",
                    step_label: steps[k].label,
                    step_threshold: thr,
                    cart_total: cartTotal
                  });
                }
              } else {
                stepEls[k].classList.remove("vtx-gb-step-active");
              }
            }

            var message;
            if (cartTotal <= 0) {
              message = (cfg.message_empty || "")
                .replace(/\{threshold\}/g, formatBRL(steps[0] ? Number(steps[0].threshold) : maxThreshold))
                .replace(/\{gift\}/g, steps[0] ? steps[0].label : (cfg.gift_name || ""));
              bar.classList.remove("vtx-gb-achieved");
            } else if (!nextStep) {
              message = cfg.message_all_achieved || "Voce desbloqueou todos os mimos!";
              bar.classList.add("vtx-gb-achieved");
            } else {
              var gap = Math.max(Number(nextStep.threshold) - cartTotal, 0);
              message = (cfg.message_next_step || "Faltam R$ {gap} para o proximo {next_label}!")
                .replace(/\{gap\}/g, formatBRL(gap))
                .replace(/\{next_label\}/g, nextStep.label || "")
                .replace(/\{next_threshold\}/g, formatBRL(Number(nextStep.threshold)))
                .replace(/\{total\}/g, formatBRL(cartTotal));
              bar.classList.remove("vtx-gb-achieved");
            }
            textEl.textContent = message;
          } else {
            // Legacy single-threshold path
            var pctL = Math.min((cartTotal / cfg.threshold) * 100, 100);
            var remaining = Math.max(cfg.threshold - cartTotal, 0);

            var msg;
            if (cartTotal <= 0) {
              msg = cfg.message_empty;
              bar.classList.remove("vtx-gb-achieved");
            } else if (cartTotal >= cfg.threshold) {
              msg = cfg.message_achieved;
              bar.classList.add("vtx-gb-achieved");
            } else {
              msg = cfg.message_progress;
              bar.classList.remove("vtx-gb-achieved");
            }
            msg = msg
              .replace(/\{remaining\}/g, formatBRL(remaining))
              .replace(/\{threshold\}/g, formatBRL(cfg.threshold))
              .replace(/\{gift\}/g, cfg.gift_name)
              .replace(/\{total\}/g, formatBRL(cartTotal));

            textEl.textContent = msg;
            fillEl.style.width = pctL + "%";

            if (cartTotal >= cfg.threshold && !giftAchieved) {
              giftAchieved = true;
              if (window.dataLayer) {
                window.dataLayer.push({
                  event: "vtx_gift_bar_achieved",
                  gift_name: cfg.gift_name,
                  cart_total: cartTotal,
                  threshold: cfg.threshold
                });
              }
            }
          }
        }

        getCartTotal(function (total) {
          updateBar(total);
          if (total === 0) setTimeout(function () { getCartTotal(updateBar); }, 2000);
        });
        setupCartListeners(updateBar);

        console.log("[GiftBar] Initialized, position:", cfg.position, "steps:", hasSteps ? steps.length : "(legacy)");
      })
      .catch(function (err) {
        console.warn("[GiftBar] Init error:", err);
      });
  }

  // =====================================================================
  // PROMO TAGS MODULE - Injects promotional badges into product cards
  // =====================================================================

  function injectPromoTagStyles() {
    if (document.getElementById("vtx-promo-tag-styles")) return;

    var css =
      // Badge on listing/category cards (absolute over image)
      ".vtx-promo-tag {" +
        "position: absolute; z-index: 10; pointer-events: none;" +
        "font-family: inherit;" +
        "font-weight: 700; text-transform: uppercase;" +
        "line-height: 1.2; white-space: nowrap;" +
        "box-sizing: border-box;" +
      "}" +
      ".vtx-promo-tag--top-left { top: 8px; left: 8px; }" +
      ".vtx-promo-tag--top-right { top: 8px; right: 8px; }" +
      ".vtx-promo-tag--bottom-left { bottom: 8px; left: 8px; }" +
      ".vtx-promo-tag--bottom-right { bottom: 8px; right: 8px; }" +
      // Badge on product detail page (inline block, not absolute)
      ".vtx-promo-tag--pdp {" +
        "position: static; display: inline-block; pointer-events: none;" +
        "font-family: inherit;" +
        "font-weight: 700; text-transform: uppercase;" +
        "line-height: 1.2; white-space: nowrap;" +
        "box-sizing: border-box;" +
        "margin: 8px 0;" +
      "}" +
      // Wrapper that holds cashback + viewers side-by-side below the price
      ".vtx-promo-tag-row {" +
        "display: flex; flex-wrap: wrap; gap: 8px;" +
        "align-items: center;" +
        "width: 100%; flex-basis: 100%;" +
        "margin: 12px 0; clear: both;" +
      "}" +
      ".vtx-promo-tag-row > .vtx-promo-tag:not(.vtx-promo-tag--coupon) {" +
        "height: 32px !important; min-height: 32px !important;" +
        "display: inline-flex !important; align-items: center !important; justify-content: center !important;" +
        "padding-top: 0 !important; padding-bottom: 0 !important;" +
        "line-height: 1 !important; box-sizing: border-box !important;" +
      "}" +
      ".vtx-promo-tag--has-modal {" +
        "pointer-events: auto; cursor: pointer; text-transform: none;" +
      "}" +
      ".vtx-promo-tag--shipping-24h {" +
        "position: relative !important; overflow: hidden; isolation: isolate;" +
      "}" +
      ".vtx-promo-tag--shipping-24h::after {" +
        "content: ''; position: absolute; top: -60%; bottom: -60%; left: -45%;" +
        "width: 34%; transform: skewX(-22deg);" +
        "background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.52), rgba(255,255,255,0));" +
        "animation: vtx-shipping-shine 2.8s ease-in-out infinite; pointer-events: none;" +
      "}" +
      "@keyframes vtx-shipping-shine {" +
        "0% { left: -45%; opacity: 0; }" +
        "12% { opacity: .85; }" +
        "52% { left: 120%; opacity: .85; }" +
        "70%, 100% { left: 120%; opacity: 0; }" +
      "}" +
      ".vtx-promo-tag--has-modal:focus-visible {" +
        "outline: 2px solid currentColor; outline-offset: 2px;" +
      "}" +
      ".vtx-promo-tag-modal {" +
        "position: fixed; inset: 0; z-index: 2147483000;" +
        "display: none; align-items: center; justify-content: center;" +
        "padding: 20px; box-sizing: border-box;" +
        "font-family: inherit;" +
      "}" +
      ".vtx-promo-tag-modal.is-open { display: flex; }" +
      ".vtx-promo-tag-modal__backdrop {" +
        "position: absolute; inset: 0; background: rgba(0,0,0,.48);" +
      "}" +
      ".vtx-promo-tag-modal__dialog {" +
        "position: relative; width: min(420px, 100%);" +
        "background: #fff; color: #111; border-radius: 12px;" +
        "box-shadow: 0 18px 60px rgba(0,0,0,.24);" +
        "padding: 22px 22px 20px; box-sizing: border-box;" +
      "}" +
      ".vtx-promo-tag-modal__close {" +
        "position: absolute; top: 10px; right: 10px;" +
        "width: 32px; height: 32px; border: 0; border-radius: 999px;" +
        "background: #f3f4f6; color: #111; cursor: pointer;" +
        "font-size: 22px; line-height: 1; display: flex;" +
        "align-items: center; justify-content: center;" +
      "}" +
      ".vtx-promo-tag-modal__title {" +
        "font-size: 17px; font-weight: 800; line-height: 1.25;" +
        "margin: 0 36px 10px 0; color: inherit;" +
      "}" +
      ".vtx-promo-tag-modal__body {" +
        "font-size: 14px; line-height: 1.55; color: #3f3f46;" +
      "}" +
      ".vtx-promo-tag-modal__body strong { font-weight: 800; color: #111827; }" +
      ".vtx-promo-tag-modal__body em { font-style: italic; }" +
      ".vtx-promo-tag-modal__body p { margin: 0 0 10px; }" +
      ".vtx-promo-tag-modal__body p:last-child { margin-bottom: 0; }" +
      "@media (max-width: 640px) {" +
        ".vtx-promo-tag-modal { align-items: flex-end; padding: 12px; }" +
        ".vtx-promo-tag-modal__dialog { border-radius: 12px; padding: 20px 18px 18px; }" +
      "}" +
      // Cashback pill — colors come from rule.badge_bg_color/text_color via inline style
      ".vtx-promo-tag--cashback {" +
        "position: relative; display: inline-flex; align-items: center; gap: 6px;" +
        "padding: 5px 12px;" +
        "font-weight: 600; text-transform: none; font-size: 12px;" +
        "border-radius: 6px;" +
        "font-family: inherit; line-height: 1.3;" +
      "}" +
      ".vtx-promo-tag--cashback strong { font-weight: 700 }" +
      // Live viewers pill — pulsing dot inherits color from text
      ".vtx-promo-tag--viewers {" +
        "position: relative; display: inline-flex; align-items: center; gap: 6px;" +
        "padding: 5px 12px;" +
        "font-weight: 500; text-transform: none; font-size: 11.5px;" +
        "border-radius: 6px;" +
        "font-family: inherit; line-height: 1.3;" +
      "}" +
      ".vtx-promo-tag--viewers strong { font-weight: 700 }" +
      ".vtx-promo-tag--viewers .vtx-pulse-dot {" +
        "width: 7px; height: 7px; border-radius: 50%;" +
        "background: currentColor; opacity: .85;" +
        "animation: vtx-pulse 1.6s infinite;" +
      "}" +
      // Pulse uses currentColor so the ring matches the badge text color
      "@keyframes vtx-pulse {" +
        "0% { box-shadow: 0 0 0 0 currentColor; opacity: .85 }" +
        "70% { box-shadow: 0 0 0 6px transparent; opacity: .85 }" +
        "100% { box-shadow: 0 0 0 0 transparent; opacity: .85 }" +
      "}" +
      // Coupon countdown banner — monochrome, standalone block above the buy button
      // pointer-events:auto overrides the .vtx-promo-tag base which had it none
      ".vtx-promo-tag--coupon {" +
        "display: block; position: relative; z-index: 2;" +
        "pointer-events: auto;" +
        "width: 100%; box-sizing: border-box;" +
        "padding: 14px 16px; margin: 14px 0;" +
        "border: 1px solid #e5e7eb; border-radius: 12px;" +
        "background: #ffffff; color: #0f172a;" +
        "font-family: inherit; line-height: 1.3; clear: both;" +
        "text-transform: none; font-weight: 400;" +
      "}" +
      "@media (prefers-color-scheme: dark) {" +
        ".vtx-promo-tag--coupon { background: #0a0a0a; color: #fafafa; border-color: #262626 }" +
      "}" +
      // Header
      ".vtx-promo-tag--coupon .vtx-coupon-header {" +
        "display: flex; align-items: center; gap: 10px; margin-bottom: 14px;" +
      "}" +
      ".vtx-promo-tag--coupon .vtx-coupon-icon { width: 22px; height: 22px; flex-shrink: 0; color: #525252 }" +
      "@media (prefers-color-scheme: dark) {" +
        ".vtx-promo-tag--coupon .vtx-coupon-icon { color: #a3a3a3 }" +
      "}" +
      ".vtx-promo-tag--coupon .vtx-coupon-headline { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 }" +
      ".vtx-promo-tag--coupon .vtx-coupon-title { font-size: 14px; font-weight: 700; line-height: 1.2 }" +
      ".vtx-promo-tag--coupon .vtx-coupon-sub { font-size: 11.5px; color: #737373; line-height: 1.2 }" +
      "@media (prefers-color-scheme: dark) {" +
        ".vtx-promo-tag--coupon .vtx-coupon-sub { color: #a3a3a3 }" +
      "}" +
      // Timer
      ".vtx-promo-tag--coupon .vtx-coupon-bottom {" +
        "display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;" +
      "}" +
      ".vtx-promo-tag--coupon .vtx-coupon-timer {" +
        "display: flex; gap: 6px; font-variant-numeric: tabular-nums; flex-shrink: 0;" +
      "}" +
      ".vtx-promo-tag--coupon .vtx-coupon-time {" +
        "display: flex; flex-direction: column; align-items: center; justify-content: center;" +
        "min-width: 42px; padding: 8px 10px;" +
        "background: #f5f5f5; border-radius: 8px;" +
      "}" +
      "@media (prefers-color-scheme: dark) {" +
        ".vtx-promo-tag--coupon .vtx-coupon-time { background: #171717 }" +
      "}" +
      ".vtx-promo-tag--coupon .vtx-coupon-time .num {" +
        "font-size: 18px; font-weight: 800; line-height: 1; letter-spacing: -.01em; color: #0f172a;" +
      "}" +
      "@media (prefers-color-scheme: dark) {" +
        ".vtx-promo-tag--coupon .vtx-coupon-time .num { color: #fafafa }" +
      "}" +
      ".vtx-promo-tag--coupon .vtx-coupon-time .lbl {" +
        "font-size: 9px; color: #737373; text-transform: uppercase; letter-spacing: .06em;" +
        "margin-top: 4px; line-height: 1; font-weight: 500;" +
      "}" +
      "@media (prefers-color-scheme: dark) {" +
        ".vtx-promo-tag--coupon .vtx-coupon-time .lbl { color: #a3a3a3 }" +
      "}" +
      // Code + copy — joined pill (monochrome)
      ".vtx-promo-tag--coupon .vtx-coupon-action {" +
        "display: inline-flex; align-items: stretch; border-radius: 8px; overflow: hidden;" +
        "border: 1px solid #e5e7eb; flex-shrink: 0; pointer-events: auto;" +
      "}" +
      "@media (prefers-color-scheme: dark) {" +
        ".vtx-promo-tag--coupon .vtx-coupon-action { border-color: #262626 }" +
      "}" +
      ".vtx-promo-tag--coupon .vtx-coupon-code {" +
        "display: inline-flex; align-items: center; padding: 8px 14px;" +
        "font-size: 13px; font-weight: 700; letter-spacing: .06em;" +
        "background: #ffffff; color: #0f172a; user-select: all; cursor: text;" +
        "font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;" +
        "pointer-events: auto;" +
      "}" +
      "@media (prefers-color-scheme: dark) {" +
        ".vtx-promo-tag--coupon .vtx-coupon-code { background: #0a0a0a; color: #fafafa }" +
      "}" +
      ".vtx-promo-tag--coupon .vtx-coupon-copy {" +
        "display: inline-flex; align-items: center; gap: 6px;" +
        "padding: 8px 14px; cursor: pointer; border: 0; outline: none;" +
        "font-size: 12px; font-weight: 700; letter-spacing: .04em;" +
        "font-family: inherit; white-space: nowrap;" +
        "background: #0f172a; color: #ffffff;" +
        "transition: background .15s ease;" +
        "pointer-events: auto;" +
      "}" +
      "@media (prefers-color-scheme: dark) {" +
        ".vtx-promo-tag--coupon .vtx-coupon-copy { background: #fafafa; color: #0a0a0a }" +
      "}" +
      ".vtx-promo-tag--coupon .vtx-coupon-copy:hover { background: #404040 }" +
      "@media (prefers-color-scheme: dark) {" +
        ".vtx-promo-tag--coupon .vtx-coupon-copy:hover { background: #d4d4d4 }" +
      "}" +
      ".vtx-promo-tag--coupon .vtx-coupon-copy svg { width: 14px; height: 14px }" +
      ".vtx-promo-tag--coupon.vtx-coupon-copied .vtx-coupon-copy { background: #16a34a; color: #ffffff }" +
      // Mobile — tighter so it never crowds the buy button
      "@media (max-width: 640px) {" +
        ".vtx-promo-tag--coupon { padding: 10px 12px; margin: 10px 0 12px; border-radius: 10px }" +
        ".vtx-promo-tag--coupon .vtx-coupon-header { margin-bottom: 10px; gap: 8px }" +
        ".vtx-promo-tag--coupon .vtx-coupon-icon { width: 18px; height: 18px }" +
        ".vtx-promo-tag--coupon .vtx-coupon-title { font-size: 12.5px }" +
        ".vtx-promo-tag--coupon .vtx-coupon-sub { font-size: 10.5px }" +
        ".vtx-promo-tag--coupon .vtx-coupon-bottom { flex-direction: column; align-items: stretch; gap: 8px }" +
        ".vtx-promo-tag--coupon .vtx-coupon-timer { justify-content: space-between; gap: 4px }" +
        ".vtx-promo-tag--coupon .vtx-coupon-time { flex: 1; min-width: 0; padding: 6px 2px }" +
        ".vtx-promo-tag--coupon .vtx-coupon-time .num { font-size: 15px }" +
        ".vtx-promo-tag--coupon .vtx-coupon-time .lbl { font-size: 8.5px; margin-top: 2px }" +
        ".vtx-promo-tag--coupon .vtx-coupon-action { display: flex }" +
        ".vtx-promo-tag--coupon .vtx-coupon-code { flex: 1; justify-content: center; padding: 7px 8px; font-size: 12px; letter-spacing: .04em }" +
        ".vtx-promo-tag--coupon .vtx-coupon-copy { padding: 7px 12px; font-size: 11.5px }" +
      "}";

    var style = document.createElement("style");
    style.id = "vtx-promo-tag-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function formatBRLShort(v) {
    return "R$ " + v.toFixed(2).replace(".", ",");
  }

  // Try to read product price from the PDP DOM (multiple themes)
  function readPDPPrice() {
    var selectors = [
      ".product-price .price-sale",
      ".product__price-sale",
      ".price-sale",
      ".sale-price",
      ".product-price strong",
      ".product__price",
      ".product-price",
      "[data-product-price]",
      ".price",
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (!el) continue;
      var raw = (el.textContent || "").replace(/[^\d,\.]/g, "");
      // BR format: "1.234,56" → 1234.56
      raw = raw.replace(/\./g, "").replace(",", ".");
      var n = parseFloat(raw);
      if (!isNaN(n) && n > 0) return n;
    }
    return 0;
  }

  function findPriceAnchor() {
    var selectors = [
      ".product-price",
      ".product__price",
      ".prices",
      "[data-product-price]",
      ".price",
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  function hasPromoTagModal(rule) {
    return !!getPromoTagModalBody(rule);
  }

  function normalizePromoTagText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function isShipping24hPromoTag(rule) {
    var text = normalizePromoTagText((rule && rule.badge_text) || "");
    return /(envio|entrega)/.test(text) && /24\s*h(?:oras)?/.test(text);
  }

  function getPromoTagModalTitle(rule) {
    if (rule && String(rule.modal_title || "").trim()) {
      return String(rule.modal_title).trim();
    }
    if (isShipping24hPromoTag(rule)) return "Entrega em 24h úteis";
    return (rule && rule.badge_text) || "Informação";
  }

  function getPromoTagModalBody(rule) {
    if (rule && String(rule.modal_body || "").trim()) {
      return String(rule.modal_body).trim();
    }
    if (isShipping24hPromoTag(rule)) {
      return "Este produto tem entrega em 24h úteis. O prazo começa a contar após a aprovação do pagamento.";
    }
    return "";
  }

  function renderPromoTagModalBody(body) {
    var text = String(body || "").replace(/\r\n/g, "\n").trim();
    if (!text) return "";
    return text
      .split(/\n{2,}/)
      .map(function (paragraph) {
        var html = escapeHtml(paragraph)
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
          .replace(/\*([^*]+)\*/g, "<em>$1</em>");
        return "<p>" + html.replace(/\n/g, "<br>") + "</p>";
      })
      .join("");
  }

  function closePromoTagModal() {
    var modal = document.getElementById("vtx-promo-tag-modal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  function ensurePromoTagModal() {
    var existing = document.getElementById("vtx-promo-tag-modal");
    if (existing) return existing;

    var modal = document.createElement("div");
    modal.id = "vtx-promo-tag-modal";
    modal.className = "vtx-promo-tag-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<div class="vtx-promo-tag-modal__backdrop" data-vtx-promo-modal-close></div>' +
      '<div class="vtx-promo-tag-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="vtx-promo-tag-modal-title">' +
        '<button type="button" class="vtx-promo-tag-modal__close" aria-label="Fechar" data-vtx-promo-modal-close>&times;</button>' +
        '<h2 class="vtx-promo-tag-modal__title" id="vtx-promo-tag-modal-title"></h2>' +
        '<div class="vtx-promo-tag-modal__body"></div>' +
      '</div>';

    modal.addEventListener("click", function (e) {
      var target = e.target;
      if (target && target.getAttribute && target.getAttribute("data-vtx-promo-modal-close") !== null) {
        e.preventDefault();
        closePromoTagModal();
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closePromoTagModal();
    });

    document.body.appendChild(modal);
    return modal;
  }

  function openPromoTagModal(rule) {
    if (!hasPromoTagModal(rule)) return;
    var modal = ensurePromoTagModal();
    var titleEl = modal.querySelector(".vtx-promo-tag-modal__title");
    var bodyEl = modal.querySelector(".vtx-promo-tag-modal__body");
    if (titleEl) titleEl.textContent = getPromoTagModalTitle(rule);
    if (bodyEl) bodyEl.innerHTML = renderPromoTagModalBody(getPromoTagModalBody(rule));
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    var closeBtn = modal.querySelector(".vtx-promo-tag-modal__close");
    if (closeBtn && closeBtn.focus) closeBtn.focus();
  }

  function bindPromoTagModal(badge, rule) {
    if (!badge || !hasPromoTagModal(rule)) return;
    badge.classList.add("vtx-promo-tag--has-modal");
    if (isShipping24hPromoTag(rule)) {
      badge.classList.add("vtx-promo-tag--shipping-24h");
    }
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "0");
    badge.setAttribute(
      "aria-label",
      "Abrir detalhes: " + (rule.modal_title || rule.badge_text || "etiqueta")
    );
    badge.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openPromoTagModal(rule);
    });
    badge.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      openPromoTagModal(rule);
    });
  }

  function promoTagShowsOnPage(rule, pageType) {
    var pages = rule && Array.isArray(rule.show_on_pages) ? rule.show_on_pages : ["all"];
    if (pages.indexOf("all") !== -1) return true;
    if (pageType === "product") return pages.indexOf("product") !== -1;
    if (pageType === "home") return pages.indexOf("home") !== -1;
    if (pageType === "cart") return pages.indexOf("cart") !== -1;
    return pages.indexOf("category") !== -1;
  }

  function createBadgeElement(rule, isPdp) {
    var badge = document.createElement("div");
    badge.className = isPdp
      ? "vtx-promo-tag vtx-promo-tag--pdp"
      : "vtx-promo-tag vtx-promo-tag--" + (rule.badge_position || "top-left");
    badge.textContent = rule.badge_text;
    badge.style.backgroundColor = rule.badge_bg_color || "#ff0000";
    badge.style.color = rule.badge_text_color || "#ffffff";
    badge.style.fontSize = rule.badge_font_size || "11px";
    badge.style.borderRadius = rule.badge_border_radius || "4px";
    badge.style.padding = rule.badge_padding || "4px 8px";
    bindPromoTagModal(badge, rule);
    return badge;
  }

  function applyRuleColors(badge, rule, defaultBg, defaultText) {
    badge.style.backgroundColor = rule.badge_bg_color || defaultBg;
    badge.style.color = rule.badge_text_color || defaultText;
    if (rule.badge_font_size) badge.style.fontSize = rule.badge_font_size;
    if (rule.badge_border_radius) badge.style.borderRadius = rule.badge_border_radius;
    if (rule.badge_padding) badge.style.padding = rule.badge_padding;
  }

  function createCashbackBadge(rule, fallbackPercent) {
    var badge = document.createElement("div");
    badge.className = "vtx-promo-tag vtx-promo-tag--cashback";
    var pct = Number(rule.cashback_percent || fallbackPercent || 0);
    var amount = Number(rule.cashback_value || 0);
    if (!amount) {
      var price = readPDPPrice();
      if (price > 0 && pct > 0) amount = (price * pct) / 100;
    }
    if (!amount) return null;
    var template = rule.badge_text || "Ganhe {cashback} em cashback ({percent}%)";
    badge.innerHTML = template
      .replace(/\{cashback\}/g, "<strong>" + formatBRLShort(amount) + "</strong>")
      .replace(/\{percent\}/g, String(pct));
    applyRuleColors(badge, rule, "rgba(34,197,94,.12)", "#15803d");
    bindPromoTagModal(badge, rule);
    return badge;
  }

  function vtxHashString(input) {
    var h = 2166136261;
    var s = String(input || "");
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return h >>> 0;
  }

  function createSeededRandom(seed) {
    var state = vtxHashString(seed) || 1;
    return function () {
      state += 0x6D2B79F5;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function brtDayKey() {
    return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  }

  function createViewersBadge(rule, productId) {
    var badge = document.createElement("div");
    badge.className = "vtx-promo-tag vtx-promo-tag--viewers";
    var min = Number(rule.viewers_min) || 6;
    var max = Number(rule.viewers_max) || 42;
    if (max <= min) max = min + 1;
    var baseline = Number(rule.viewers_baseline) || Math.round((min + max) / 2);
    baseline = Math.max(min, Math.min(max, baseline));

    var sessionKey = "vtx-viewers-session";
    var sessionSeed = "";
    try {
      sessionSeed = sessionStorage.getItem(sessionKey);
      if (!sessionSeed) {
        sessionSeed = String(Date.now()) + "-" + String(Math.random()).slice(2);
        sessionStorage.setItem(sessionKey, sessionSeed);
      }
    } catch (err) {
      sessionSeed = String(Math.random()).slice(2);
    }

    var random = createSeededRandom([
      "viewers",
      productId || rule.product_id || "",
      brtDayKey(),
      sessionSeed,
      baseline,
    ].join("|"));

    var range = Math.max(1, max - min);
    var volatility = 0.10 + random() * 0.18; // product/session-specific 10-28%
    var startOffset = Math.round((random() - 0.5) * Math.max(3, range * volatility));
    var current = Math.max(min, Math.min(max, baseline + startOffset));
    var trend = random() < 0.5 ? -1 : 1;
    var calmTicks = 0;
    var tickCount = 0;
    var driftBasis = Math.max(2, baseline - min + 2);
    var maxDrift = Math.max(
      2,
      Math.min(
        Math.round(range * (0.18 + volatility)),
        Math.round(driftBasis * (1.6 + volatility * 2))
      )
    );
    var target = baseline + Math.round((random() - 0.5) * maxDrift);
    target = Math.max(min, Math.min(max, target));

    function pickValue() {
      tickCount++;
      if (tickCount % (7 + Math.floor(random() * 5)) === 0) {
        target = baseline + Math.round((random() - 0.5) * 2 * maxDrift);
        target = Math.max(min, Math.min(max, target));
        trend = target >= current ? 1 : -1;
      }

      var spread = Math.max(
        1,
        Math.min(
          Math.max(3, Math.round(range * 0.24)),
          Math.round(Math.max(3, baseline) * (0.16 + volatility))
        )
      );
      var delta;
      var roll = random();
      if (roll < 0.46) {
        // Free random walk, with a weak pull toward the current target so long
        // sessions visibly move instead of hovering around the initial baseline.
        var targetPull = Math.sign(target - current) * Math.min(spread, Math.ceil(Math.abs(target - current) / 3));
        delta = Math.round((random() - 0.5) * 2 * spread + targetPull + trend * random() * 1.6);
      } else if (roll < 0.74) {
        delta = (random() < 0.5 ? -1 : 1) * (random() < 0.70 ? 1 : 2);
      } else if (roll < 0.94) {
        // Occasional spike/drop feels more like live traffic, but remains bounded.
        delta = (random() < 0.58 ? trend : -trend) * Math.max(2, Math.round(spread * (0.8 + random())));
      } else {
        trend = trend * -1;
        var pull = Math.sign(target - current) * Math.min(3, Math.abs(target - current));
        delta = pull || (random() < 0.5 ? -1 : 1);
      }
      if (delta === 0 && max > min) delta = current <= min ? 1 : current >= max ? -1 : (random() < 0.5 ? -1 : 1);
      current = current + delta;
      if (current > baseline + maxDrift) current = baseline + maxDrift;
      if (current < baseline - maxDrift) current = baseline - maxDrift;
      if (current < min) current = min;
      if (current > max) current = max;
      return current;
    }

    function render(value) {
      var template = rule.badge_text || "{viewers} pessoas vendo este produto";
      var html = '<span class="vtx-pulse-dot"></span>' +
        template.replace(/\{viewers\}/g, "<strong>" + value + "</strong>");
      badge.innerHTML = html;
    }

    render(pickValue());

    function scheduleNextTick() {
      var delay = 4000 + Math.floor(random() * 11000);
      if (calmTicks > 0) {
        delay += 3500 + Math.floor(random() * 7000);
        calmTicks--;
      } else if (random() < 0.16) {
        calmTicks = 1 + Math.floor(random() * 2);
      }
      setTimeout(function () {
        render(pickValue());
        scheduleNextTick();
      }, delay);
    }
    scheduleNextTick();

    applyRuleColors(badge, rule, "rgba(244,63,94,.08)", "#be123c");
    bindPromoTagModal(badge, rule);
    return badge;
  }

  function createCouponCountdownBadge(rule) {
    var badge = document.createElement("div");
    badge.className = "vtx-promo-tag vtx-promo-tag--coupon";
    var code = String(rule.coupon_code || "").toUpperCase();
    var pct = Number(rule.coupon_discount_pct || 0);
    var expiresAt = new Date(rule.coupon_expires_at).getTime();
    if (!code || !pct || !expiresAt) return null;

    // CTA chip uses the plan colors; the card itself stays neutral so it
    // adapts to the store theme via prefers-color-scheme.
    badge.style.setProperty("--vtx-coupon-cta-bg", rule.badge_bg_color || "#000");
    badge.style.setProperty("--vtx-coupon-cta-fg", rule.badge_text_color || "#fff");

    // Build title from badge_template (substitutes {discount}; ignores {coupon}/{countdown})
    function buildTitle(tpl, p) {
      if (!tpl) return "🔥 " + p + "% OFF Flash";
      var parts = String(tpl).split("|").map(function (s) { return s.trim(); }).filter(Boolean);
      var pick = parts.find(function (s) { return s.indexOf("{discount}") !== -1; }) || parts[0] || "";
      var t = pick
        .replace(/\{discount\}/g, p)
        .replace(/\{coupon\}/g, "")
        .replace(/\{countdown\}/g, "")
        .trim();
      return t || ("🔥 " + p + "% OFF Flash");
    }

    var title = buildTitle(rule.badge_text, pct);
    var sub = "Use o cupom ao finalizar a compra";

    // Lucide TicketPercent inline SVG
    var iconSvg =
      '<svg class="vtx-coupon-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>' +
      '<path d="m9 15 6-6"/>' +
      '<circle cx="9.5" cy="9.5" r=".5" fill="currentColor"/>' +
      '<circle cx="14.5" cy="14.5" r=".5" fill="currentColor"/>' +
      '</svg>';

    function pad(n) { return n < 10 ? "0" + n : String(n); }

    var timer = null;

    // Build the static skeleton once — only the timer numbers update each tick
    function buildSkeleton(initialMs) {
      var totalSec = Math.floor(initialMs / 1000);
      var d = Math.floor(totalSec / 86400);
      var h = Math.floor((totalSec % 86400) / 3600);
      var m = Math.floor((totalSec % 3600) / 60);
      var s = totalSec % 60;

      var blocks = "";
      var showDays = d > 0;
      if (showDays) {
        blocks += '<div class="vtx-coupon-time" data-unit="d"><span class="num">' + pad(d) + '</span><span class="lbl">Dias</span></div>';
      }
      blocks += '<div class="vtx-coupon-time" data-unit="h"><span class="num">' + pad(h) + '</span><span class="lbl">Horas</span></div>';
      blocks += '<div class="vtx-coupon-time" data-unit="m"><span class="num">' + pad(m) + '</span><span class="lbl">Min</span></div>';
      blocks += '<div class="vtx-coupon-time" data-unit="s"><span class="num">' + pad(s) + '</span><span class="lbl">Seg</span></div>';

      var copySvg =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>' +
        '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

      badge.innerHTML =
        '<div class="vtx-coupon-header">' +
          iconSvg +
          '<div class="vtx-coupon-headline">' +
            '<div class="vtx-coupon-title">' + escapeHtml(title) + '</div>' +
            '<div class="vtx-coupon-sub">' + escapeHtml(sub) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="vtx-coupon-bottom">' +
          '<div class="vtx-coupon-timer">' + blocks + '</div>' +
          '<div class="vtx-coupon-action">' +
            '<span class="vtx-coupon-code" title="Selecione e copie">' + escapeHtml(code) + '</span>' +
            '<button type="button" class="vtx-coupon-copy" aria-label="Copiar cupom">' +
              copySvg + '<span class="vtx-coupon-copy-label">Copiar</span>' +
            '</button>' +
          '</div>' +
        '</div>';

      var copyBtn = badge.querySelector(".vtx-coupon-copy");
      var copyLabel = badge.querySelector(".vtx-coupon-copy-label");
      if (copyBtn) {
        copyBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          var done = function () {
            badge.classList.add("vtx-coupon-copied");
            if (copyLabel) copyLabel.textContent = "Copiado!";
            setTimeout(function () {
              badge.classList.remove("vtx-coupon-copied");
              if (copyLabel) copyLabel.textContent = "Copiar";
            }, 1500);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code).then(done).catch(function () {});
          } else {
            try {
              var ta = document.createElement("textarea");
              ta.value = code; ta.style.position = "fixed"; ta.style.opacity = "0";
              document.body.appendChild(ta); ta.select(); document.execCommand("copy");
              document.body.removeChild(ta); done();
            } catch (err) { /* silent */ }
          }
        });
      }
    }

    function tick() {
      var remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        badge.style.display = "none";
        if (timer) clearInterval(timer);
        return;
      }
      var totalSec = Math.floor(remaining / 1000);
      var d = Math.floor(totalSec / 86400);
      var h = Math.floor((totalSec % 86400) / 3600);
      var m = Math.floor((totalSec % 3600) / 60);
      var s = totalSec % 60;
      var nums = badge.querySelectorAll(".vtx-coupon-time");
      var values = (d > 0 && nums.length === 4) ? [pad(d), pad(h), pad(m), pad(s)] : [pad(h), pad(m), pad(s)];
      // Skip if days appeared/disappeared — rebuild skeleton
      if ((d > 0 && nums.length === 3) || (d === 0 && nums.length === 4)) {
        buildSkeleton(remaining);
        return;
      }
      for (var i = 0; i < nums.length && i < values.length; i++) {
        var span = nums[i].querySelector(".num");
        if (span && span.textContent !== values[i]) span.textContent = values[i];
      }
    }

    var initialRemaining = expiresAt - Date.now();
    if (initialRemaining <= 0) return null;
    buildSkeleton(initialRemaining);
    timer = setInterval(tick, 1000);
    return badge;
  }

  // Returns (or creates+inserts) a single row container that holds the
  // cashback + viewers pills side-by-side below the price block.
  function getOrCreatePromoTagRow() {
    var existing = document.getElementById("vtx-promo-tag-row");
    if (existing) return existing;
    var row = document.createElement("div");
    row.id = "vtx-promo-tag-row";
    row.className = "vtx-promo-tag-row";

    var price = findPriceAnchor();
    if (!price) return null;
    // Walk up while parent is flex/grid so the row isn't absorbed inline
    var anchor = price;
    for (var i = 0; i < 6; i++) {
      var parent = anchor.parentNode;
      if (!parent || parent === document.body) break;
      var s = window.getComputedStyle ? window.getComputedStyle(parent) : null;
      var d = s ? s.display : "";
      if (d !== "flex" && d !== "inline-flex" && d !== "grid" && d !== "inline-grid") {
        parent.insertBefore(row, anchor.nextSibling);
        return row;
      }
      anchor = parent;
    }
    price.parentNode.insertBefore(row, price.nextSibling);
    return row;
  }

  function insertNearPrice(badge, fallbackInsert) {
    var price = findPriceAnchor();
    if (price) {
      var anchor = price;
      for (var i = 0; i < 6; i++) {
        var parent = anchor.parentNode;
        if (!parent || parent === document.body) break;
        var s = window.getComputedStyle ? window.getComputedStyle(parent) : null;
        var d = s ? s.display : "";
        if (d !== "flex" && d !== "inline-flex" && d !== "grid" && d !== "inline-grid") {
          parent.insertBefore(badge, anchor.nextSibling);
          return true;
        }
        anchor = parent;
      }
      price.parentNode.insertBefore(badge, price.nextSibling);
      return true;
    }
    return fallbackInsert ? fallbackInsert(badge) : false;
  }

  function applyPromoTagsPDP(matches, payload) {
    if (!matches) return;
    var productId = extractProductId();
    if (!productId || !matches[productId]) return;

    var rules = matches[productId].filter(function (rule) {
      return promoTagShowsOnPage(rule, "product");
    });
    if (!rules.length) return;
    var fallbackCashbackPct = payload && payload.cashback_percent ? payload.cashback_percent : 0;

    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      var badgeType = rule.badge_type || "static";
      var placement = rule.badge_placement || "auto";
      var marker = "vtx-promo-tag-rendered-" + badgeType + "-" + i;
      if (document.querySelector("[data-vtx-mark='" + marker + "']")) continue;

      var badge = null;
      if (badgeType === "cashback") {
        badge = createCashbackBadge(rule, fallbackCashbackPct);
      } else if (badgeType === "viewers") {
        badge = createViewersBadge(rule, productId);
      } else if (badgeType === "coupon_countdown") {
        badge = createCouponCountdownBadge(rule);
      } else {
        // Static badge — multiple statics can coexist in the row (one per rule).
        // Was previously deduped to "first only", which made a newly added
        // rule visually replace the existing one.
        badge = createBadgeElement(rule, true);
      }
      if (!badge) continue;
      badge.setAttribute("data-vtx-mark", marker);

      var inserted = false;
      // By default, all PDP badges live in the shared row below the price so
      // cashback / viewers / static promos line up together. Use
      // placement=pdp_above_buy to opt a static badge out into the legacy slot.
      var goesNearPrice =
        placement === "pdp_price" ||
        placement === "auto";

      if (badgeType === "coupon_countdown") {
        // Kit products: drop the countdown right below the promo tag row,
        // which the theme already renders OUTSIDE the size/buy selection
        // panel. No special anchor hunting — just sit beneath the tags.
        var kitTagRow = isKitProduct() ? findKitDropAnchor() : null;
        if (kitTagRow && kitTagRow.parentNode) {
          kitTagRow.parentNode.insertBefore(badge, kitTagRow.nextSibling);
          inserted = true;
        } else {
          // Default: coupon banner sits RIGHT BEFORE the buy button so it
          // always pushes it down and never visually overlaps any sibling.
          var couponBuyBtn = document.querySelector(
            ".buy-button-container, .product-buy, #buy-button, " +
            "[data-cart-add], .add-to-cart, form.product-form .submit, " +
            "button.buy-btn, .product-actions, .product-buy-area"
          );
          if (couponBuyBtn && couponBuyBtn.parentNode) {
            couponBuyBtn.parentNode.insertBefore(badge, couponBuyBtn);
            inserted = true;
          } else {
            var existingRow = document.getElementById("vtx-promo-tag-row");
            if (existingRow && existingRow.parentNode) {
              existingRow.parentNode.insertBefore(badge, existingRow.nextSibling);
              inserted = true;
            } else {
              inserted = insertNearPrice(badge);
            }
          }
        }
      } else if (goesNearPrice) {
        var row = getOrCreatePromoTagRow();
        if (row) {
          row.appendChild(badge);
          inserted = true;
        } else {
          inserted = insertNearPrice(badge);
        }
      } else {
        // Default static placement (above buy button)
        var buyBtn = document.querySelector(
          ".buy-button-container, .product-buy, #buy-button, " +
          "[data-cart-add], .add-to-cart, form.product-form .submit, " +
          "button.buy-btn, .product-actions, .product-buy-area"
        );
        if (buyBtn) {
          buyBtn.parentNode.insertBefore(badge, buyBtn);
          inserted = true;
        } else {
          inserted = insertNearPrice(badge);
        }
      }

      if (!inserted) {
        var form = document.querySelector("#product-form, .product-form, form[action*='carrinho']");
        if (form) form.parentNode.insertBefore(badge, form);
      }
    }
  }

  function applyPromoTagsListing(matches, pageType) {
    // Category/listing pages: inject inline badge in description area of card
    var cards = document.querySelectorAll("[data-product-id]");
    var vtxCards = document.querySelectorAll("[data-vtx-product-id]");

    function processCard(card, idAttr) {
      var productId = card.getAttribute(idAttr);
      if (!productId || !matches[productId]) return;
      if (card.querySelector(".vtx-promo-tag")) return;

      // Use the first STATIC rule for listing — cashback/viewers are PDP-only
      var rule = null;
      for (var r = 0; r < matches[productId].length; r++) {
        if (
          (matches[productId][r].badge_type || "static") === "static" &&
          promoTagShowsOnPage(matches[productId][r], pageType)
        ) {
          rule = matches[productId][r];
          break;
        }
      }
      if (!rule) return;
      // Use inline badge (like PDP) to avoid overlapping size selectors
      var badge = createBadgeElement(rule, true);

      // Try to insert into the description/info area of the card
      var descArea = card.querySelector(
        ".description, .product-info, .product-details, .product-content, .info"
      );
      if (descArea) {
        // Insert as first child of description area (before product name)
        descArea.insertBefore(badge, descArea.firstChild);
        return;
      }

      // Fallback: insert after the image container
      var imgContainer = card.querySelector(
        ".product-image, .product-img, .image, figure, .images"
      );
      if (imgContainer) {
        imgContainer.parentNode.insertBefore(badge, imgContainer.nextSibling);
        return;
      }

      // Last fallback: append to card
      card.appendChild(badge);
    }

    for (var i = 0; i < cards.length; i++) {
      processCard(cards[i], "data-product-id");
    }
    for (var j = 0; j < vtxCards.length; j++) {
      processCard(vtxCards[j], "data-vtx-product-id");
    }
  }

  function applyPromoTags(matches, payload) {
    var pageType = detectPageType();
    if (pageType === "product") {
      applyPromoTagsPDP(matches, payload);
    } else {
      applyPromoTagsListing(matches, pageType);
    }
  }

  function observeNewProducts(matches, payload) {
    if (!window.MutationObserver) return;

    var debounceTimer = null;
    var observer = new MutationObserver(function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        applyPromoTags(matches, payload);
      }, 200);
    });

    var target = document.querySelector("main") || document.querySelector(".products") || document.body;
    observer.observe(target, { childList: true, subtree: true });
  }

  function initPromoTags() {
    if (!API_KEY || !API_BASE) return;

    fetchJSON(API_BASE + "/api/promo-tags/products?key=" + API_KEY)
      .then(function (data) {
        if (!data.matches || Object.keys(data.matches).length === 0) return;

        var matches = data.matches;
        console.log("[PromoTags] Loaded", Object.keys(matches).length, "product matches");

        injectPromoTagStyles();
        applyPromoTags(matches, data);
        observeNewProducts(matches, data);
      })
      .catch(function (err) {
        // Promo tags are optional - never break the page
        console.warn("[PromoTags] Init error:", err);
      });
  }

  // =====================================================================
  // META CAPI MODULE - Server-side event forwarding for BK COM pixel
  //
  // Strategy: CAPI-only (no browser pixel injection).
  //   - VNDA's native pixel + CAPI for 001BK stays 100% untouched
  //   - We NEVER call fbq("init") — avoids polluting VNDA's fbq instance
  //     which would cause their track() calls to fire on both pixels
  //   - All BK COM events go server-side via /api/meta-capi
  //   - _fbp and _fbc cookies (set by VNDA's pixel) are forwarded to CAPI
  //     for user matching — these are global, not pixel-specific
  //   - Meta attributes conversions based on ad click → _fbc match
  // =====================================================================

  var VTX_CAPI_ENABLED = !!(window._vtxPixelId || window._vtxCapiEnabled);

  function initCAPI() {
    if (!VTX_CAPI_ENABLED || !API_BASE || !API_KEY) return;

    // Run BEFORE any event dispatch so autofilled email/phone is in cookies
    // by the time PageView/ViewContent fire — those events then carry the
    // advanced matching params from page 1.
    initAttributionCapture();

    // --- PageView ---
    sendCAPI("pageview", {});

    // --- ViewContent on product pages ---
    var pageType = detectPageType();
    if (pageType === "product") {
      var productId = extractProductId();
      var productName = "";
      var ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) productName = ogTitle.getAttribute("content") || "";

      var priceStr = "";
      var priceMeta = document.querySelector('meta[property="product:price:amount"]');
      if (priceMeta) priceStr = priceMeta.getAttribute("content") || "";

      sendCAPI("view_content", {
        content_ids: productId ? [productId] : [],
        content_name: productName,
        content_type: "product",
        value: parseFloat(priceStr) || 0,
      });
    }

    // --- AddToCart ---
    // The live VNDA theme adds items via `POST /carrinho/adicionar` (and
    // `/carrinho/adicionar/kit` for kits) and does NOT dispatch a
    // `vnda:cart-drawer-added-item` DOM event — so the old window listener
    // never fired and AddToCart never reached the CAPI pixel. We hook the
    // cart-add network request instead: robust to theme/drawer/event-name
    // changes, same signal the native VNDA pixel uses.
    if (!window.__vtxAtcHooked) {
      window.__vtxAtcHooked = true;
      var ATC_RE = /\/carrinho\/adicionar(\/kit)?($|[?#])/;
      var lastAtc = 0;

      var parseForm = function (str) {
        var out = {};
        if (typeof str !== "string" || !str) return out;
        var pairs = str.split("&");
        for (var i = 0; i < pairs.length; i++) {
          var kv = pairs[i].split("=");
          if (!kv[0]) continue;
          try {
            out[decodeURIComponent(kv[0].replace(/\+/g, " "))] =
              decodeURIComponent((kv[1] || "").replace(/\+/g, " "));
          } catch (e) {}
        }
        return out;
      };

      var fireAddToCart = function (reqBody) {
        var now = Date.now();
        if (now - lastAtc < 1500) return; // collapse duplicate signals for one add
        lastAtc = now;
        var data = { content_type: "product" };
        var pid = extractProductId();
        var form = parseForm(reqBody);
        var qty = parseInt(form.quantity, 10) || 1;
        if (!pid) pid = form.sku || form.variant_sku || null;
        if (pid) data.content_ids = [pid];
        var priceMeta = document.querySelector('meta[property="product:price:amount"]');
        var unit = priceMeta ? parseFloat(priceMeta.getAttribute("content")) || 0 : 0;
        if (unit > 0) data.value = unit * (qty > 0 ? qty : 1);
        sendCAPI("add_to_cart", data);
      };

      // fetch — the theme's cart-add path
      if (window.fetch) {
        var _vtxFetch = window.fetch;
        window.fetch = function (input, init) {
          var url = typeof input === "string" ? input : (input && input.url) || "";
          var method =
            (init && init.method) ||
            (typeof input === "object" && input && input.method) ||
            "GET";
          var body = init && typeof init.body === "string" ? init.body : "";
          var isAtc = ATC_RE.test(url) && /post/i.test(method);
          var ret = _vtxFetch.apply(this, arguments);
          if (isAtc && ret && ret.then) {
            ret
              .then(function (res) {
                if (res && res.ok) fireAddToCart(body);
              })
              .catch(function () {});
          }
          return ret;
        };
      }

      // XHR fallback — jQuery-based add buttons, if any theme uses them
      if (window.XMLHttpRequest && XMLHttpRequest.prototype) {
        var _vtxOpen = XMLHttpRequest.prototype.open;
        var _vtxSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (m, u) {
          this.__vtxAtc = ATC_RE.test(u || "") && /post/i.test(m || "");
          return _vtxOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function (b) {
          if (this.__vtxAtc) {
            var self = this;
            var bodyStr = typeof b === "string" ? b : "";
            this.addEventListener("load", function () {
              if (self.status >= 200 && self.status < 300) fireAddToCart(bodyStr);
            });
          }
          return _vtxSend.apply(this, arguments);
        };
      }

      // Future-proof: if a theme ever starts emitting the drawer event, honor
      // it too (the throttle dedups it against the network hook above).
      window.addEventListener("vnda:cart-drawer-added-item", function () {
        fireAddToCart("");
      });
    }

    // --- InitiateCheckout ---
    if (window.location.pathname.indexOf("/checkout") !== -1 &&
        window.location.pathname.indexOf("/confirmation") === -1) {
      sendCAPI("initiate_checkout", {});
    }

    // --- Purchase (confirmation page) ---
    //
    // Uses a deterministic event_id ("vtx_purchase_<orderCode>") so this
    // browser-side event deduplicates with the server-side Purchase fired by
    // the VNDA webhook. Meta merges the two — keeping fbp/fbc/IP/UA from the
    // browser AND the hashed PII (email, phone, name, address, birthdate)
    // from the webhook — without double-counting revenue.
    var purchasePath =
      window.location.pathname.indexOf("/checkout/confirmation") !== -1 ||
      window.location.pathname.indexOf("/pedido/") !== -1;
    if (purchasePath) {
      var orderCode = extractOrderCode();
      getCartTotal(function (total) {
        if (total > 0) {
          var purchaseData = { value: total };
          if (orderCode) {
            purchaseData.event_id = "vtx_purchase_" + orderCode;
            purchaseData.order_id = orderCode;
          }
          sendCAPI("purchase", purchaseData);
        }
      });
    }

    console.log("[VtxCAPI] Initialized server-side events for BK COM pixel");
  }

  // ---------------------------------------------------------------------
  // Meta CAPI attribution snapshot
  //
  // The server-side Purchase fired by the VNDA webhook has hashed PII but
  // lacks fbc/fbp/IP/UA (those are browser-only). We snapshot them keyed by
  // the customer's email whenever they type it on the checkout form, so the
  // webhook can later join by email and merge them into the Purchase event.
  // Without this, Meta's Event Match Quality caps around 6/10 on Purchase.
  // ---------------------------------------------------------------------
  var attributionSent = {}; // email -> 1, dedupe per session

  // Persist email/phone the customer typed in any form (checkout, account,
  // newsletter, ...) so future PageView/ViewContent/AddToCart events fired
  // anywhere on the site can include them as advanced matching params. The
  // /api/meta-capi endpoint hashes them server-side before sending to Meta.
  function setStoredEmail(email) {
    if (!email || email.indexOf("@") === -1) return;
    setCookie("_vtx_em", encodeURIComponent(String(email).trim().toLowerCase()), 90);
  }
  function setStoredPhone(phone) {
    if (!phone) return;
    var digits = String(phone).replace(/\D+/g, "");
    if (digits.length < 8) return; // too short to be a real phone
    setCookie("_vtx_ph", digits, 90);
  }
  function getStoredEmail() {
    var v = getCookie("_vtx_em");
    if (!v) return "";
    try { return decodeURIComponent(v); } catch (e) { return v; }
  }
  function getStoredPhone() {
    return getCookie("_vtx_ph") || "";
  }

  function getOrCreateFbp() {
    var fbp = getCookie("_fbp") || "";
    if (/^fb\.\d+\.\d+\.[A-Za-z0-9_-]+$/.test(fbp)) return fbp;

    var rand = "";
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        var arr = new Uint32Array(2);
        window.crypto.getRandomValues(arr);
        rand = String(arr[0]) + String(arr[1]);
      }
    } catch (e) { /* fallback below */ }
    if (!rand) rand = String(Math.floor(Math.random() * 10000000000));

    fbp = "fb.1." + Date.now() + "." + rand;
    setCookie("_fbp", fbp, 90);
    return fbp;
  }

  function getFreshFbc() {
    var fbc = getCookie("_fbc") || "";
    if (!fbc) return "";
    var match = String(fbc).match(/^fb\.\d+\.(\d+)\..+$/);
    if (!match) return "";
    var ts = parseInt(match[1], 10);
    if (!isFinite(ts)) return "";
    var age = Date.now() - ts;
    if (age < -5 * 60 * 1000 || age > 90 * 24 * 60 * 60 * 1000) return "";
    return fbc;
  }

  function sendAttribution(email) {
    if (!VTX_CAPI_ENABLED || !API_BASE || !API_KEY) return;
    if (!email || email.indexOf("@") === -1) return;
    var normalized = String(email).trim().toLowerCase();
    setStoredEmail(normalized);
    if (attributionSent[normalized]) return;
    var fbc = getFreshFbc();
    var fbp = getOrCreateFbp();
    if (!fbc && !fbp) return; // nothing useful to capture
    attributionSent[normalized] = 1;

    var payload = JSON.stringify({
      key: API_KEY,
      email: normalized,
      fbc: fbc,
      fbp: fbp,
      consumer_id: consumerId || "",
      user_agent: navigator.userAgent,
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        API_BASE + "/api/meta-attribution",
        new Blob([payload], { type: "application/json" })
      );
    } else {
      fetch(API_BASE + "/api/meta-attribution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(function () {});
    }
  }

  function isEmailLike(v) {
    return v && typeof v === "string" && v.indexOf("@") > 0 && v.length > 4;
  }
  function isPhoneLike(v) {
    if (!v || typeof v !== "string") return false;
    var d = v.replace(/\D+/g, "");
    return d.length >= 8 && d.length <= 15;
  }

  function initAttributionCapture() {
    if (!VTX_CAPI_ENABLED) return;

    function bindEmail(el) {
      if (el._vtxAttrBound) return;
      el._vtxAttrBound = 1;
      var inputTimer = null;
      el.addEventListener("input", function (e) {
        if (!isEmailLike(e.target.value)) return;
        setStoredEmail(e.target.value);
        clearTimeout(inputTimer);
        inputTimer = setTimeout(function () {
          sendAttribution(e.target.value);
        }, 350);
      });
      el.addEventListener("blur", function (e) {
        if (isEmailLike(e.target.value)) sendAttribution(e.target.value);
      });
      el.addEventListener("change", function (e) {
        if (isEmailLike(e.target.value)) sendAttribution(e.target.value);
      });
      if (isEmailLike(el.value)) sendAttribution(el.value);
    }

    function bindPhone(el) {
      if (el._vtxPhoneBound) return;
      el._vtxPhoneBound = 1;
      el.addEventListener("input", function (e) {
        if (isPhoneLike(e.target.value)) setStoredPhone(e.target.value);
      });
      el.addEventListener("blur", function (e) {
        if (isPhoneLike(e.target.value)) setStoredPhone(e.target.value);
      });
      el.addEventListener("change", function (e) {
        if (isPhoneLike(e.target.value)) setStoredPhone(e.target.value);
      });
      if (isPhoneLike(el.value)) setStoredPhone(el.value);
    }

    function scan() {
      try {
        var emailNodes = document.querySelectorAll(
          'input[type="email"], input[name*="email" i], input[id*="email" i]'
        );
        for (var i = 0; i < emailNodes.length; i++) bindEmail(emailNodes[i]);

        var phoneNodes = document.querySelectorAll(
          'input[type="tel"], ' +
          'input[name*="phone" i], input[id*="phone" i], ' +
          'input[name*="telefone" i], input[id*="telefone" i], ' +
          'input[name*="celular" i], input[id*="celular" i]'
        );
        for (var j = 0; j < phoneNodes.length; j++) bindPhone(phoneNodes[j]);
      } catch (e) { /* swallow */ }
    }
    scan();
    // Re-scan when the SPA-like checkout swaps DOM nodes.
    try {
      var mo = new MutationObserver(function () { scan(); });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* old browsers */ }
  }

  // Extract the VNDA order code from the confirmation page. VNDA's canonical
  // pattern is /pedido/<code>; some themes also render data-order-id on the
  // confirmation container.
  function extractOrderCode() {
    try {
      var m = window.location.pathname.match(/\/pedido\/([A-Za-z0-9_-]+)/);
      if (m && m[1]) return m[1];
      var el = document.querySelector("[data-order-code], [data-order-id]");
      if (el) {
        var v = el.getAttribute("data-order-code") || el.getAttribute("data-order-id");
        if (v) return v;
      }
    } catch (e) { /* swallow */ }
    return null;
  }

  function sendCAPI(eventType, data) {
    if (!API_BASE) return;

    // Persisted advanced matching params — populated whenever the customer
    // types email/phone in any form on the site. Server hashes before send.
    var storedEmail = getStoredEmail();
    var storedPhone = getStoredPhone();
    if (storedEmail) sendAttribution(storedEmail);

    var payload = {
      key: API_KEY,
      event_type: eventType,
      event_id: data.event_id || ("vtx_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10)),
      url: window.location.href,
      referrer: document.referrer || "",
      user_agent: navigator.userAgent,
      fbc: getFreshFbc(),
      fbp: getOrCreateFbp(),
      external_id: consumerId || "",
      email: data.email || storedEmail || "",
      phone: data.phone || storedPhone || "",
      content_ids: data.content_ids || [],
      content_name: data.content_name || "",
      content_type: data.content_type || "product",
      value: data.value || 0,
      currency: "BRL",
      order_id: data.order_id || "",
    };

    var body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        API_BASE + "/api/meta-capi",
        new Blob([body], { type: "application/json" })
      );
    } else {
      fetch(API_BASE + "/api/meta-capi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true,
      }).catch(function () {});
    }
  }

  // --- Topbar (régua superior flutuante com ofertas, countdown e IA) ---

  function initTopbar() {
    var pageType = detectPageType();
    // GUARD: nunca aparece em cart/checkout. detectPageType() já cobre /carrinho,
    // /cart, /checkout. Bail antes de qualquer fetch.
    if (pageType === "cart") return;

    function dismissalKey(campaignId) {
      return "_vtx_topbar_dismissed_" + campaignId;
    }
    function isDismissed(campaignId, hoursValid) {
      try {
        var v = localStorage.getItem(dismissalKey(campaignId));
        if (!v) return false;
        var ageH = (Date.now() - parseInt(v, 10)) / 3600000;
        return ageH < (hoursValid || 24);
      } catch (e) { return false; }
    }
    function markDismissed(campaignId) {
      try { localStorage.setItem(dismissalKey(campaignId), String(Date.now())); } catch (e) {}
    }

    function trackTopbar(eventType, campaignId, variationId) {
      try {
        var payload = {
          event_type: eventType,
          campaign_id: campaignId || null,
          variation_id: variationId || null,
          page_type: pageType,
          session_id: sessionId,
        };
        var url = API_BASE + "/api/topbar/track?key=" + encodeURIComponent(API_KEY);
        if (navigator.sendBeacon) {
          navigator.sendBeacon(url, new Blob([JSON.stringify(payload)], { type: "application/json" }));
        } else {
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            keepalive: true,
          }).catch(function () {});
        }
      } catch (e) {}
    }

    function renderTopbar(tb) {
      if (!tb) return;
      if (tb.campaign_id && isDismissed(tb.campaign_id, tb.close_persistence_hours)) return;

      var prev = document.getElementById("vtx-topbar");
      if (prev && typeof prev.__vtxCleanup === "function") prev.__vtxCleanup();
      if (prev) prev.remove();

      var bar = document.createElement("div");
      bar.id = "vtx-topbar";
      bar.setAttribute("role", "region");
      bar.setAttribute("aria-label", "Promotional bar");

      var isTop = tb.position !== "bottom";
      var sticky = tb.sticky !== false;
      var styles = [
        "position:" + (sticky ? "fixed" : "absolute"),
        isTop ? "top:0" : "bottom:0",
        "left:0", "right:0",
        "z-index:2147483600",
        "background:" + (tb.bg_color || "#0f172a"),
        "color:" + (tb.text_color || "#ffffff"),
        "font-size:" + (tb.font_size || "14px"),
        "min-height:" + (tb.height || "40px"),
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "gap:0",
        "padding:8px 52px 8px 20px",
        "box-sizing:border-box",
        "text-align:center",
        "line-height:1.35",
        "font-family:inherit",
        // Zera font-weight herdado do tema da loja — cada child decide o seu
        "font-weight:400",
        "box-shadow:0 1px 0 rgba(255,255,255,.08),0 8px 22px rgba(0,0,0,.08)",
        "border-bottom:1px solid rgba(255,255,255,.10)",
      ];
      bar.setAttribute("style", styles.join(";"));

      var content = document.createElement("div");
      content.setAttribute("data-vtx-topbar-content", "true");
      content.setAttribute(
        "style",
        "display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:center;min-width:0;width:min(100%,1280px);max-width:100%;margin:0 auto"
      );

      var titleBold = tb.title_bold !== false;   // default true
      var messageBold = tb.message_bold === true; // default false
      var slideLineHeight = "2.1em";
      var slides = [];
      function topbarStyleValue(value, fallback) {
        var cleaned = String(value || "").replace(/[;{}]/g, "").trim();
        return cleaned || fallback || "";
      }
      function isLightTopbarColor(value) {
        var raw = String(value || "").trim().toLowerCase();
        var hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (hex) {
          var h = hex[1];
          if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
          var r = parseInt(h.slice(0, 2), 16);
          var g = parseInt(h.slice(2, 4), 16);
          var b = parseInt(h.slice(4, 6), 16);
          return (r * 299 + g * 587 + b * 114) / 1000 > 170;
        }
        var rgb = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (rgb) {
          return (
            (Number(rgb[1]) * 299 + Number(rgb[2]) * 587 + Number(rgb[3]) * 114) /
              1000 >
            170
          );
        }
        return raw.indexOf("white") >= 0 || raw.indexOf("255,255,255") >= 0;
      }
      function topbarReadableText(bg) {
        return isLightTopbarColor(bg) ? "#111827" : "#ffffff";
      }
      if (Array.isArray(tb.slides)) {
        for (var si = 0; si < tb.slides.length; si++) {
          var item = tb.slides[si] || {};
          var itemMsg = String(item.message || "").trim();
          if (!itemMsg) continue;
          slides.push({
            title: String(item.title || "").trim(),
            message: itemMsg,
            link_url: String(item.link_url || "").trim(),
            link_label: String(item.link_label || "").trim(),
            button_bg_color: topbarStyleValue(item.button_bg_color),
            button_text_color: topbarStyleValue(item.button_text_color),
            button_padding: topbarStyleValue(item.button_padding),
            button_border_radius: topbarStyleValue(item.button_border_radius),
            button_font_weight: topbarStyleValue(item.button_font_weight),
          });
        }
      }
      if (!slides.length) {
        slides.push({
          title: String(tb.title || "").trim(),
          message: String(tb.message || "").trim(),
          link_url: String(tb.link_url || "").trim(),
          link_label: String(tb.link_label || "").trim(),
          button_bg_color: topbarStyleValue(tb.button_bg_color),
          button_text_color: topbarStyleValue(tb.button_text_color),
          button_padding: topbarStyleValue(tb.button_padding),
          button_border_radius: topbarStyleValue(tb.button_border_radius),
          button_font_weight: topbarStyleValue(tb.button_font_weight),
        });
      }

      function buildTopbarSlide(slide, slideIndex) {
        var row = document.createElement("span");
        row.setAttribute("data-vtx-slide-row", "true");
        row.setAttribute(
          "style",
          "height:" + slideLineHeight +
            ";min-height:" + slideLineHeight +
            ";display:flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;min-width:0;max-width:100%;overflow:hidden;line-height:1.35"
        );
        if (slide.title) {
          var titleEl = document.createElement("span");
          if (slideIndex === 0) titleEl.id = "vtx-topbar-title";
          titleEl.setAttribute("data-vtx-copy-title", "true");
          titleEl.setAttribute(
            "style",
            "font-weight:" + (titleBold ? 700 : 400) +
              ";letter-spacing:.02em;overflow:hidden;text-overflow:ellipsis;min-width:0;max-width:42vw;line-height:1.35"
          );
          titleEl.textContent = slide.title;
          row.appendChild(titleEl);
        }

        var msg = document.createElement("span");
        if (slideIndex === 0) msg.id = "vtx-topbar-msg";
        msg.setAttribute("data-vtx-copy-message", "true");
        msg.setAttribute(
          "style",
          "font-weight:" + (messageBold ? 700 : 400) +
            ";overflow:hidden;text-overflow:ellipsis;min-width:0;max-width:100%;line-height:1.35"
        );
        msg.textContent = slide.message || "";
        row.appendChild(msg);
        return row;
      }

      var copyWrap = document.createElement("span");
      copyWrap.id = "vtx-topbar-copy";
      copyWrap.setAttribute(
        "style",
        "display:inline-flex;align-items:" + (slides.length > 1 ? "flex-start" : "center") +
          ";justify-content:center;min-width:0;max-width:min(760px,100%);overflow:hidden"
      );

      var slideTrack = document.createElement("span");
      slideTrack.setAttribute(
        "style",
        "display:inline-flex;align-items:center;justify-content:center;min-width:0;max-width:100%;transition:transform .24s ease,opacity .24s ease;will-change:transform,opacity"
      );
      function renderVisibleSlide(slideIndex) {
        while (slideTrack.firstChild) slideTrack.removeChild(slideTrack.firstChild);
        slideTrack.appendChild(buildTopbarSlide(slides[slideIndex] || slides[0], 0));
      }
      renderVisibleSlide(0);
      copyWrap.appendChild(slideTrack);
      content.appendChild(copyWrap);
      var slideTimer = null;
      var slideSwapTimer = null;
      var slidePaused = false;
      var activeSlide = 0;
      function syncSlideHeight() {
        copyWrap.style.height = "";
      }
      if (slides.length > 1) {
        copyWrap.addEventListener("mouseenter", function () { slidePaused = true; });
        copyWrap.addEventListener("mouseleave", function () { slidePaused = false; });
        slideTimer = setInterval(function () {
          if (slidePaused) return;
          var nextSlide = (activeSlide + 1) % slides.length;
          slideTrack.style.transform = "translateY(-8px)";
          slideTrack.style.opacity = "0";
          if (slideSwapTimer) clearTimeout(slideSwapTimer);
          slideSwapTimer = setTimeout(function () {
            activeSlide = nextSlide;
            renderVisibleSlide(activeSlide);
            updateCtaForActiveSlide();
            applyResponsiveTopbarLayout();
            slideTrack.style.transition = "none";
            slideTrack.style.transform = "translateY(8px)";
            slideTrack.style.opacity = "0";
            requestAnimationFrame(function () {
              slideTrack.style.transition = "transform .24s ease,opacity .24s ease";
              slideTrack.style.transform = "translateY(0)";
              slideTrack.style.opacity = "1";
              setTimeout(applyOffsets, 0);
            });
          }, 220);
        }, 3500);
      }

      var actionsWrap = document.createElement("span");
      actionsWrap.setAttribute("data-vtx-topbar-actions", "true");
      actionsWrap.setAttribute(
        "style",
        "display:inline-flex;align-items:center;justify-content:center;gap:10px;flex-wrap:nowrap;min-width:0;max-width:100%"
      );

      var cta = null;
      function updateCtaForActiveSlide() {
        if (!cta) return;
        var slide = slides[activeSlide] || slides[0] || {};
        if (slide.link_url && slide.link_label) {
          var ctaBg = topbarStyleValue(
            slide.button_bg_color,
            tb.accent_color || "#ffffff"
          );
          cta.href = safeUrl(slide.link_url);
          cta.textContent = slide.link_label;
          cta.style.display = "inline-flex";
          cta.style.background = ctaBg;
          cta.style.color = topbarStyleValue(slide.button_text_color, topbarReadableText(ctaBg));
          cta.style.padding = topbarStyleValue(slide.button_padding, "7px 16px");
          cta.style.borderRadius = topbarStyleValue(slide.button_border_radius, "12px");
          cta.style.fontWeight = topbarStyleValue(slide.button_font_weight, "700");
        } else {
          cta.removeAttribute("href");
          cta.textContent = "";
          cta.style.display = "none";
        }
      }
      var hasSlideCta = false;
      for (var ctaIdx = 0; ctaIdx < slides.length; ctaIdx++) {
        if (slides[ctaIdx].link_url && slides[ctaIdx].link_label) {
          hasSlideCta = true;
          break;
        }
      }
      if (hasSlideCta) {
        cta = document.createElement("a");
        cta.setAttribute("data-vtx-topbar-cta", "true");
        cta.setAttribute(
          "style",
          "display:inline-flex;align-items:center;justify-content:center;text-decoration:none;font-size:13px;line-height:1;white-space:nowrap;box-shadow:0 1px 0 rgba(255,255,255,.18) inset,0 1px 2px rgba(0,0,0,.10);transition:opacity .16s ease,transform .16s ease;box-sizing:border-box;max-width:100%"
        );
        cta.addEventListener("mouseenter", function () { cta.style.opacity = ".92"; });
        cta.addEventListener("mouseleave", function () { cta.style.opacity = "1"; });
        cta.addEventListener("click", function () {
          trackTopbar("click", tb.campaign_id, tb.variation_id);
        });
        updateCtaForActiveSlide();
        actionsWrap.appendChild(cta);
      }

      var countdownEl = null;
      var countdownCells = null;
      var countdownTarget = tb.countdown_enabled && tb.countdown_target
        ? new Date(tb.countdown_target).getTime() : 0;
      if (countdownTarget && countdownTarget > Date.now()) {
        countdownEl = document.createElement("span");
        countdownEl.id = "vtx-topbar-countdown";
        var cdBg = tb.countdown_bg_color || "rgba(255,255,255,.14)";
        var cdColor = tb.countdown_text_color || tb.text_color || "#ffffff";
        var cdWeight = tb.countdown_font_weight || "600";
        var cdPad = tb.countdown_padding || "7px 10px";
        var cdMargin = tb.countdown_margin || "0";
        var cdRadius = tb.countdown_border_radius || "12px";
        countdownEl.setAttribute(
          "style",
          "display:inline-flex;align-items:stretch;gap:0;overflow:hidden" +
            ";margin:" + cdMargin +
            ";border-radius:" + cdRadius +
            ";background:" + cdBg +
            ";color:" + cdColor +
            ";font-weight:" + cdWeight +
            ";font-size:13px;line-height:1;font-variant-numeric:tabular-nums" +
            ";box-sizing:border-box" +
            ";box-shadow:0 1px 0 rgba(255,255,255,.12) inset,0 1px 2px rgba(0,0,0,.08)" +
            ";border:1px solid rgba(255,255,255,.12)"
        );
        var countdownLabel = String(tb.countdown_label || "Termina em").trim();
        if (countdownLabel) {
          var labelEl = document.createElement("span");
          labelEl.setAttribute("data-vtx-countdown-label", "true");
          labelEl.setAttribute(
            "style",
            "display:inline-flex;align-items:center;justify-content:center;padding:0 10px;opacity:.74;font-size:10px;text-transform:uppercase;letter-spacing:.06em;border-right:1px solid rgba(255,255,255,.16);white-space:nowrap;box-sizing:border-box"
          );
          labelEl.textContent = countdownLabel;
          countdownEl.appendChild(labelEl);
        }
        function makeCountdownCell(unit) {
          var cell = document.createElement("span");
          cell.setAttribute("data-vtx-countdown-cell", "true");
          cell.setAttribute(
            "style",
            "display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:" +
              cdPad +
              ";white-space:nowrap;box-sizing:border-box" +
              (countdownEl.children.length ? ";border-left:1px solid rgba(255,255,255,.12)" : "")
          );
          var value = document.createElement("span");
          var unitEl = document.createElement("span");
          unitEl.setAttribute("style", "opacity:.64;margin-left:2px;font-size:.82em");
          unitEl.textContent = unit;
          cell.appendChild(value);
          cell.appendChild(unitEl);
          countdownEl.appendChild(cell);
          return { cell: cell, value: value };
        }
        countdownCells = {
          d: makeCountdownCell("d"),
          h: makeCountdownCell("h"),
          m: makeCountdownCell("m"),
          s: makeCountdownCell("s"),
        };
        actionsWrap.appendChild(countdownEl);
      }

      if (actionsWrap.children.length) content.appendChild(actionsWrap);

      bar.appendChild(content);

      function isCompactTopbar() {
        var w = window.innerWidth || document.documentElement.clientWidth || 0;
        return w > 0 && w <= 640;
      }

      function applyResponsiveTopbarLayout() {
        var compact = isCompactTopbar();
        bar.style.padding = compact
          ? (tb.show_close_button !== false ? "8px 38px 8px 12px" : "8px 12px")
          : "8px 52px 8px 20px";
        content.style.flexDirection = compact ? "column" : "row";
        content.style.gap = compact ? "6px" : "14px";
        content.style.width = compact ? "100%" : "min(100%,1280px)";

        copyWrap.style.width = compact ? "100%" : "";
        copyWrap.style.maxWidth = compact ? "100%" : "min(760px,100%)";
        copyWrap.style.alignItems = compact ? "center" : (slides.length > 1 ? "flex-start" : "center");

        slideTrack.style.width = compact ? "100%" : "";
        slideTrack.style.maxWidth = "100%";

        for (var rr = 0; rr < slideTrack.children.length; rr++) {
          var row = slideTrack.children[rr];
          row.style.width = compact ? "100%" : "";
          row.style.whiteSpace = compact ? "normal" : "nowrap";
          row.style.flexWrap = compact ? "wrap" : "nowrap";
          row.style.gap = compact ? "2px 7px" : "8px";
          row.style.overflow = compact ? "visible" : "hidden";
          row.style.textAlign = "center";
          row.style.height = compact ? "auto" : slideLineHeight;
          row.style.minHeight = compact ? "0" : slideLineHeight;
        }

        var titleParts = bar.querySelectorAll("[data-vtx-copy-title]");
        for (var tt = 0; tt < titleParts.length; tt++) {
          titleParts[tt].style.maxWidth = compact ? "100%" : "42vw";
          titleParts[tt].style.overflow = compact ? "visible" : "hidden";
          titleParts[tt].style.textOverflow = compact ? "clip" : "ellipsis";
        }

        var messageParts = bar.querySelectorAll("[data-vtx-copy-message]");
        for (var mm = 0; mm < messageParts.length; mm++) {
          messageParts[mm].style.overflow = compact ? "visible" : "hidden";
          messageParts[mm].style.textOverflow = compact ? "clip" : "ellipsis";
          messageParts[mm].style.maxWidth = "100%";
        }

        actionsWrap.style.width = compact ? "100%" : "";
        actionsWrap.style.flexWrap = compact ? "wrap" : "nowrap";
        actionsWrap.style.gap = compact ? "6px 8px" : "10px";

        if (cta) {
          cta.style.fontSize = compact ? "12px" : "13px";
          cta.style.minHeight = compact ? "30px" : "";
          cta.style.flexShrink = "0";
        }

        if (countdownEl) {
          countdownEl.style.maxWidth = "100%";
          countdownEl.style.flexShrink = "1";
          countdownEl.style.fontSize = compact ? "12px" : "13px";
        }

        var countdownLabelEl = countdownEl
          ? countdownEl.querySelector("[data-vtx-countdown-label]")
          : null;
        if (countdownLabelEl) {
          countdownLabelEl.style.padding = compact ? "0 8px" : "0 10px";
          countdownLabelEl.style.fontSize = compact ? "9px" : "10px";
        }

        var countdownCellEls = countdownEl
          ? countdownEl.querySelectorAll("[data-vtx-countdown-cell]")
          : [];
        for (var cc = 0; cc < countdownCellEls.length; cc++) {
          countdownCellEls[cc].style.minWidth = compact ? "36px" : "42px";
        }
      }

      if (tb.show_close_button !== false) {
        var close = document.createElement("button");
        close.setAttribute("aria-label", "Fechar");
        close.innerHTML = "&times;";
        close.setAttribute(
          "style",
          "position:absolute;right:8px;top:50%;transform:translateY(-50%);background:transparent;border:0;color:inherit;font-size:22px;cursor:pointer;opacity:.7;line-height:1;padding:4px 8px"
        );
        close.addEventListener("click", function () {
          trackTopbar("close", tb.campaign_id, tb.variation_id);
          if (tb.campaign_id) markDismissed(tb.campaign_id);
          cleanupTopbarInternals();
          bar.remove();
          document.documentElement.style.removeProperty("--vtx-topbar-h");
          document.body.style.removeProperty(isTop ? "padding-top" : "padding-bottom");
          unshiftFixedHeaders();
        });
        bar.appendChild(close);
      }

      // Empurra elementos fixed/sticky top:0 (header da loja) pra baixo
      // pela altura da topbar, e marca pra desfazer no close.
      function shiftFixedHeaders(barHeight) {
        if (!isTop) return; // só faz sentido na variante top
        // Varre TODOS os elementos do body (caro mas é one-shot)
        var all = document.body.querySelectorAll("*");
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          if (el === bar || bar.contains(el)) continue;
          var cs = getComputedStyle(el);
          if (cs.position !== "fixed" && cs.position !== "sticky") continue;
          // Só considera elementos efetivamente colados no top
          var topVal = parseFloat(cs.top);
          if (isNaN(topVal) || topVal > 8) continue;
          var storedTop = el.getAttribute("data-vtx-shifted");
          var originalTop = storedTop !== null ? parseFloat(storedTop) : (topVal || 0);
          if (isNaN(originalTop)) originalTop = 0;
          el.setAttribute("data-vtx-shifted", String(originalTop));
          el.style.setProperty("top", (originalTop + barHeight) + "px", "important");
        }
      }

      function unshiftFixedHeaders() {
        var marked = document.querySelectorAll("[data-vtx-shifted]");
        for (var i = 0; i < marked.length; i++) {
          var el = marked[i];
          var orig = parseFloat(el.getAttribute("data-vtx-shifted") || "0");
          el.style.setProperty("top", orig + "px", "important");
          el.removeAttribute("data-vtx-shifted");
        }
      }

      var resizeRaf = null;
      function queueTopbarResize() {
        if (resizeRaf) cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(applyOffsets);
      }

      function cleanupTopbarInternals() {
        if (slideTimer) clearInterval(slideTimer);
        if (slideSwapTimer) clearTimeout(slideSwapTimer);
        if (resizeRaf) cancelAnimationFrame(resizeRaf);
        window.removeEventListener("resize", queueTopbarResize);
        window.removeEventListener("orientationchange", queueTopbarResize);
      }

      bar.__vtxCleanup = cleanupTopbarInternals;

      document.body.appendChild(bar);

      function applyOffsets() {
        applyResponsiveTopbarLayout();
        syncSlideHeight();
        var h = bar.getBoundingClientRect().height || parseInt(tb.height, 10) || 40;
        document.documentElement.style.setProperty("--vtx-topbar-h", h + "px");
        document.body.style[isTop ? "paddingTop" : "paddingBottom"] = h + "px";
        shiftFixedHeaders(h);
      }
      requestAnimationFrame(applyOffsets);
      // Themes (VNDA, Shopify) costumam montar header async — reaplica.
      setTimeout(applyOffsets, 600);
      setTimeout(applyOffsets, 1800);
      window.addEventListener("resize", queueTopbarResize);
      window.addEventListener("orientationchange", queueTopbarResize);

      trackTopbar("impression", tb.campaign_id, tb.variation_id);

      if (countdownEl) {
        function pad(n) { return String(n).padStart(2, "0"); }
        function tick() {
          var ms = countdownTarget - Date.now();
          if (ms <= 0) {
            countdownEl.textContent = "";
            countdownEl.style.display = "none";
            return;
          }
          var s = Math.floor(ms / 1000);
          var d = Math.floor(s / 86400); s -= d * 86400;
          var h = Math.floor(s / 3600); s -= h * 3600;
          var m = Math.floor(s / 60); s -= m * 60;
          if (countdownCells) {
            countdownCells.d.cell.style.display = d > 0 ? "inline-flex" : "none";
            countdownCells.d.value.textContent = String(d);
            countdownCells.h.value.textContent = pad(h);
            countdownCells.m.value.textContent = pad(m);
            countdownCells.s.value.textContent = pad(s);
          } else {
            var label = tb.countdown_label || "Termina em";
            var parts = [];
            if (d > 0) parts.push(d + "d");
            parts.push(pad(h) + ":" + pad(m) + ":" + pad(s));
            countdownEl.textContent = label + " " + parts.join(" ");
          }
        }
        tick();
        setInterval(tick, 1000);
      }
    }

    var url = API_BASE + "/api/topbar/public-config?key=" +
      encodeURIComponent(API_KEY) + "&page_type=" + encodeURIComponent(pageType);
    fetch(url, { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data && data.topbar) renderTopbar(data.topbar); })
      .catch(function () {});
  }

  // =====================================================================
  // --- Gift Request (Pedir de Presente) -- botão na PDP que dispara
  // WhatsApp (template de utilidade) pra pessoa que vai presentear.
  // =====================================================================

  function initGiftRequest() {
    var pageType = detectPageType();
    console.log("[GiftRequest] init — pageType:", pageType);
    if (pageType !== "product") {
      console.log("[GiftRequest] skipped: not a product page");
      return;
    }

    var productId = extractProductId();
    if (!productId) {
      console.log("[GiftRequest] no product id yet, retrying in 1.2s");
      setTimeout(function () {
        if (!extractProductId()) return;
        initGiftRequest();
      }, 1200);
      return;
    }
    console.log("[GiftRequest] productId:", productId);

    var url = API_BASE + "/api/gift-request/public-config?key=" +
      encodeURIComponent(API_KEY) + "&page_type=" + encodeURIComponent(pageType);

    fetch(url, { credentials: "omit" })
      .then(function (r) {
        console.log("[GiftRequest] /public-config status:", r.status);
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        console.log("[GiftRequest] config response:", data);
        if (!data || !data.gift_request) {
          console.warn(
            "[GiftRequest] not rendering. reason:",
            (data && data.reason) || "config null or disabled"
          );
          return;
        }
        renderGiftRequest(data.gift_request, productId);
      })
      .catch(function (err) {
        console.error("[GiftRequest] fetch error:", err);
      });
  }

  var GR_ICONS = {
    gift: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:8px"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:8px"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>',
    sparkles: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:8px"><path d="M12 3l1.9 5.7L19.6 10.6 13.9 12.5 12 18.2l-1.9-5.7L4.4 10.6 10.1 8.7z"/><path d="M19 3v4"/><path d="M21 5h-4"/></svg>'
  };

  function findGiftRequestAnchor(anchorSelector) {
    // 1. Custom selector from config takes precedence (mantém after)
    if (anchorSelector) {
      var custom = document.querySelector(anchorSelector);
      if (custom) return { ref: custom, mode: "after" };
    }

    // 2. Posiciona ANTES do CTA de compra — o botão fica logo acima do
    //    "Comprar", mais visível e perto do preço, sem empurrar o CTA pra
    //    baixo da dobra. Lista expandida cobre vários temas VNDA.
    var ctaSelectors = [
      ".product-form .buy-button",
      ".buy-button-container",
      "#buy-button",
      ".buy-button",
      ".btn-buy",
      "button.buy-btn",
      ".btn-add-to-cart",
      ".add-to-cart",
      ".add-to-cart-button",
      ".product-buy",
      ".product-buy-area",
      ".product-actions",
      "[data-cart-add]",
      "[data-product-buy]",
      "button[type=submit][data-buy]",
      "form.product-form .submit",
      "form.product-form button[type=submit]"
    ];
    for (var i = 0; i < ctaSelectors.length; i++) {
      var el = document.querySelector(ctaSelectors[i]);
      if (el) return { ref: el, mode: "before" };
    }

    // 3. Tenta cair perto do preço (estratégia de fallback usada por
    //    promo-tags). findPriceAnchor existe no escopo do shelves.js.
    try {
      if (typeof findPriceAnchor === "function") {
        var price = findPriceAnchor();
        if (price) return { ref: price, mode: "after" };
      }
    } catch (e) {}

    // 4. Se promo-tags renderizou a linha custom, cai depois dela
    var promoRow = document.getElementById("vtx-promo-tag-row");
    if (promoRow) return { ref: promoRow, mode: "after" };

    // 5. Última cartada: append no container principal do produto
    var section = document.querySelector(
      ".product-section, .main-product, .main-product-container, #product-form, main"
    );
    if (section) return { ref: section, mode: "append" };
    return null;
  }

  function extractCurrentProductMeta() {
    var name = "";
    var image = "";
    var price = null;
    var url = window.location.href;

    var nameEl = document.querySelector('meta[property="og:title"]') ||
      document.querySelector('meta[name="title"]');
    if (nameEl) name = nameEl.getAttribute("content") || "";
    if (!name) {
      var h1 = document.querySelector(".product-section h1, .main-product h1, h1.product-title, h1");
      if (h1) name = (h1.textContent || "").trim();
    }

    var imgEl = document.querySelector('meta[property="og:image"]');
    if (imgEl) image = imgEl.getAttribute("content") || "";
    if (!image) {
      var img = document.querySelector(".product-section img, .main-product img, .product-image img");
      if (img) image = img.getAttribute("src") || "";
    }

    // Tenta múltiplas formas — meta tag estruturada, depois texto visível
    var priceMeta = document.querySelector('meta[property="product:price:amount"]') ||
      document.querySelector('meta[property="og:price:amount"]');
    if (priceMeta) {
      var p = parseFloat(priceMeta.getAttribute("content") || "");
      if (!isNaN(p) && p > 0) price = p;
    }
    if (price === null) {
      // parseBRL existe no escopo do shelves.js (definido pelo gift-bar)
      try {
        var priceEl = document.querySelector(".product-price .sale, .product-price .price, .product-section .price, [data-product-price]");
        if (priceEl) {
          var v = parseBRL(priceEl.textContent || priceEl.getAttribute("data-product-price") || "");
          if (v > 0) price = v;
        }
      } catch (e) {}
    }

    return { name: name, image: image, price: price, url: url };
  }

  function renderGiftRequest(cfg, productId) {
    if (document.getElementById("vtx-gift-request-button")) {
      console.log("[GiftRequest] button already rendered, skipping");
      return;
    }

    var anchor = findGiftRequestAnchor(cfg.pdp_anchor_selector);
    if (!anchor) {
      console.warn(
        "[GiftRequest] no anchor found on PDP. Tried:",
        cfg.pdp_anchor_selector || "(default CTAs)",
        "— retrying in 800ms"
      );
      setTimeout(function () { renderGiftRequest(cfg, productId); }, 800);
      return;
    }
    console.log("[GiftRequest] anchor found:", anchor.ref.tagName + "." + anchor.ref.className, "mode:", anchor.mode);

    injectGiftRequestStyles();

    var iconHtml = GR_ICONS[cfg.button_icon] || GR_ICONS.gift;
    var btn = document.createElement("button");
    btn.id = "vtx-gift-request-button";
    btn.type = "button";
    btn.className = "vtx-gr-button";
    btn.setAttribute(
      "style",
      "background:" + cfg.button_bg_color + ";color:" + cfg.button_text_color +
      ";border-radius:" + cfg.button_border_radius + ";"
    );
    btn.innerHTML = iconHtml + "<span>" + escapeHtml(cfg.button_label) + "</span>";

    if (anchor.mode === "before" && anchor.ref.parentNode) {
      anchor.ref.parentNode.insertBefore(btn, anchor.ref);
    } else if (anchor.mode === "after" && anchor.ref.parentNode) {
      anchor.ref.parentNode.insertBefore(btn, anchor.ref.nextSibling);
    } else {
      anchor.ref.appendChild(btn);
    }

    btn.addEventListener("click", function () {
      openGiftRequestModal(cfg, productId);
    });
  }

  function injectGiftRequestStyles() {
    if (document.getElementById("vtx-gr-styles")) return;
    var SYS_FONT = "-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,system-ui,sans-serif";
    var css =
      // Botão na PDP — margem vertical garante respiro de outros elementos (tamanhos, preço, etc)
      ".vtx-gr-button{display:flex;align-items:center;justify-content:center;width:100%;margin:18px 0 20px;padding:14px 20px;font:600 13px " + SYS_FONT + ";letter-spacing:.04em;text-transform:uppercase;border:0;cursor:pointer;transition:transform .15s ease,opacity .15s ease,box-shadow .15s ease;box-shadow:0 1px 2px rgba(0,0,0,.05)}" +
      ".vtx-gr-button:hover{opacity:.92;transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.12)}" +
      // Overlay
      ".vtx-gr-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483640;display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .25s ease;font-family:" + SYS_FONT + ";backdrop-filter:blur(2px)}" +
      ".vtx-gr-overlay.open{opacity:1}" +
      // Modal
      ".vtx-gr-modal{background:#fff;border-radius:18px;width:100%;max-width:460px;padding:36px 32px 32px;box-shadow:0 28px 80px rgba(15,23,42,.22),0 8px 24px rgba(15,23,42,.08);transform:translateY(12px) scale(.985);transition:transform .25s cubic-bezier(.2,.8,.2,1);color:#0f172a;max-height:calc(100vh - 32px);overflow-y:auto}" +
      ".vtx-gr-overlay.open .vtx-gr-modal{transform:translateY(0) scale(1)}" +
      // Tipografia
      ".vtx-gr-modal h3{margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-.01em;color:#0f172a;line-height:1.2}" +
      ".vtx-gr-modal p.vtx-gr-sub{margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.5}" +
      // Product card
      ".vtx-gr-product{display:flex;align-items:center;gap:14px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px}" +
      ".vtx-gr-product img{width:56px;height:56px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#eef2f7}" +
      ".vtx-gr-product .name{font-size:14px;font-weight:600;color:#0f172a;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}" +
      // Campos
      ".vtx-gr-field{display:block;margin-bottom:18px}" +
      ".vtx-gr-field-label{display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:8px;letter-spacing:.01em}" +
      ".vtx-gr-field input,.vtx-gr-field textarea{width:100%;box-sizing:border-box;padding:13px 14px;font:15px " + SYS_FONT + ";border:1.5px solid #e2e8f0;border-radius:10px;background:#fff;color:#0f172a;transition:border-color .15s ease,box-shadow .15s ease;-webkit-appearance:none;appearance:none}" +
      ".vtx-gr-field textarea{min-height:84px;resize:vertical;line-height:1.5}" +
      ".vtx-gr-field input::placeholder,.vtx-gr-field textarea::placeholder{color:#94a3b8}" +
      ".vtx-gr-field input:focus,.vtx-gr-field textarea:focus{outline:none;border-color:#0f172a;box-shadow:0 0 0 4px rgba(15,23,42,.08)}" +
      // CTA
      ".vtx-gr-cta{display:block;width:100%;margin-top:8px;padding:15px 20px;font:600 15px " + SYS_FONT + ";background:#0f172a;color:#fff;border:0;border-radius:12px;cursor:pointer;letter-spacing:-.01em;transition:transform .15s ease,opacity .15s ease,box-shadow .15s ease}" +
      ".vtx-gr-cta:disabled{opacity:.5;cursor:default}" +
      ".vtx-gr-cta:hover:not(:disabled){opacity:.92;transform:translateY(-1px);box-shadow:0 6px 20px rgba(15,23,42,.2)}" +
      // Botão fechar
      ".vtx-gr-close{position:absolute;top:16px;right:16px;background:#f1f5f9;border:0;width:32px;height:32px;border-radius:50%;font-size:20px;color:#64748b;cursor:pointer;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;transition:background .15s ease,color .15s ease}" +
      ".vtx-gr-close:hover{background:#e2e8f0;color:#0f172a}" +
      // Erro — monocromático, slate em vez de vermelho
      ".vtx-gr-error{margin:0 0 16px;padding:12px 14px;background:#f1f5f9;color:#0f172a;border-radius:10px;font-size:13px;line-height:1.45;border-left:3px solid #0f172a}" +
      // Sucesso — sem cor, ícone SVG preto traço fino
      ".vtx-gr-success{text-align:center;padding:8px 4px 4px}" +
      ".vtx-gr-success-icon{display:inline-flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:50%;background:#f1f5f9;color:#0f172a;margin-bottom:18px}" +
      ".vtx-gr-success-icon svg{width:36px;height:36px}" +
      ".vtx-gr-success h3{font-size:22px;margin-bottom:10px;color:#0f172a}" +
      ".vtx-gr-success p{margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.55}" +
      // Mobile
      "@media (max-width:480px){" +
        ".vtx-gr-button{margin:22px 0 24px}" +
        ".vtx-gr-modal{padding:28px 22px 24px;border-radius:16px;max-height:calc(100vh - 16px)}" +
        ".vtx-gr-modal h3{font-size:20px}" +
        ".vtx-gr-overlay{padding:8px;align-items:flex-end}" +
        ".vtx-gr-modal{max-width:100%}" +
      "}";
    var style = document.createElement("style");
    style.id = "vtx-gr-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function openGiftRequestModal(cfg, productId) {
    var existing = document.getElementById("vtx-gr-overlay");
    if (existing) existing.remove();

    var meta = extractCurrentProductMeta();

    var overlay = document.createElement("div");
    overlay.id = "vtx-gr-overlay";
    overlay.className = "vtx-gr-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    var productCard = "";
    if (meta.name) {
      productCard =
        '<div class="vtx-gr-product">' +
          (meta.image ? '<img src="' + escapeHtml(cleanUrl(meta.image)) + '" alt="">' : '') +
          '<div class="name">' + escapeHtml(meta.name) + '</div>' +
        '</div>';
    }

    // requester_phone agora é SEMPRE obrigatório — sem isso a loja não tem
    // como avisar o solicitante quando a pessoa abre o link.
    //
    // O campo "mensagem opcional" SÓ aparece se o template aceita
    // {{personal_message}} no mapping — senão o user escreve algo que não
    // vai ser enviado (frustração).
    var personalMessageField = cfg.accepts_personal_message
      ? '<label class="vtx-gr-field">' +
          '<span class="vtx-gr-field-label">' + escapeHtml(cfg.modal_message_label) + '</span>' +
          '<textarea name="personal_message" maxlength="500" placeholder="Ex.: Tá na minha listinha 😉"></textarea>' +
        '</label>'
      : "";

    overlay.innerHTML =
      '<div class="vtx-gr-modal" style="position:relative">' +
        '<button type="button" class="vtx-gr-close" aria-label="Fechar">&times;</button>' +
        '<h3>' + escapeHtml(cfg.modal_title) + '</h3>' +
        '<p class="vtx-gr-sub">' + escapeHtml(cfg.modal_subtitle) + '</p>' +
        productCard +
        '<div class="vtx-gr-error" style="display:none"></div>' +
        '<form class="vtx-gr-form" novalidate>' +
          '<label class="vtx-gr-field">' +
            '<span class="vtx-gr-field-label">' + escapeHtml(cfg.modal_name_label) + '</span>' +
            '<input type="text" name="requester_name" required autocomplete="name" autocapitalize="words" />' +
          '</label>' +
          '<label class="vtx-gr-field">' +
            '<span class="vtx-gr-field-label">Seu WhatsApp</span>' +
            '<input type="tel" inputmode="tel" name="requester_phone" required placeholder="(11) 99999-8888" autocomplete="tel" />' +
          '</label>' +
          '<label class="vtx-gr-field">' +
            '<span class="vtx-gr-field-label">' + escapeHtml(cfg.modal_phone_label) + '</span>' +
            '<input type="tel" inputmode="tel" name="recipient_phone" required placeholder="(11) 99999-8888" />' +
          '</label>' +
          personalMessageField +
          '<button type="submit" class="vtx-gr-cta">' + escapeHtml(cfg.modal_cta_label) + '</button>' +
        '</form>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add("open"); });
    document.body.style.overflow = "hidden";

    // Máscara BR de telefone: aplica nos dois campos de phone do modal.
    // Formato (DD) 99999-9999 ou (DD) 9999-9999 quando não tem o 9 inicial.
    function maskBRPhone(raw) {
      var d = (raw || "").replace(/\D/g, "").slice(0, 11);
      if (d.length === 0) return "";
      if (d.length <= 2) return "(" + d;
      if (d.length <= 6) return "(" + d.substring(0, 2) + ") " + d.substring(2);
      if (d.length <= 10)
        return "(" + d.substring(0, 2) + ") " + d.substring(2, 6) + "-" + d.substring(6);
      return "(" + d.substring(0, 2) + ") " + d.substring(2, 7) + "-" + d.substring(7, 11);
    }
    function attachPhoneMask(input) {
      if (!input) return;
      input.addEventListener("input", function () {
        var prevLen = input.value.length;
        var caret = input.selectionStart;
        var masked = maskBRPhone(input.value);
        input.value = masked;
        // tenta manter o cursor numa posição razoável
        if (caret != null && document.activeElement === input) {
          var delta = masked.length - prevLen;
          var newPos = Math.max(0, caret + delta);
          try { input.setSelectionRange(newPos, newPos); } catch (e) {}
        }
      });
      // formata também se vier algo pré-preenchido (autofill)
      if (input.value) input.value = maskBRPhone(input.value);
    }
    attachPhoneMask(overlay.querySelector('input[name="requester_phone"]'));
    attachPhoneMask(overlay.querySelector('input[name="recipient_phone"]'));

    function close() {
      overlay.classList.remove("open");
      document.body.style.overflow = "";
      setTimeout(function () { overlay.remove(); }, 200);
    }

    overlay.querySelector(".vtx-gr-close").addEventListener("click", close);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", function escHandler(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
    });

    var form = overlay.querySelector(".vtx-gr-form");
    var errorEl = overlay.querySelector(".vtx-gr-error");
    var cta = overlay.querySelector(".vtx-gr-cta");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errorEl.style.display = "none";

      var requesterName = (form.requester_name.value || "").trim();
      var requesterPhone = (form.requester_phone.value || "").trim();
      var recipientPhone = (form.recipient_phone.value || "").trim();
      var personalMessage = form.personal_message
        ? (form.personal_message.value || "").trim()
        : "";

      if (!requesterName) {
        errorEl.textContent = "Preencha seu nome.";
        errorEl.style.display = "block";
        return;
      }
      if (!requesterPhone || requesterPhone.replace(/\D/g, "").length < 10) {
        errorEl.textContent = "Informe seu WhatsApp com DDD.";
        errorEl.style.display = "block";
        return;
      }
      if (!recipientPhone || recipientPhone.replace(/\D/g, "").length < 10) {
        errorEl.textContent = "Informe o WhatsApp de quem vai presentear, com DDD.";
        errorEl.style.display = "block";
        return;
      }
      if (recipientPhone.replace(/\D/g, "") === requesterPhone.replace(/\D/g, "")) {
        errorEl.textContent = "Os WhatsApps devem ser diferentes.";
        errorEl.style.display = "block";
        return;
      }

      cta.disabled = true;
      cta.textContent = "Enviando…";

      var payload = {
        key: API_KEY,
        requester_name: requesterName,
        requester_phone: requesterPhone,
        recipient_phone: recipientPhone,
        product_id: productId,
        product_name: meta.name,
        product_url: meta.url,
        product_image_url: meta.image,
        product_price: meta.price,
        personal_message: personalMessage,
        page_url: window.location.href,
        session_id: sessionId,
        consumer_id: consumerId
      };

      fetch(API_BASE + "/api/gift-request/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "omit"
      })
        .then(function (r) {
          return r.json().then(function (j) { return { ok: r.ok, body: j }; });
        })
        .then(function (res) {
          if (!res.ok) {
            var msg = "Não foi possível enviar. Tente novamente.";
            if (res.body && res.body.error === "rate_limited_ip") {
              msg = "Muitos pedidos a partir desse dispositivo. Tente mais tarde.";
            } else if (res.body && res.body.error === "rate_limited_recipient") {
              msg = "Essa pessoa já recebeu vários pedidos hoje. Tente amanhã.";
            } else if (res.body && res.body.error === "recipient_phone invalid") {
              msg = "WhatsApp inválido. Use o formato (11) 99999-8888.";
            }
            errorEl.textContent = msg;
            errorEl.style.display = "block";
            cta.disabled = false;
            cta.textContent = cfg.modal_cta_label;
            return;
          }

          // Sucesso — substitui o conteúdo do modal. Ícone SVG (presente)
          // monocromático em vez do emoji 🎁.
          var giftSvg =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<rect x="3" y="8" width="18" height="4" rx="1"/>' +
              '<path d="M12 8v13"/>' +
              '<path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/>' +
              '<path d="M7.5 8a2.5 2.5 0 0 1 0-5 4.8 8 0 0 1 4.5 5 4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>' +
            '</svg>';
          var modal = overlay.querySelector(".vtx-gr-modal");
          modal.innerHTML =
            '<button type="button" class="vtx-gr-close" aria-label="Fechar">&times;</button>' +
            '<div class="vtx-gr-success">' +
              '<div class="vtx-gr-success-icon">' + giftSvg + '</div>' +
              '<h3>' + escapeHtml(cfg.modal_success_title) + '</h3>' +
              '<p>' + escapeHtml(cfg.modal_success_message) + '</p>' +
              '<button type="button" class="vtx-gr-cta" data-close>Fechar</button>' +
            '</div>';
          modal.querySelector(".vtx-gr-close").addEventListener("click", close);
          modal.querySelector("[data-close]").addEventListener("click", close);

          // GA4 event
          try {
            if (window.dataLayer) {
              window.dataLayer.push({
                event: "gift_request_submitted",
                product_id: productId,
                product_name: meta.name
              });
            }
          } catch (e) {}
        })
        .catch(function () {
          errorEl.textContent = "Não foi possível enviar agora. Verifique sua conexão.";
          errorEl.style.display = "block";
          cta.disabled = false;
          cta.textContent = cfg.modal_cta_label;
        });
    });
  }

  // ============================================================
  // --- Reviews (Avaliações de Clientes) ---
  // Plataforma própria de avaliações: substitui a Yourviews. Renderiza o
  // bloco de avaliações na página de produto, lendo /api/reviews/product
  // (público, validado por shelf_api_keys). Design clean e moderno.
  // ============================================================

  var VTX_RV_STAR =
    "M12 2.2l2.95 5.98 6.6.96-4.78 4.66 1.13 6.57L12 17.27 6.1 20.37l1.13-6.57L2.45 9.14l6.6-.96z";

  function rvStars(rating, color, size) {
    var s = size || 16;
    var full = Math.round(Number(rating) || 0);
    var out = "";
    for (var i = 1; i <= 5; i++) {
      var fill = i <= full ? color : "#e2e2e2";
      out +=
        '<svg class="vtx-rv-star" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path fill="' + fill + '" d="' + VTX_RV_STAR + '"/></svg>';
    }
    return out;
  }

  function rvDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var dd = String(d.getDate()).padStart(2, "0");
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    return dd + "/" + mm + "/" + d.getFullYear();
  }

  function rvInjectStyles(accent) {
    if (document.getElementById("vtx-rv-styles")) return;
    var st = document.createElement("style");
    st.id = "vtx-rv-styles";
    st.textContent =
      "#vtx-reviews{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a;max-width:1200px;margin:48px auto;padding:0 16px;box-sizing:border-box}" +
      "#vtx-reviews *{box-sizing:border-box}" +
      ".vtx-rv-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}" +
      ".vtx-rv-title{font-size:26px;font-weight:700;margin:0 0 10px;letter-spacing:-.01em}" +
      ".vtx-rv-summary{display:flex;align-items:center;gap:14px;flex-wrap:wrap}" +
      ".vtx-rv-avg{font-size:30px;font-weight:700;line-height:1}" +
      ".vtx-rv-avg-stars{display:inline-flex;gap:1px;vertical-align:middle}" +
      ".vtx-rv-count{font-size:14px;color:#6b7280}" +
      ".vtx-rv-cta{border:1px solid #111;background:#fff;color:#111;border-radius:999px;padding:12px 22px;font-size:15px;font-weight:600;cursor:pointer;transition:all .15s ease;white-space:nowrap}" +
      ".vtx-rv-cta:hover{background:#111;color:#fff}" +
      ".vtx-rv-topics{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0 4px}" +
      ".vtx-rv-topic{background:#f1f1f2;border-radius:999px;padding:7px 15px;font-size:13.5px;color:#333}" +
      ".vtx-rv-gallery-wrap{margin:22px 0 6px}" +
      ".vtx-rv-gallery-title{font-size:14px;font-weight:600;color:#374151;margin:0 0 10px}" +
      ".vtx-rv-gallery{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;scrollbar-width:thin;-webkit-overflow-scrolling:touch}" +
      ".vtx-rv-gallery::-webkit-scrollbar{height:6px}" +
      ".vtx-rv-gallery::-webkit-scrollbar-thumb{background:#d4d4d8;border-radius:999px}" +
      ".vtx-rv-gthumb{position:relative;flex:0 0 auto;width:92px;height:92px;border-radius:12px;overflow:hidden;cursor:pointer;border:1px solid #eee;background:#f3f3f3}" +
      ".vtx-rv-gthumb img,.vtx-rv-gthumb video{width:100%;height:100%;object-fit:cover;display:block}" +
      ".vtx-rv-gthumb .vtx-rv-gplay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;text-shadow:0 1px 4px rgba(0,0,0,.5)}" +
      ".vtx-rv-gmore{position:absolute;inset:0;background:rgba(0,0,0,.55);color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600}" +
      ".vtx-rv-toolbar{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #ececec;margin-top:18px;padding-bottom:0}" +
      ".vtx-rv-tab{font-size:15px;font-weight:600;padding:12px 2px;border-bottom:2px solid #111;margin-bottom:-1px}" +
      ".vtx-rv-sort{position:relative}" +
      ".vtx-rv-sort select{appearance:none;-webkit-appearance:none;border:1px solid #d6d6d6;border-radius:10px;background:#fff;padding:9px 34px 9px 14px;font-size:14px;font-weight:500;cursor:pointer;color:#111}" +
      ".vtx-rv-sort:after{content:'';position:absolute;right:13px;top:50%;width:8px;height:8px;border-right:2px solid #555;border-bottom:2px solid #555;transform:translateY(-65%) rotate(45deg);pointer-events:none}" +
      ".vtx-rv-list{margin-top:8px}" +
      ".vtx-rv-item{padding:26px 0;border-bottom:1px solid #ececec}" +
      ".vtx-rv-item-stars{display:flex;gap:1px;margin-bottom:12px}" +
      ".vtx-rv-author{display:flex;align-items:center;gap:9px;flex-wrap:wrap}" +
      ".vtx-rv-author-name{font-weight:700;font-size:15px}" +
      ".vtx-rv-verified{display:inline-flex;align-items:center;gap:4px;border:1px solid #cfcfcf;border-radius:999px;padding:2px 10px;font-size:12px;color:#333}" +
      ".vtx-rv-date{color:#9ca3af;font-size:13px;margin-top:3px}" +
      ".vtx-rv-item-title{font-size:18px;font-weight:700;margin:14px 0 7px}" +
      ".vtx-rv-body{font-size:15px;line-height:1.55;color:#1f2937;white-space:pre-line}" +
      ".vtx-rv-media{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}" +
      ".vtx-rv-media img{width:74px;height:74px;object-fit:cover;border-radius:10px;cursor:pointer;border:1px solid #eee}" +
      ".vtx-rv-fields{margin-top:16px;display:grid;grid-template-columns:1fr;gap:8px;max-width:520px}" +
      ".vtx-rv-field{font-size:14px;color:#6b7280}" +
      ".vtx-rv-field b{color:#111;font-weight:600;margin-left:6px}" +
      ".vtx-rv-reply{margin-top:14px;background:#f7f7f8;border-radius:12px;padding:13px 16px}" +
      ".vtx-rv-reply-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin-bottom:4px}" +
      ".vtx-rv-reply-body{font-size:14px;color:#374151;line-height:1.5}" +
      ".vtx-rv-more{display:block;margin:28px auto 0;border:1px solid #d6d6d6;background:#fff;border-radius:999px;padding:12px 28px;font-size:15px;font-weight:600;cursor:pointer;color:#111}" +
      ".vtx-rv-more:hover{background:#f5f5f5}" +
      ".vtx-rv-empty{padding:40px 0;text-align:center;color:#9ca3af;font-size:15px}" +
      ".vtx-rv-lightbox{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:2147483640;display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out}" +
      ".vtx-rv-lightbox img,.vtx-rv-lightbox video{max-width:92vw;max-height:88vh;border-radius:8px}" +
      // modal de escrita
      ".vtx-rv-modal{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483641;display:flex;align-items:center;justify-content:center;padding:16px}" +
      ".vtx-rv-modal-box{background:#fff;border-radius:18px;max-width:480px;width:100%;max-height:92vh;overflow:auto;padding:28px}" +
      ".vtx-rv-modal-box h3{margin:0 0 4px;font-size:20px;font-weight:700}" +
      ".vtx-rv-modal-box p.sub{margin:0 0 18px;font-size:14px;color:#6b7280}" +
      ".vtx-rv-modal-box label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}" +
      ".vtx-rv-modal-box input,.vtx-rv-modal-box textarea{width:100%;border:1px solid #d6d6d6;border-radius:10px;padding:11px 13px;font-size:15px;font-family:inherit}" +
      ".vtx-rv-modal-box textarea{min-height:96px;resize:vertical}" +
      ".vtx-rv-rate{display:flex;gap:4px}" +
      ".vtx-rv-rate svg{cursor:pointer}" +
      ".vtx-rv-submit{width:100%;margin-top:20px;background:#111;color:#fff;border:none;border-radius:999px;padding:14px;font-size:15px;font-weight:600;cursor:pointer}" +
      ".vtx-rv-submit:disabled{opacity:.5;cursor:default}" +
      ".vtx-rv-modal-close{float:right;border:none;background:none;font-size:24px;line-height:1;cursor:pointer;color:#9ca3af}" +
      ".vtx-rv-msg{margin-top:12px;font-size:14px;text-align:center}" +
      // Resumo em destaque abaixo do nome do produto
      ".vtx-rv-titlerate{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:10px 0 6px;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}" +
      ".vtx-rv-tr-avg{font-weight:700;font-size:19px;color:#0a0a0a;line-height:1}" +
      ".vtx-rv-tr-stars{display:inline-flex;gap:2px}" +
      ".vtx-rv-tr-count{font-size:14.5px;color:#6b7280;text-decoration:underline;text-underline-offset:2px}" +
      // Carrossel compacto perto do comprar (clean/minimalista)
      "#vtx-rv-compact{display:block;width:100%;box-sizing:border-box;clear:both;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:14px 0;padding:13px 0;border-top:1px solid #ececec;border-bottom:1px solid #ececec}" +
      ".vtx-rv-c-head{display:flex;align-items:center;gap:8px;width:100%;background:none;border:none;padding:0;cursor:pointer;color:#0a0a0a;font-family:inherit}" +
      ".vtx-rv-c-avg{font-weight:700;font-size:15px}" +
      ".vtx-rv-c-hstars{display:inline-flex;gap:1px}" +
      ".vtx-rv-c-count{font-size:13px;color:#6b7280;text-decoration:underline;text-underline-offset:2px}" +
      ".vtx-rv-c-arrow{margin-left:auto;color:#9ca3af;font-size:20px;line-height:1}" +
      ".vtx-rv-c-track{position:relative;margin-top:9px;min-height:60px}" +
      ".vtx-rv-c-slide{position:absolute;left:0;right:0;top:0;opacity:0;transition:opacity .5s ease;pointer-events:none}" +
      ".vtx-rv-c-slide.vtx-rv-c-active{opacity:1;pointer-events:auto;position:relative}" +
      ".vtx-rv-c-stars{margin-bottom:4px;display:flex;gap:1px}" +
      ".vtx-rv-c-text{font-size:13.5px;color:#374151;line-height:1.45;margin:0 0 4px}" +
      ".vtx-rv-c-author{font-size:12.5px;color:#6b7280;margin:0;font-weight:600}" +
      "@media(max-width:640px){.vtx-rv-title{font-size:22px}.vtx-rv-avg{font-size:26px}#vtx-reviews{margin:32px auto}}";
    document.head.appendChild(st);
  }

  function rvFindAnchor(settings) {
    var sel = settings && settings.anchor_selector;
    if (sel) {
      var el = document.querySelector(sel);
      if (el) return el;
    }
    // Reaproveita o ponto onde ficava a Yourviews.
    var legacy = document.querySelector("#yv-reviews, .yv-reviews, .product-reviews, [data-reviews]");
    if (legacy) {
      legacy.innerHTML = "";
      return legacy;
    }
    var host = document.createElement("div");
    // Avaliações devem ficar ACIMA das prateleiras: se já existe uma prateleira,
    // insere antes dela; senão antes do footer. (rvEnsureAboveShelves corrige
    // prateleiras que aparecem depois, por causa do fetch assíncrono.)
    var shelf = document.querySelector(".vtx-shelf-container, .vtx-shelf");
    if (shelf && shelf.parentNode) {
      shelf.parentNode.insertBefore(host, shelf);
      return host;
    }
    var foot = document.querySelector("footer, .footer");
    if (foot && foot.parentNode) {
      foot.parentNode.insertBefore(host, foot);
    } else {
      document.body.appendChild(host);
    }
    return host;
  }

  // Mantém o bloco de avaliações ACIMA das prateleiras mesmo que elas só
  // apareçam depois (a config das prateleiras é buscada de forma assíncrona).
  function rvEnsureAboveShelves(mount) {
    function reorder() {
      var shelf = document.querySelector(".vtx-shelf-container, .vtx-shelf");
      if (!shelf || !shelf.parentNode || !mount) return;
      var shelfBeforeMount = mount.compareDocumentPosition(shelf) & Node.DOCUMENT_POSITION_PRECEDING;
      if (mount.parentNode !== shelf.parentNode || shelfBeforeMount) {
        try { shelf.parentNode.insertBefore(mount, shelf); } catch (e) { /* noop */ }
      }
    }
    reorder();
    setTimeout(reorder, 800);
    setTimeout(reorder, 2200);
    setTimeout(reorder, 4500);
  }

  // Âncora "perto do botão comprar" pro carrossel compacto.
  function rvFindBuyAnchor() {
    var promo = document.getElementById("vtx-promo-tag-row");
    if (promo) return promo;
    var sels = [".buy-button-container", ".product-buy", ".product-form", "[data-product-buy]",
      "form[data-product-form]", ".product__buy", ".product-purchase", ".add-to-cart-button",
      ".add-to-cart", ".actions-wrapper", ".product-info", ".product__details"];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el) return el;
    }
    return null;
  }

  function rvScrollToReviews() {
    var t = document.getElementById("vtx-reviews");
    if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Acha o título/nome do produto na PDP.
  function rvFindTitleAnchor() {
    var sels = [".product-section h1", ".main-product h1", ".main-product-container h1",
      ".product-info h1", ".product-name", ".product-title", ".product__name", ".product__title",
      "[data-product-name]", "h1.product", "h1.name", "h1"];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el) return el;
    }
    return null;
  }

  // Resumo em destaque logo abaixo do nome do produto (clicável → rola pras
  // avaliações).
  function rvRenderTitleRating(data, color) {
    if (!data || !data.summary || !data.summary.count) return;
    if (document.getElementById("vtx-rv-titlerate")) return;
    var title = rvFindTitleAnchor();
    if (!title || !title.parentNode) return;
    var el = document.createElement("div");
    el.id = "vtx-rv-titlerate";
    el.className = "vtx-rv-titlerate";
    el.innerHTML =
      '<span class="vtx-rv-tr-avg">' + data.summary.average.toFixed(1).replace(".", ",") + "</span>" +
      '<span class="vtx-rv-tr-stars">' + rvStars(data.summary.average, color, 20) + "</span>" +
      '<span class="vtx-rv-tr-count">(' + data.summary.count + " avaliações)</span>";
    title.parentNode.insertBefore(el, title.nextSibling);
    el.addEventListener("click", rvScrollToReviews);
  }

  // Slot full-width na coluna do produto pro carrossel — NUNCA dentro da linha
  // flex do botão comprar (senão vira "irmão" do botão e quebra o layout).
  // Prioriza a linha de promoções (#vtx-promo-tag-row), que já é um bloco na
  // coluna; senão sobe a partir do comprar até um pai que não seja flex/grid.
  function rvCompactSlot() {
    var row = document.getElementById("vtx-promo-tag-row");
    if (row && row.parentNode) return row;
    if (typeof getOrCreatePromoTagRow === "function") {
      var r = getOrCreatePromoTagRow();
      if (r && r.parentNode) return r;
    }
    var start = rvFindBuyAnchor();
    if (!start) return null;
    var node = start;
    for (var k = 0; k < 8; k++) {
      var parent = node.parentNode;
      if (!parent || parent === document.body) break;
      var s = window.getComputedStyle ? window.getComputedStyle(parent) : null;
      var d = s ? s.display : "";
      if (d === "flex" || d === "inline-flex" || d === "grid" || d === "inline-grid") { node = parent; continue; }
      break; // parent é bloco: 'node' é o ponto seguro pra inserir depois
    }
    return node;
  }

  // Carrossel compacto e minimalista perto do comprar: resumo (clicável → rola
  // pras avaliações) + snippets girando.
  function rvRenderCompact(data, color) {
    if (!data || !data.summary || !data.summary.count) return;
    if (document.getElementById("vtx-rv-compact")) return;
    var slot = rvCompactSlot();
    if (!slot || !slot.parentNode) return;

    var snippets = (data.reviews || []).filter(function (r) { return r.body || r.title; }).slice(0, 8);
    if (!snippets.length) return; // sem depoimentos com texto: não renderiza
    var slidesHtml = snippets.map(function (r) {
      var txt = String(r.body || r.title || "").trim();
      if (txt.length > 130) txt = txt.slice(0, 127) + "…";
      return '<div class="vtx-rv-c-slide">' +
          '<div class="vtx-rv-c-stars">' + rvStars(r.rating, color, 13) + "</div>" +
          '<p class="vtx-rv-c-text">“' + escapeHtml(txt) + '”</p>' +
          '<p class="vtx-rv-c-author">— ' + escapeHtml(r.author) + (r.verified ? " ✓" : "") + "</p>" +
        "</div>";
    }).join("");

    var box = document.createElement("div");
    box.id = "vtx-rv-compact";
    box.className = "vtx-rv-compact";
    // Só os depoimentos girando — a nota+estrelas+qtd já aparece abaixo do nome
    // do produto (rvRenderTitleRating), então não duplicamos aqui.
    box.innerHTML = '<div class="vtx-rv-c-track">' + slidesHtml + "</div>";

    slot.parentNode.insertBefore(box, slot.nextSibling);
    // Clicar no strip leva pras avaliações completas.
    box.addEventListener("click", rvScrollToReviews);

    var slides = box.querySelectorAll(".vtx-rv-c-slide");
    if (slides.length) {
      slides[0].classList.add("vtx-rv-c-active");
      if (slides.length > 1) {
        var idx = 0;
        setInterval(function () {
          slides[idx].classList.remove("vtx-rv-c-active");
          idx = (idx + 1) % slides.length;
          slides[idx].classList.add("vtx-rv-c-active");
        }, 4500);
      }
    }
  }

  function rvRenderItem(r, settings) {
    var color = settings.star_color || settings.accent_color || "#e6b800";
    var fields = "";
    if (settings.show_custom_fields && r.custom_fields && r.custom_fields.length) {
      fields = '<div class="vtx-rv-fields">' +
        r.custom_fields.map(function (f) {
          var vals = (f.values || []).join(", ");
          return '<div class="vtx-rv-field">' + escapeHtml(f.name) + "<b>" + escapeHtml(vals) + "</b></div>";
        }).join("") +
        "</div>";
    }
    var media = "";
    if (r.media && r.media.length) {
      media = '<div class="vtx-rv-media">' +
        r.media.map(function (m) {
          return '<img loading="lazy" src="' + safeUrl(m.url) + '" data-vtx-rv-media="' + safeUrl(m.url) + '" data-vtx-rv-type="' + escapeHtml(m.type || "image") + '" alt="">';
        }).join("") +
        "</div>";
    }
    var verified = (settings.show_verified_badge && r.verified)
      ? '<span class="vtx-rv-verified">✓ Verificado</span>'
      : "";
    var reply = r.reply
      ? '<div class="vtx-rv-reply"><div class="vtx-rv-reply-label">Resposta da loja</div><div class="vtx-rv-reply-body">' + escapeHtml(r.reply.body) + "</div></div>"
      : "";
    return (
      '<div class="vtx-rv-item">' +
        '<div class="vtx-rv-item-stars">' + rvStars(r.rating, color, 16) + "</div>" +
        '<div class="vtx-rv-author"><span class="vtx-rv-author-name">' + escapeHtml(r.author) + "</span>" + verified + "</div>" +
        '<div class="vtx-rv-date">' + rvDate(r.date) + "</div>" +
        (r.title ? '<div class="vtx-rv-item-title">' + escapeHtml(r.title) + "</div>" : "") +
        (r.body ? '<div class="vtx-rv-body">' + escapeHtml(r.body) + "</div>" : "") +
        media +
        fields +
        reply +
      "</div>"
    );
  }

  // Galeria de fotos de TODOS os clientes, no topo dos reviews (strip rolável).
  function rvGalleryHtml(gallery, total) {
    if (!gallery || !gallery.length) return "";
    var thumbs = gallery.map(function (g) {
      var inner = g.type === "video"
        ? '<video src="' + safeUrl(g.url) + '" muted preload="metadata"></video><span class="vtx-rv-gplay">▶</span>'
        : '<img loading="lazy" src="' + safeUrl(g.url) + '" alt="">';
      return '<div class="vtx-rv-gthumb" data-vtx-rv-media="' + safeUrl(g.url) + '" data-vtx-rv-type="' + escapeHtml(g.type || "image") + '">' + inner + "</div>";
    }).join("");
    var n = total || gallery.length;
    return '<div class="vtx-rv-gallery-wrap"><p class="vtx-rv-gallery-title">Fotos dos clientes (' + n + ')</p><div class="vtx-rv-gallery">' + thumbs + "</div></div>";
  }

  function initReviews() {
    if (!API_KEY || !API_BASE) return;
    if (detectPageType() !== "product") return;
    var productId = extractProductId();
    if (!productId) return;

    var state = { sort: "recent", offset: 0, perPage: 10, total: 0, settings: null, mount: null };

    function load(append) {
      var url =
        API_BASE + "/api/reviews/product?key=" + encodeURIComponent(API_KEY) +
        "&product_id=" + encodeURIComponent(productId) +
        "&sort=" + state.sort +
        "&offset=" + state.offset +
        "&limit=" + state.perPage;
      return fetchJSON(url).then(function (data) {
        if (!data || data.enabled === false) return null;
        return data;
      });
    }

    load(false).then(function (data) {
      if (!data) return;
      var s = data.settings || {};
      state.settings = s;
      state.perPage = s.reviews_per_page || 10;
      state.total = (data.summary && data.summary.count) || 0;
      if (state.total === 0) return; // sem avaliações publicadas: não renderiza nada

      rvInjectStyles(s.accent_color);
      var mount = rvFindAnchor(s);
      mount.id = "vtx-reviews";
      state.mount = mount;
      rvEnsureAboveShelves(mount);

      var color = s.star_color || s.accent_color || "#e6b800";

      // Resumo em destaque logo abaixo do nome do produto.
      rvRenderTitleRating(data, color);
      // Carrossel compacto perto do botão comprar (resumo clicável + snippets).
      rvRenderCompact(data, color);
      var avg = data.summary.average || 0;
      var topics = (data.topics || []).map(function (t) {
        return '<span class="vtx-rv-topic">' + escapeHtml(t) + "</span>";
      }).join("");

      mount.innerHTML =
        '<div class="vtx-rv-head">' +
          "<div>" +
            '<h2 class="vtx-rv-title">Avaliações de Clientes</h2>' +
            '<div class="vtx-rv-summary">' +
              '<span class="vtx-rv-avg">' + avg.toFixed(1).replace(".", ",") + "</span>" +
              '<span class="vtx-rv-avg-stars">' + rvStars(avg, color, 18) + "</span>" +
              '<span class="vtx-rv-count">' + state.total + (state.total === 1 ? " avaliação" : " avaliações") + "</span>" +
            "</div>" +
          "</div>" +
        "</div>" +
        (topics ? '<div class="vtx-rv-topics">' + topics + "</div>" : "") +
        rvGalleryHtml(data.gallery, data.gallery_total) +
        '<div class="vtx-rv-toolbar">' +
          '<div class="vtx-rv-tab">Avaliações (' + state.total + ")</div>" +
          '<div class="vtx-rv-sort"><select id="vtx-rv-sort">' +
            '<option value="recent">Mais recentes</option>' +
            '<option value="helpful">Mais úteis</option>' +
            '<option value="rating_high">Maior nota</option>' +
            '<option value="rating_low">Menor nota</option>' +
          "</select></div>" +
        "</div>" +
        '<div class="vtx-rv-list" id="vtx-rv-list"></div>' +
        '<div id="vtx-rv-more-wrap"></div>';

      var listEl = mount.querySelector("#vtx-rv-list");
      renderInto(listEl, data.reviews, false);
      state.offset = data.reviews.length;
      updateMore(data.has_more);

      mount.querySelector("#vtx-rv-sort").addEventListener("change", function (e) {
        state.sort = e.target.value;
        state.offset = 0;
        load(false).then(function (d) {
          if (!d) return;
          renderInto(listEl, d.reviews, false);
          state.offset = d.reviews.length;
          updateMore(d.has_more);
        });
      });

      // Avaliações só de quem comprou — a coleta acontece pela régua pós-compra
      // (link tokenizado em /avaliar/<token>), não por um botão aberto na PDP.

      // Lightbox para mídia (galeria do topo + foto por review). Usa closest
      // pois na galeria o atributo fica no wrapper (img/video dentro).
      mount.addEventListener("click", function (e) {
        var t = e.target && e.target.closest ? e.target.closest("[data-vtx-rv-media]") : null;
        if (t) openLightbox(t.getAttribute("data-vtx-rv-media"), t.getAttribute("data-vtx-rv-type"));
      });

      function renderInto(el, reviews, append) {
        var html = (reviews || []).map(function (r) { return rvRenderItem(r, s); }).join("");
        if (append) el.insertAdjacentHTML("beforeend", html);
        else el.innerHTML = html || '<div class="vtx-rv-empty">Seja o primeiro a avaliar.</div>';
      }

      function updateMore(hasMore) {
        var wrap = mount.querySelector("#vtx-rv-more-wrap");
        if (!hasMore) { wrap.innerHTML = ""; return; }
        wrap.innerHTML = '<button type="button" class="vtx-rv-more" id="vtx-rv-more">Ver mais avaliações</button>';
        wrap.querySelector("#vtx-rv-more").addEventListener("click", function () {
          load(true).then(function (d) {
            if (!d) return;
            renderInto(listEl, d.reviews, true);
            state.offset += d.reviews.length;
            updateMore(d.has_more);
          });
        });
      }
    }).catch(function (err) {
      console.warn("[Reviews] erro:", err);
    });
  }

  function openLightbox(url, type) {
    var box = document.createElement("div");
    box.className = "vtx-rv-lightbox";
    box.innerHTML = type === "video"
      ? '<video src="' + safeUrl(url) + '" controls autoplay></video>'
      : '<img src="' + safeUrl(url) + '" alt="">';
    box.addEventListener("click", function () { box.remove(); });
    document.body.appendChild(box);
  }

  // ============================================================
  // --- Home: carrossel leve de avaliações positivas da loja ---
  // ============================================================

  function srvCount(n) {
    try { return Number(n || 0).toLocaleString("pt-BR"); }
    catch (e) { return String(n || 0); }
  }

  function srvScore(summary) {
    var raw = summary && Number(summary.positive_rating_average);
    var score = raw && isFinite(raw) ? raw : 4.7;
    return Math.max(4.7, Math.min(score, 5)).toFixed(1);
  }

  function srvInjectStyles() {
    if (document.getElementById("vtx-store-rv-styles")) return;
    var st = document.createElement("style");
    st.id = "vtx-store-rv-styles";
    st.textContent =
      "#vtx-store-reviews-home{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a;max-width:1180px;margin:38px auto 46px;padding:0 16px;box-sizing:border-box}" +
      "#vtx-store-reviews-home *{box-sizing:border-box}" +
      ".vtx-srv-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:12px}" +
      ".vtx-srv-kicker{margin:0 0 4px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:#858585}" +
      ".vtx-srv-title{margin:0;font-size:22px;line-height:1.12;font-weight:900;text-transform:uppercase;color:#0a0a0a}" +
      ".vtx-srv-summary{text-align:right;min-width:150px}" +
      ".vtx-srv-score{display:flex;align-items:center;justify-content:flex-end;gap:7px;font-size:18px;font-weight:900;line-height:1}" +
      ".vtx-srv-stars{display:inline-flex;gap:1px}" +
      ".vtx-srv-count{margin:5px 0 0;font-size:12px;color:#858585;font-weight:600}" +
      ".vtx-srv-shell{position:relative}" +
      ".vtx-srv-track{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:1px 1px 8px}" +
      ".vtx-srv-track::-webkit-scrollbar{display:none}" +
      ".vtx-srv-card{scroll-snap-align:start;flex:0 0 285px;min-height:150px;border:1px solid #ededed;background:#fff;border-radius:6px;padding:15px 16px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:none}" +
      ".vtx-srv-card-stars{display:flex;gap:1px;margin-bottom:8px}" +
      ".vtx-srv-quote{margin:0;color:#2f3337;font-size:13.5px;line-height:1.38;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}" +
      ".vtx-srv-author{margin-top:12px;display:flex;justify-content:space-between;gap:10px;align-items:center;color:#737373;font-size:12px;font-weight:700}" +
      ".vtx-srv-date{font-weight:600;color:#a3a3a3;white-space:nowrap}" +
      ".vtx-srv-nav{display:flex;gap:7px;justify-content:flex-end;margin-top:4px}" +
      ".vtx-srv-btn{width:30px;height:30px;border:1px solid #dedede;background:#fff;color:#111;border-radius:50%;font-size:18px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:none}" +
      ".vtx-srv-btn:hover{background:#111;color:#fff;border-color:#111}" +
      "@media(max-width:760px){" +
        "#vtx-store-reviews-home{margin:30px auto 38px;padding:0 14px}" +
        ".vtx-srv-head{align-items:flex-start;flex-direction:column;gap:8px;margin-bottom:12px}" +
        ".vtx-srv-title{font-size:19px}" +
        ".vtx-srv-summary{text-align:left;min-width:0}" +
        ".vtx-srv-score{justify-content:flex-start}" +
        ".vtx-srv-card{flex-basis:78vw;min-height:146px;padding:14px 15px}" +
      "}";
    document.head.appendChild(st);
  }

  function srvFindHomeAnchor() {
    var explicit = document.querySelector("[data-vtx-store-reviews-home], #vtx-store-reviews-home-anchor");
    if (explicit) return { el: explicit, auto: false };

    var host = document.createElement("div");
    host.id = "vtx-store-reviews-home-anchor";
    host.setAttribute("data-vtx-auto-store-reviews", "true");

    var preferredAnchors = [
      "section.section-icons",
      ".section-icons",
      "section.banners-grid",
      ".banners-grid",
      ".fullbanner",
      ".home-banner"
    ];

    for (var i = 0; i < preferredAnchors.length; i++) {
      var preferred = document.querySelector(preferredAnchors[i]);
      if (preferred && preferred.parentNode) {
        preferred.parentNode.insertBefore(host, preferred.nextSibling);
        return { el: host, auto: false };
      }
    }

    var firstShelf = document.querySelector(".vtx-shelf-container, .vtx-shelf");
    if (firstShelf && firstShelf.parentNode) {
      firstShelf.parentNode.insertBefore(host, firstShelf);
      return { el: host, auto: false };
    }

    var foot = document.querySelector("footer, .footer");
    if (foot && foot.parentNode) foot.parentNode.insertBefore(host, foot);
    else (document.querySelector("main") || document.body).appendChild(host);
    return { el: host, auto: false };
  }

  function srvEnsureBeforeFirstShelf(mount) {
    function reorder() {
      if (!mount || !mount.parentNode) return;
      var firstShelf = document.querySelector(".vtx-shelf-container, .vtx-shelf");
      if (!firstShelf || !firstShelf.parentNode || firstShelf === mount || mount.contains(firstShelf)) return;
      try {
        if (mount.nextSibling !== firstShelf) firstShelf.parentNode.insertBefore(mount, firstShelf);
      } catch (e) { /* noop */ }
    }
    reorder();
    setTimeout(reorder, 700);
    setTimeout(reorder, 1800);
    setTimeout(reorder, 3800);
    setTimeout(reorder, 7000);
  }

  function srvCard(review, color) {
    var rating = Math.max(4, Math.min(Number(review.rating) || 5, 5));
    return (
      '<article class="vtx-srv-card">' +
        '<div>' +
          '<div class="vtx-srv-card-stars">' + rvStars(rating, color, 14) + "</div>" +
          '<p class="vtx-srv-quote">“' + escapeHtml(review.body) + '”</p>' +
        "</div>" +
        '<div class="vtx-srv-author">' +
          '<span>' + escapeHtml(review.author || "Cliente") + "</span>" +
          '<span class="vtx-srv-date">' + escapeHtml(rvDate(review.date)) + "</span>" +
        "</div>" +
      "</article>"
    );
  }

  function initStoreReviewsHome() {
    if (!API_KEY || !API_BASE) return;
    if (detectPageType() !== "home") return;
    if (document.getElementById("vtx-store-reviews-home")) return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initStoreReviewsHome, { once: true });
      return;
    }

    var rotationSeed = Math.floor(Date.now() / 300000) + "-" + Math.floor(Math.random() * 1000000).toString(36);
    var url = API_BASE + "/api/reviews/store-highlights?key=" + encodeURIComponent(API_KEY) + "&limit=12&seed=" + encodeURIComponent(rotationSeed);
    fetchWithTimeout(fetchJSON(url), 5000).then(function (data) {
      var reviews = data && data.reviews ? shuffle(data.reviews) : [];
      if (!data || data.enabled === false || !reviews.length) return;

      var color = (data.settings && (data.settings.star_color || data.settings.accent_color)) || "#e6b800";
      var anchor = srvFindHomeAnchor();
      if (!anchor || !anchor.el) return;

      srvInjectStyles();
      var positiveCount = data.summary && data.summary.total_positive ? data.summary.total_positive : reviews.length;
      var positiveScore = srvScore(data.summary);
      var positiveRating = Number(positiveScore) || 4.7;
      anchor.el.innerHTML =
        '<section id="vtx-store-reviews-home" aria-label="Avaliações positivas da loja">' +
          '<div class="vtx-srv-head">' +
            '<div>' +
              '<p class="vtx-srv-kicker">Avaliações da loja</p>' +
              '<h2 class="vtx-srv-title">Quem comprou, aprovou</h2>' +
            "</div>" +
            '<div class="vtx-srv-summary">' +
              '<div class="vtx-srv-score">' + positiveScore + '+ <span class="vtx-srv-stars">' + rvStars(positiveRating, color, 16) + "</span></div>" +
              '<p class="vtx-srv-count">' + srvCount(positiveCount) + " avaliações positivas</p>" +
            "</div>" +
          "</div>" +
          '<div class="vtx-srv-shell">' +
            '<div class="vtx-srv-track">' + reviews.map(function (r) { return srvCard(r, color); }).join("") + "</div>" +
            '<div class="vtx-srv-nav">' +
              '<button class="vtx-srv-btn" type="button" data-vtx-srv-prev aria-label="Avaliação anterior">‹</button>' +
              '<button class="vtx-srv-btn" type="button" data-vtx-srv-next aria-label="Próxima avaliação">›</button>' +
            "</div>" +
          "</div>" +
        "</section>";

      srvEnsureBeforeFirstShelf(anchor.el);

      var track = anchor.el.querySelector(".vtx-srv-track");
      var prev = anchor.el.querySelector("[data-vtx-srv-prev]");
      var next = anchor.el.querySelector("[data-vtx-srv-next]");
      var autoplayTimer = null;
      var autoplayPaused = false;
      function move(dir, loop) {
        if (!track) return;
        var card = track.querySelector(".vtx-srv-card");
        var amount = card ? card.offsetWidth + 12 : 297;
        var maxLeft = Math.max(0, track.scrollWidth - track.clientWidth - 4);
        var target = track.scrollLeft + (dir * amount);
        if (loop && dir > 0 && target >= maxLeft) target = 0;
        if (loop && dir < 0 && target <= 0) target = maxLeft;
        try { track.scrollTo({ left: target, behavior: "smooth" }); }
        catch (e) { track.scrollLeft = target; }
      }
      function stopAutoplay() {
        if (!autoplayTimer) return;
        clearInterval(autoplayTimer);
        autoplayTimer = null;
      }
      function startAutoplay() {
        if (!track || reviews.length < 2 || track.scrollWidth <= track.clientWidth + 12) return;
        if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        stopAutoplay();
        autoplayTimer = setInterval(function () {
          if (!autoplayPaused) move(1, true);
        }, 4200);
      }
      function pauseAutoplay() { autoplayPaused = true; }
      function resumeAutoplay() { autoplayPaused = false; }

      if (prev) prev.addEventListener("click", function () { pauseAutoplay(); move(-1, true); setTimeout(resumeAutoplay, 5000); });
      if (next) next.addEventListener("click", function () { pauseAutoplay(); move(1, true); setTimeout(resumeAutoplay, 5000); });
      if (track) {
        track.addEventListener("mouseenter", pauseAutoplay);
        track.addEventListener("mouseleave", resumeAutoplay);
        track.addEventListener("focusin", pauseAutoplay);
        track.addEventListener("focusout", resumeAutoplay);
        track.addEventListener("pointerdown", pauseAutoplay);
        track.addEventListener("pointerup", function () { setTimeout(resumeAutoplay, 3500); });
        track.addEventListener("touchstart", pauseAutoplay, { passive: true });
        track.addEventListener("touchend", function () { setTimeout(resumeAutoplay, 3500); }, { passive: true });
        document.addEventListener("visibilitychange", function () {
          if (document.hidden) pauseAutoplay();
          else resumeAutoplay();
        });
        setTimeout(startAutoplay, 900);
      }
    }).catch(function (err) {
      console.warn("[Store Reviews] erro:", err);
    });
  }

  function scheduleStoreReviewsHome() {
    if (detectPageType() !== "home") return;
    var run = function () { initStoreReviewsHome(); };
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 1800 });
    else setTimeout(run, 1000);
  }

  // Run when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      init();
      initGiftBar();
      initPromoTags();
      initCAPI();
      initTopbar();
      initGiftRequest();
      initReviews();
      scheduleStoreReviewsHome();
    });
  } else {
    init();
    initGiftBar();
    initPromoTags();
    initCAPI();
    initTopbar();
    initGiftRequest();
    initReviews();
    scheduleStoreReviewsHome();
  }
})();
