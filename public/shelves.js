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

    var imgSrc = product.image_url || "";
    var imgSrc2 = product.image_url_2 || imgSrc;
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
            '<figure class="image">' +
              '<img alt="' + escapeHtml(product.name) + '" src="' + cleanUrl(imgSrc) + '" loading="lazy">' +
              '<img alt="' + escapeHtml(product.name) + '" src="' + cleanUrl(imgSrc2) + '" loading="lazy">' +
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

  function cleanUrl(url) {
    if (!url) return "";
    var u = url;
    if (u && u.indexOf("//") === 0) u = "https:" + u;
    if (u.indexOf("cdn.vnda.com.br") !== -1) {
      u = u.replace(/cdn\.vnda\.com\.br\/(\d+x\/)?/, "cdn.vnda.com.br/800x/");
    }
    return u;
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
            1030: { slidesPerView: 4, spaceBetween: 20 },
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
      ".vtx-shelf { margin: 40px auto; font-family: 'Inter', sans-serif; position: relative; width: 100%; max-width: 1202px; padding: 0 15px; box-sizing: border-box; }" +
      ".vtx-shelf .header { text-align: center; margin-bottom: 24px; position: relative; }" +
      ".vtx-shelf .header .title { font-size: 24px; font-weight: 900; color: #000; text-transform: uppercase; letter-spacing: 1px; margin: 0; }" +
      ".vtx-shelf .header .view-all { display: block; font-size: 12px; color: #666; text-decoration: none; margin-top: 8px; text-transform: lowercase; }" +
      ".vtx-shelf .product-block { position: relative; padding: 0; transition: transform 0.2s; cursor: pointer; text-align: left; }" +
      ".vtx-shelf .images { position: relative; margin-bottom: 12px; overflow: hidden; border-radius: 4px; background: #f5f5f5; width: 100%; }" +
      ".vtx-shelf .images .image { margin: 0; padding-bottom: 177.78%; position: relative; width: 100%; display: block; }" +
      ".vtx-shelf .images .image img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity 0.3s; }" +
      ".vtx-shelf .images .image img:nth-child(2) { opacity: 0; }" +
      ".vtx-shelf .product-block:hover .images .image img:nth-child(1) { opacity: 0; }" +
      ".vtx-shelf .product-block:hover .images .image img:nth-child(2) { opacity: 1; }" +
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
      ".vtx-skel-card { flex: 0 0 23%; aspect-ratio: 9/16; background: #eee; border-radius: 4px; animation: vtx-pulse 1.5s infinite; }" +
      "@keyframes vtx-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }" +
      "@media (max-width: 768px) {" +
        ".vtx-shelf .header .title { font-size: 18px; }" +
        ".vtx-price-main { font-size: 18px; }" +
        ".vtx-skel-card { flex: 0 0 47%; }" +
      "}";

    var style = document.createElement("style");
    style.id = "vtx-shelf-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // --- Main ---

  function renderShelf(shelf, products, anchor) {
    var html = buildShelfHTML(shelf, products);
    anchor.innerHTML = html;

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
              var products = shuffle(data.products || []);
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
    var CART_EVENTS = [
      "vnda:cart-drawer-added-item",
      "vnda:cart-drawer-deleted-item",
      "vnda:cart-drawer-updated-item",
      "vnda:cart-drawer-coupon-added",
      "vnda:cart-drawer-coupon-removed",
    ];

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
  function renderProductBenefits(cfg) {
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

    // Find anchor: admin override → fallback selectors
    var anchor = null;
    if (cfg.product_benefits_anchor) {
      anchor = document.querySelector(cfg.product_benefits_anchor);
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
    anchor.parentNode.insertBefore(block, anchor.nextSibling);

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
          if (cfg.product_benefits_anchor) {
            pdpAnchor = document.querySelector(cfg.product_benefits_anchor);
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
          pdpAnchor.parentNode.insertBefore(bar, pdpAnchor.nextSibling);
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
        "width: 100%; flex-basis: 100%;" +
        "margin: 12px 0; clear: both;" +
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
      // Coupon countdown — bigger, more eye-catching pill with code+timer
      ".vtx-promo-tag--coupon {" +
        "display: inline-flex; align-items: center; gap: 8px;" +
        "padding: 6px 12px;" +
        "font-weight: 600; text-transform: none; font-size: 12px;" +
        "border-radius: 6px;" +
        "font-family: inherit; line-height: 1.3;" +
        "cursor: pointer;" +
      "}" +
      ".vtx-promo-tag--coupon strong { font-weight: 700 }" +
      ".vtx-promo-tag--coupon .vtx-coupon-code {" +
        "display: inline-flex; align-items: center; gap: 4px;" +
        "padding: 2px 8px; border: 1px dashed currentColor; border-radius: 4px;" +
        "letter-spacing: .04em; font-weight: 700;" +
      "}" +
      ".vtx-promo-tag--coupon .vtx-coupon-code:hover { opacity: .85 }" +
      ".vtx-promo-tag--coupon .vtx-countdown { font-variant-numeric: tabular-nums; font-weight: 700 }" +
      ".vtx-promo-tag--coupon.vtx-coupon-copied { animation: vtx-coupon-copied .8s ease }" +
      "@keyframes vtx-coupon-copied {" +
        "0% { transform: scale(1) }" +
        "30% { transform: scale(1.04) }" +
        "100% { transform: scale(1) }" +
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
    return badge;
  }

  function createViewersBadge(rule) {
    var badge = document.createElement("div");
    badge.className = "vtx-promo-tag vtx-promo-tag--viewers";
    var min = Number(rule.viewers_min) || 6;
    var max = Number(rule.viewers_max) || 42;
    var baseline = Number(rule.viewers_baseline) || Math.round((min + max) / 2);
    // Drift state: starts near baseline and walks step-by-step
    var current = baseline;

    function pickValue() {
      // Spread ±20% of baseline (min 1, max 4)
      var spread = Math.max(1, Math.min(4, Math.round(baseline * 0.20)));
      var delta;
      if (Math.random() < 0.7) {
        // Random walk
        delta = Math.round((Math.random() - 0.5) * 2 * spread);
      } else {
        // Pull back toward baseline so it doesn't drift forever
        delta = Math.sign(baseline - current) * Math.min(2, Math.abs(baseline - current));
      }
      current = current + delta;
      // Clamp drift to ±1.5×spread of baseline so it never feels far off
      var maxDrift = Math.round(spread * 1.5);
      if (current > baseline + maxDrift) current = baseline + maxDrift;
      if (current < baseline - maxDrift) current = baseline - maxDrift;
      // Final clamp to absolute min/max
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
    // Update every 8-16s so visitors actually see the count moving
    setInterval(function () {
      render(pickValue());
    }, 8000 + Math.floor(Math.random() * 8000));

    applyRuleColors(badge, rule, "rgba(244,63,94,.08)", "#be123c");
    return badge;
  }

  function createCouponCountdownBadge(rule) {
    var badge = document.createElement("div");
    badge.className = "vtx-promo-tag vtx-promo-tag--coupon";
    var code = String(rule.coupon_code || "").toUpperCase();
    var pct = Number(rule.coupon_discount_pct || 0);
    var expiresAt = new Date(rule.coupon_expires_at).getTime();
    if (!code || !pct || !expiresAt) return null;

    function fmtCountdown(ms) {
      if (ms <= 0) return "00:00:00";
      var totalSec = Math.floor(ms / 1000);
      var d = Math.floor(totalSec / 86400);
      var h = Math.floor((totalSec % 86400) / 3600);
      var m = Math.floor((totalSec % 3600) / 60);
      var s = totalSec % 60;
      function pad(n) { return n < 10 ? "0" + n : String(n); }
      if (d > 0) return d + "d " + pad(h) + ":" + pad(m) + ":" + pad(s);
      return pad(h) + ":" + pad(m) + ":" + pad(s);
    }

    function render() {
      var remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        badge.style.display = "none";
        if (timer) clearInterval(timer);
        return;
      }
      var template = rule.badge_text || "{discount}% OFF | Cupom {coupon} | Acaba em {countdown}";
      var html = template
        .replace(/\{discount\}/g, "<strong>" + pct + "</strong>")
        .replace(/\{coupon\}/g, '<span class="vtx-coupon-code" title="Clique para copiar">' + code + '</span>')
        .replace(/\{countdown\}/g, '<span class="vtx-countdown">' + fmtCountdown(remaining) + '</span>');
      badge.innerHTML = html;

      // Re-bind copy on each render
      var codeEl = badge.querySelector(".vtx-coupon-code");
      if (codeEl) {
        codeEl.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          var text = code;
          var done = function () {
            badge.classList.add("vtx-coupon-copied");
            setTimeout(function () { badge.classList.remove("vtx-coupon-copied"); }, 800);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(function () {});
          } else {
            try {
              var ta = document.createElement("textarea");
              ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
              document.body.appendChild(ta); ta.select(); document.execCommand("copy");
              document.body.removeChild(ta); done();
            } catch (err) { /* silent */ }
          }
        });
      }
    }

    render();
    var timer = setInterval(render, 1000);
    applyRuleColors(badge, rule, "#dc2626", "#ffffff");
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

    var rules = matches[productId];
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
        badge = createViewersBadge(rule);
      } else if (badgeType === "coupon_countdown") {
        badge = createCouponCountdownBadge(rule);
      } else {
        // Static — only render once on PDP
        if (document.querySelector(".vtx-promo-tag--pdp")) continue;
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

      if (goesNearPrice) {
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

  function applyPromoTagsListing(matches) {
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
        if ((matches[productId][r].badge_type || "static") === "static") {
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
      applyPromoTagsListing(matches);
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
    window.addEventListener("vnda:cart-drawer-added-item", function () {
      sendCAPI("add_to_cart", {});
    });

    // --- InitiateCheckout ---
    if (window.location.pathname.indexOf("/checkout") !== -1 &&
        window.location.pathname.indexOf("/confirmation") === -1) {
      sendCAPI("initiate_checkout", {});
    }

    // --- Purchase (confirmation page) ---
    if (window.location.pathname.indexOf("/checkout/confirmation") !== -1 ||
        window.location.pathname.indexOf("/pedido/") !== -1) {
      getCartTotal(function (total) {
        if (total > 0) {
          sendCAPI("purchase", { value: total });
        }
      });
    }

    console.log("[VtxCAPI] Initialized server-side events for BK COM pixel");
  }

  function sendCAPI(eventType, data) {
    if (!API_BASE) return;

    var payload = {
      key: API_KEY,
      event_type: eventType,
      event_id: "vtx_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10),
      url: window.location.href,
      referrer: document.referrer || "",
      user_agent: navigator.userAgent,
      fbc: getCookie("_fbc") || "",
      fbp: getCookie("_fbp") || "",
      external_id: consumerId || "",
      content_ids: data.content_ids || [],
      content_name: data.content_name || "",
      content_type: data.content_type || "product",
      value: data.value || 0,
      currency: "BRL",
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

  // Run when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      init();
      initGiftBar();
      initPromoTags();
      initCAPI();
    });
  } else {
    init();
    initGiftBar();
    initPromoTags();
    initCAPI();
  }
})();
