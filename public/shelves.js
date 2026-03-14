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
    API_BASE = "https://dash.bulking.com.br";
    console.log("[Shelves] API_BASE fallback used:", API_BASE);
  }

  console.log("[Shelves] Init | key:", API_KEY.slice(0, 8) + "...", "| base:", API_BASE);

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
    var path = window.location.pathname;
    if (path === "/" || path === "/home") return "home";
    if (/\/(produto|produtos|product)\//.test(path)) return "product";
    if (/\/(categoria|categorias|category|c)\//.test(path)) return "category";
    if (/\/(carrinho|cart|checkout)/.test(path)) return "cart";
    return "other";
  }

  function extractProductId() {
    // Try meta tag first
    var meta = document.querySelector('meta[property="product:retailer_item_id"]');
    if (meta && meta.content) return meta.content;

    // Try data attribute
    var el = document.querySelector("[data-product-id]");
    if (el) return el.getAttribute("data-product-id");

    // Try VNDA product page JSON
    try {
      var jsonScript = document.querySelector('script[type="application/ld+json"]');
      if (jsonScript) {
        var ld = JSON.parse(jsonScript.textContent);
        if (ld.sku) return ld.sku;
        if (ld["@type"] === "Product" && ld.productID) return ld.productID;
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
      { after: ".product-description, .product-info, section.product" },
      { after: "#yv-reviews, .product-reviews" },
      { before: "footer, .footer" }
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

  function fetchRecommend(algorithm, limit, extraParams) {
    var url =
      API_BASE +
      "/api/shelves/recommend?key=" + API_KEY +
      "&algorithm=" + algorithm +
      "&consumer_id=" + consumerId +
      "&limit=" + limit;

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
      '<div class="product-block" data-vtx-product-id="' + product.product_id + '">' +
        '<div class="images">' +
          (badgeLabel ? '<div class="vtx-badge">' + badgeLabel + '</div>' : '') +
          '<a href="' + link + '">' +
            '<figure class="image">' +
              '<img alt="' + (product.name || "") + '" src="' + cleanUrl(imgSrc) + '" loading="lazy">' +
              '<img alt="' + (product.name || "") + '" src="' + cleanUrl(imgSrc2) + '" loading="lazy">' +
            "</figure>" +
          "</a>" +
        "</div>" +
        '<div class="description">' +
          '<h3 class="name"><a href="' + link + '">' + (product.name || "") + "</a></h3>" +
          priceHTML +
          '<span class="vtx-installments" data-price="' + (product.sale_price || product.price) + '"></span>' +
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

  function buildShelfHTML(shelf, products) {
    var slides = products
      .map(function (p) {
        return '<div class="swiper-slide">' + buildProductCard(p) + "</div>";
      })
      .join("");

    return (
      '<section class="section products carousel container vtx-shelf" data-vtx-algorithm="' + shelf.algorithm + '">' +
        '<div class="header">' +
          '<h2 class="title">' + shelf.title + "</h2>" +
          '<a href="/novidades" class="view-all">ver todas <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></a>' +
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
      ".vtx-shelf .images .image { margin: 0; padding-bottom: 150%; position: relative; width: 100%; display: block; }" +
      ".vtx-shelf .images .image img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity 0.3s; }" +
      ".vtx-shelf .images .image img:nth-child(2) { opacity: 0; }" +
      ".vtx-shelf .product-block:hover .images .image img:nth-child(1) { opacity: 0; }" +
      ".vtx-shelf .product-block:hover .images .image img:nth-child(2) { opacity: 1; }" +
      ".vtx-badge { position: absolute; top: 10px; right: 10px; background: #fff; color: #000; padding: 4px 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; z-index: 10; border: 1px solid #eee; }" +
      ".vtx-discount-circle { position: absolute; bottom: 10px; left: 10px; background: #ff0000; color: #fff; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 900; z-index: 10; }" +
      ".vtx-shelf .description { text-align: left; }" +
      ".vtx-shelf .name { font-size: 13px; font-weight: 600; text-transform: uppercase; color: #333; margin: 0 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }" +
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
      "@media (max-width: 768px) {" +
        ".vtx-shelf .header .title { font-size: 18px; }" +
        ".vtx-price-main { font-size: 18px; }" +
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

  function init() {
    var pageType = detectPageType();
    console.log("[Shelves] Page type:", pageType, "| API_BASE:", API_BASE);
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

        // Fetch all recommendations in parallel
        var promises = shelves.map(function (shelf) {
          return fetchRecommend(shelf.algorithm, shelf.max_products, extraParams)
            .then(function (data) {
              console.log("[Shelves] " + shelf.algorithm + " -> " + (data.products || []).length + " products");
              return { shelf: shelf, products: data.products || [] };
            })
            .catch(function (err) {
              console.error("[Shelves] " + shelf.algorithm + " fetch error:", err);
              return { shelf: shelf, products: [] };
            });
        });

        return Promise.all(promises);
      })
      .then(function (results) {
        if (!results) return;

        // Render each shelf
        results.forEach(function (result, index) {
          if (result.products.length === 0) {
            console.warn("[Shelves] " + result.shelf.algorithm + " - no products found");
            return;
          }

          console.log("[Shelves] Attempting to render " + result.shelf.algorithm + " at index " + index);
          var anchor = getOrCreateAnchor(result.shelf, pageType, index);
          if (!anchor) {
            console.error("[Shelves] Failed to create anchor for " + result.shelf.algorithm);
            return;
          }

          renderShelf(result.shelf, result.products, anchor);
          console.log("[Shelves] Rendered algorithm '" + result.shelf.algorithm + "' at pos " + result.shelf.position);
        });
      })
      .catch(function (err) {
        console.error("[Shelves] Fatal Init Error:", err);
      });
  }

  // Run when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
