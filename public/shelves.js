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
          '<span class="vtx-installments" data-price="' + escapeHtml(product.sale_price || product.price) + '"></span>' +
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

  // --- Installments ---

  function calculateInstallments(container) {
    try {
      var valorMinimoParcela = 12.72;
      var numeroMaximoParcelas = 6;
      var els = container.querySelectorAll(".vtx-installments");
      for (var j = 0; j < els.length; j++) {
        var val = parseFloat(els[j].getAttribute("data-price"));
        if (val && val > valorMinimoParcela) {
          var parcelas = Math.min(
            Math.floor(val / valorMinimoParcela),
            numeroMaximoParcelas
          );
          if (parcelas >= 2) {
            var valorParcela = (val / parcelas).toFixed(2).replace(".", ",");
            els[j].textContent =
              parcelas + "x de R$ " + valorParcela + " s/ juros";
          }
        }
      }
    } catch (e) {
      // ignore
    }
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
      ".vtx-installments { font-size: 11px; color: #666; margin-top: 4px; display: block; }" +
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

    // Calculate installments
    calculateInstallments(anchor);

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

  function getCartTotal(callback) {
    try {
      // 1. Try global cart objects (VNDA themes)
      if (window.cart && typeof window.cart.total === "number") {
        return callback(window.cart.total);
      }
      if (window.vnda && window.vnda.cart && typeof window.vnda.cart.total === "number") {
        return callback(window.vnda.cart.total);
      }

      // 2. Try DOM: cart total elements
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
        "tr.total .value",
        ".summary-total",
        ".c-summary__total-value",
        "p.total span",
        "[data-checkout-total]"
      ];
      for (var i = 0; i < selectors.length; i++) {
        var els = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < els.length; j++) {
          var el = els[j];
          var val = parseBRL(el.textContent || el.getAttribute("data-cart-total") || el.getAttribute("data-total-price"));
          if (val > 0) return callback(val);
        }
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


  function initGiftBar() {
    fetchJSON(API_BASE + "/api/gift-bar/public-config?key=" + API_KEY)
      .then(function (data) {
        if (!data.gift_bar) return;
        var cfg = data.gift_bar;

        var pageType = detectPageType();

        // Check if bar should show on this page
        if (cfg.show_on_pages.indexOf("all") === -1 && cfg.show_on_pages.indexOf(pageType) === -1) return;

        // Inject styles
        var css =
          "#vtx-gift-bar{position:sticky;z-index:90;" +
            "background:" + escapeHtml(cfg.bg_color) + ";" +
            "color:" + escapeHtml(cfg.text_color) + ";" +
            "padding:10px 16px;" +
            "font-family:'Inter',system-ui,sans-serif;" +
            "font-size:" + escapeHtml(cfg.font_size) + ";" +
            "box-shadow:0 1px 3px rgba(0,0,0,.1);" +
            (cfg.position === "bottom" ? "bottom:0;" : "top:0;") +
          "}" +
          "#vtx-gift-bar.vtx-gb-achieved{" +
            "background:" + escapeHtml(cfg.achieved_bg_color) + "!important;" +
            "color:" + escapeHtml(cfg.achieved_text_color) + "!important;" +
          "}" +
          ".vtx-gb-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;gap:12px}" +
          ".vtx-gb-img{width:32px;height:32px;object-fit:contain;border-radius:4px}" +
          ".vtx-gb-content{flex:1}" +
          ".vtx-gb-text{margin:0 0 6px;font-weight:600;text-align:center}" +
          ".vtx-gb-track{width:100%;height:" + escapeHtml(cfg.bar_height) + ";" +
            "background:" + escapeHtml(cfg.bar_bg_color) + ";" +
            "border-radius:999px;overflow:hidden}" +
          ".vtx-gb-fill{height:100%;" +
            "background:" + escapeHtml(cfg.bar_color) + ";" +
            "border-radius:999px;transition:width .5s ease;width:0}" +
          "@media(max-width:768px){" +
            "#vtx-gift-bar{position:relative;padding:8px 12px;font-size:12px}" +
            ".vtx-gb-img{width:24px;height:24px}" +
          "}";

        var style = document.createElement("style");
        style.id = "vtx-gift-bar-styles";
        style.textContent = css;
        document.head.appendChild(style);

        // Create bar element
        var bar = document.createElement("div");
        bar.id = "vtx-gift-bar";
        bar.innerHTML =
          '<div class="vtx-gb-inner">' +
            (cfg.gift_image_url ?
              '<img class="vtx-gb-img" src="' + escapeHtml(cfg.gift_image_url) + '" alt="' + escapeHtml(cfg.gift_name) + '" onerror="this.style.display=\'none\'">' : "") +
            '<div class="vtx-gb-content">' +
              '<p class="vtx-gb-text"></p>' +
              '<div class="vtx-gb-track">' +
                '<div class="vtx-gb-fill"></div>' +
              '</div>' +
            '</div>' +
          '</div>';

        // Insert in page
        var isMobile = window.innerWidth <= 768;
        if (cfg.position === "bottom") {
          document.body.appendChild(bar);
        } else if (isMobile) {
          // On mobile, insert after the header/nav to avoid interfering
          // with VNDA's fixed buy button and sticky header layout
          var header = document.querySelector("header, .header, nav.main-nav, .top-bar, #header");
          if (header) {
            header.parentNode.insertBefore(bar, header.nextSibling);
          } else {
            document.body.insertBefore(bar, document.body.firstChild);
          }
        } else {
          document.body.insertBefore(bar, document.body.firstChild);
        }

        var giftAchieved = false;

        function updateBar(cartTotal) {
          var textEl = bar.querySelector(".vtx-gb-text");
          var fillEl = bar.querySelector(".vtx-gb-fill");
          if (!textEl || !fillEl) return;

          var pct = Math.min((cartTotal / cfg.threshold) * 100, 100);
          var remaining = Math.max(cfg.threshold - cartTotal, 0);

          var message;
          if (cartTotal <= 0) {
            message = cfg.message_empty;
            bar.classList.remove("vtx-gb-achieved");
          } else if (cartTotal >= cfg.threshold) {
            message = cfg.message_achieved;
            bar.classList.add("vtx-gb-achieved");
          } else {
            message = cfg.message_progress;
            bar.classList.remove("vtx-gb-achieved");
          }

          // Interpolate placeholders
          message = message
            .replace(/\{remaining\}/g, formatBRL(remaining))
            .replace(/\{threshold\}/g, formatBRL(cfg.threshold))
            .replace(/\{gift\}/g, cfg.gift_name)
            .replace(/\{total\}/g, formatBRL(cartTotal));

          textEl.textContent = message;
          fillEl.style.width = pct + "%";

          // Fire GA4 event once when threshold reached
          if (cartTotal >= cfg.threshold && !giftAchieved) {
            giftAchieved = true;
            if (window.dataLayer) {
              window.dataLayer.push({
                event: "vtx_gift_bar_achieved",
                gift_name: cfg.gift_name,
                cart_total: cartTotal,
                threshold: cfg.threshold,
              });
            }
          }
        }

        // Initial cart read
        getCartTotal(function (total) {
          updateBar(total);
          // If total is 0, retry once after 2 seconds (some themes load cart async)
          if (total === 0) {
            setTimeout(function () {
              getCartTotal(updateBar);
            }, 2000);
          }
        });

        // Listen for cart changes
        setupCartListeners(updateBar);

        console.log("[GiftBar] Initialized, position:", cfg.position, "threshold:", cfg.threshold);
      })

      .catch(function (err) {
        // Gift bar is optional - never break the page
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
      "}";

    var style = document.createElement("style");
    style.id = "vtx-promo-tag-styles";
    style.textContent = css;
    document.head.appendChild(style);
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

  function applyPromoTagsPDP(matches) {
    // Product detail page: inject a single badge above the buy button
    if (document.querySelector(".vtx-promo-tag--pdp")) return;

    // Get product ID from meta/hidden input (single product on page)
    var productId = extractProductId();
    if (!productId || !matches[productId]) return;

    var rule = matches[productId][0];
    var badge = createBadgeElement(rule, true);

    // Try to insert before the buy/add-to-cart button
    var buyBtn = document.querySelector(
      ".buy-button-container, .product-buy, #buy-button, " +
      "[data-cart-add], .add-to-cart, form.product-form .submit, " +
      "button.buy-btn, .product-actions, .product-buy-area"
    );
    if (buyBtn) {
      buyBtn.parentNode.insertBefore(badge, buyBtn);
      return;
    }

    // Fallback: insert before the product form submit or quantity selector
    var form = document.querySelector("#product-form, .product-form, form[action*='carrinho']");
    if (form) {
      form.parentNode.insertBefore(badge, form);
      return;
    }

    // Last fallback: insert after price area
    var price = document.querySelector(".product-price, .prices, .price");
    if (price) {
      price.parentNode.insertBefore(badge, price.nextSibling);
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

      var rule = matches[productId][0];
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

  function applyPromoTags(matches) {
    var pageType = detectPageType();
    if (pageType === "product") {
      applyPromoTagsPDP(matches);
    } else {
      applyPromoTagsListing(matches);
    }
  }

  function observeNewProducts(matches) {
    if (!window.MutationObserver) return;

    var debounceTimer = null;
    var observer = new MutationObserver(function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        applyPromoTags(matches);
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
        applyPromoTags(matches);
        observeNewProducts(matches);
      })
      .catch(function (err) {
        // Promo tags are optional - never break the page
        console.warn("[PromoTags] Init error:", err);
      });
  }

  // Run when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      init();
      initGiftBar();
      initPromoTags();
    });
  } else {
    init();
    initGiftBar();
    initPromoTags();
  }
})();
