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
    console.warn("[Shelves] Could not detect API base URL. Set window._shelvesBase before loading.");
    return;
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

    var priceHTML = "";
    if (hasDiscount) {
      var pct = Math.round(
        ((product.price - product.sale_price) / product.price) * 100
      );
      priceHTML =
        '<div class="price-wrapper">';
      if (pct > 0) {
        priceHTML += '<span class="vtx-discount-tag">-' + pct + "%</span>";
      }
      priceHTML +=
        '<del class="vtx-price-original">R$ ' + formatPrice(product.price) + "</del>" +
        '<span class="vtx-price-sale">R$ ' + formatPrice(product.sale_price) + "</span>" +
        '<span class="vtx-installments" data-price="' + product.sale_price + '"></span>' +
        "</div>";
    } else {
      priceHTML =
        '<div class="price-wrapper">' +
        '<span class="vtx-price">R$ ' + formatPrice(product.price) + "</span>" +
        '<span class="vtx-installments" data-price="' + product.price + '"></span>' +
        "</div>";
    }

    var imgSrc = product.image_url || "";
    var imgSrc2 = product.image_url_2 || imgSrc;
    var link = product.product_url || "#";

    // Optimize image URL (800px width via VNDA CDN)
    if (imgSrc.indexOf("cdn.vnda.com.br") !== -1) {
      imgSrc = imgSrc.replace(/\/(\d+x\/)?/, "/800x/");
    }
    if (imgSrc2.indexOf("cdn.vnda.com.br") !== -1) {
      imgSrc2 = imgSrc2.replace(/\/(\d+x\/)?/, "/800x/");
    }

    return (
      '<div class="product-block" data-vtx-product-id="' + product.product_id + '">' +
        '<div class="images">' +
          '<a href="' + link + '">' +
            '<figure class="image -square">' +
              '<img alt="' + (product.name || "") + '" src="' + imgSrc + '" loading="lazy">' +
              '<img alt="' + (product.name || "") + '" src="' + imgSrc2 + '" loading="lazy">' +
            "</figure>" +
          "</a>" +
        "</div>" +
        '<div class="description">' +
          '<h3 class="name"><a href="' + link + '">' + (product.name || "") + "</a></h3>" +
          priceHTML +
        "</div>" +
      "</div>"
    );
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
        "</div>" +
        '<div class="swiper vtx-swiper">' +
          '<div class="swiper-wrapper">' +
            slides +
          "</div>" +
          '<div class="swiper-pagination"></div>' +
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
          pagination: {
            el: swiperEl.querySelector(".swiper-pagination"),
            clickable: true,
          },
          navigation: {
            nextEl: swiperEl.querySelector(".swiper-button-next"),
            prevEl: swiperEl.querySelector(".swiper-button-prev"),
          },
          breakpoints: {
            660: { slidesPerView: 3, spaceBetween: 16 },
            1030: { slidesPerView: 4, spaceBetween: 20 },
          },
        });
        console.log("[Shelves] Swiper initialized");
      } else {
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
      ".vtx-shelf-container { width: 100%; }" +
      ".vtx-shelf { padding: 24px 0; }" +
      ".vtx-shelf .header { text-align: center; margin-bottom: 20px; }" +
      ".vtx-shelf .header .title { font-size: 1.4em; font-weight: 600; }" +
      ".vtx-shelf .product-block { text-align: center; }" +
      ".vtx-shelf .product-block .images { position: relative; overflow: hidden; }" +
      ".vtx-shelf .product-block .images figure { margin: 0; }" +
      ".vtx-shelf .product-block .images img { width: 100%; height: auto; display: block; }" +
      ".vtx-shelf .product-block .images img:nth-child(2) { display: none; }" +
      ".vtx-shelf .product-block:hover .images img:first-child { display: none; }" +
      ".vtx-shelf .product-block:hover .images img:nth-child(2) { display: block; }" +
      ".vtx-shelf .product-block .description { padding: 12px 8px; }" +
      ".vtx-shelf .product-block .name { font-size: 0.85em; font-weight: 400; margin: 0 0 8px; line-height: 1.3; }" +
      ".vtx-shelf .product-block .name a { color: inherit; text-decoration: none; }" +
      ".vtx-shelf .price-wrapper { font-size: 0.9em; }" +
      ".vtx-shelf .vtx-price, .vtx-shelf .vtx-price-sale { font-weight: 600; color: #333; }" +
      ".vtx-shelf .vtx-price-original { color: #999; font-size: 0.85em; text-decoration: line-through; margin-right: 6px; }" +
      ".vtx-shelf .vtx-discount-tag { display: inline-block; background: #e74c3c; color: #fff; font-size: 0.75em; padding: 2px 6px; border-radius: 3px; margin-right: 6px; }" +
      ".vtx-shelf .vtx-installments { display: block; font-size: 0.75em; color: #777; margin-top: 4px; }" +
      ".vtx-shelf .swiper-button-prev, .vtx-shelf .swiper-button-next { color: #333; }" +
      ".vtx-shelf .swiper-pagination-bullet-active { background: #333; }";

    var style = document.createElement("style");
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
          var product = products.find(function (p) { return p.product_id === pid; }) || products[idx];

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

  async function init() {
    var pageType = detectPageType();
    console.log("[Shelves] Page type:", pageType, "| API_BASE:", API_BASE);
    if (pageType === "other") return;

    // Inject styles
    injectStyles();

    try {
      // Fetch config
      var configData = await fetchConfig(pageType);
      var shelves = configData.shelves || [];
      console.log("[Shelves] Config loaded:", shelves.length, "shelves for", pageType);

      if (shelves.length === 0) return;

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
            console.log("[Shelves]", shelf.algorithm, "->", (data.products || []).length, "products");
            return { shelf: shelf, products: data.products || [] };
          })
          .catch(function (err) {
            console.error("[Shelves]", shelf.algorithm, "fetch error:", err);
            return { shelf: shelf, products: [] };
          });
      });

      var results = await Promise.all(promises);

      // Render each shelf
      results.forEach(function (result, index) {
        if (result.products.length === 0) {
          console.warn("[Shelves]", result.shelf.algorithm, "- no products, skipping");
          return;
        }

        var anchor = getOrCreateAnchor(result.shelf, pageType, index);
        renderShelf(result.shelf, result.products, anchor);
        console.log("[Shelves] Rendered", result.shelf.algorithm, "(" + result.products.length + " products)");
      });
    } catch (err) {
      console.error("[Shelves] Init error:", err);
    }
  }

  // Run when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
