/**
 * Vortex Smart Shelves - Script Cliente
 * Substitui SmartHint nas lojas VNDA
 *
 * Instalacao via GTM:
 *   var _shelvesKey = "SUA_API_KEY";
 *   (function(){var s=document.createElement('script');s.async=true;
 *   s.src='https://SEU_DOMINIO/shelves.js';document.head.appendChild(s)})();
 */
(function () {
  "use strict";

  // --- Config ---
  var API_KEY = window._shelvesKey || "";
  var API_BASE =
    document.currentScript && document.currentScript.src
      ? document.currentScript.src.replace("/shelves.js", "")
      : "";

  if (!API_KEY) {
    console.warn("[Shelves] Missing _shelvesKey. Set window._shelvesKey before loading.");
    return;
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

    // Use sendBeacon for reliability on page unload, fallback to fetch
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

  // --- GA4 events (SmartHint-compatible) ---

  function fireGA4Impression(shelf, products) {
    var dl = window.dataLayer;
    if (!dl) return;

    var algorithmMap = {
      bestsellers: "best-sellers",
      news: "news",
      offers: "offers",
      most_popular: "most-popular",
      last_viewed: "last-viewed",
      what_others_see_now: "others-customers-now",
      for_you: "for-you",
    };

    var listId = "smarthint-" + (algorithmMap[shelf.algorithm] || shelf.algorithm);

    dl.push({
      event: "view_item_list",
      category_event: "SmartHint",
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

    var listId = "smarthint-" + (algorithmMap[shelf.algorithm] || shelf.algorithm);

    dl.push({
      event: "select_item",
      category_event: "SmartHint",
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
        '<del>R$' + formatPrice(product.price) + "</del>" +
        '<ins>R$' + formatPrice(product.sale_price) + "</ins>" +
        '<span class="max_installments" value="' + product.sale_price + '"></span>';
      if (pct > 0) {
        priceHTML =
          '<span class="discount-tag">-' + pct + "%</span>" + priceHTML;
      }
    } else {
      priceHTML =
        "<span>R$" + formatPrice(product.price) + "</span>" +
        '<span class="max_installments" value="' + product.price + '"></span>';
    }

    // Build tag flags from product tags
    var flagsHTML = "";
    if (product.tags && Array.isArray(product.tags)) {
      product.tags.forEach(function (tag) {
        if (tag === "mais-vendidos") {
          flagsHTML +=
            '<div class="flag topo esquerda">MAIS VENDIDOS</div>';
        } else if (tag === "lancamentos-flag") {
          flagsHTML +=
            '<div class="flag topo esquerda">Lancamentos</div>';
        } else if (tag === "outlet-flag") {
          flagsHTML +=
            '<div class="flag topo direita">Super Desconto</div>';
        }
      });
    }

    var imgSrc = product.image_url || "";
    var imgSrc2 = product.image_url_2 || imgSrc;
    var link = product.product_url || "#";

    // Optimize image URL (800px width via VNDA CDN)
    if (imgSrc.indexOf("/bulking/") !== -1) {
      imgSrc = imgSrc.replace("/bulking/", "/800x/bulking/");
    }
    if (imgSrc2.indexOf("/bulking/") !== -1) {
      imgSrc2 = imgSrc2.replace("/bulking/", "/800x/bulking/");
    }

    return (
      '<div class="apoio-sh item" data-shproductid="' + product.product_id + '">' +
        '<div class="product-block" data-product-box="">' +
          '<div class="images">' +
            '<a href="' + link + '">' +
              '<figure class="image -square">' +
                '<img alt="' + (product.name || "") + '" src="' + imgSrc + '">' +
                '<img alt="' + (product.name || "") + '" src="' + imgSrc2 + '">' +
              "</figure>" +
              flagsHTML +
            "</a>" +
          "</div>" +
          '<div class="description">' +
            '<h3 class="name"><a href="' + link + '">' + (product.name || "") + "</a></h3>" +
            priceHTML +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function buildShelfHTML(shelf, products) {
    var cards = products
      .map(function (p) {
        return buildProductCard(p);
      })
      .join("");

    return (
      '<section class="section products carousel container section-home">' +
        '<div class="header">' +
          '<h2 class="title">' + shelf.title + "</h2>" +
        "</div>" +
        '<div class="content" data-products-carousel="">' +
          '<div class="slick-it">' +
            cards +
          "</div>" +
        "</div>" +
      "</section>"
    );
  }

  function initSlick(container) {
    var el = container.querySelector(".slick-it");
    if (!el) return;

    // Wait for jQuery + Slick to be available
    function tryInit() {
      if (window.jQuery && jQuery.fn.slick) {
        jQuery(el).slick({
          dots: true,
          arrows: true,
          slidesToShow: 4,
          slidesToScroll: 1,
          responsive: [
            { breakpoint: 1030, settings: { slidesToShow: 4 } },
            { breakpoint: 660, settings: { slidesToShow: 2 } },
          ],
        });
      } else {
        // Retry after 200ms (Slick may still be loading)
        setTimeout(tryInit, 200);
      }
    }
    tryInit();
  }

  // --- Main ---

  function renderShelf(shelf, products, anchor) {
    var html = buildShelfHTML(shelf, products);
    anchor.innerHTML = html;

    // Init carousel
    initSlick(anchor);

    // Fire GA4 impression
    fireGA4Impression(shelf, products);

    // Attach click handlers
    var links = anchor.querySelectorAll(".apoio-sh a");
    for (var i = 0; i < links.length; i++) {
      (function (link, idx) {
        link.addEventListener("click", function () {
          var card = link.closest(".apoio-sh");
          var pid = card ? card.getAttribute("data-shproductid") : null;
          var product = products[idx] || products.find(function (p) { return p.product_id === pid; });

          if (product) {
            trackEvent("click", pid, shelf.id);
            fireGA4Click(shelf, product, idx);
          }
        });
      })(links[i], Math.floor(i / 2)); // 2 links per card (image + name)
    }

    // Track shelf impression
    trackEvent("impression", null, shelf.id);
  }

  async function init() {
    var pageType = detectPageType();
    if (pageType === "other") return;

    try {
      // Fetch config
      var configData = await fetchConfig(pageType);
      var shelves = configData.shelves || [];

      if (shelves.length === 0) return;

      // Build extra params for product pages
      var extraParams = {};
      if (pageType === "product") {
        var pid = extractProductId();
        if (pid) {
          extraParams.product_id = pid;
          // Track product pageview
          trackEvent("pageview", pid, null);
        }
      }

      // Fetch all recommendations in parallel
      var promises = shelves.map(function (shelf) {
        return fetchRecommend(shelf.algorithm, shelf.max_products, extraParams)
          .then(function (data) {
            return { shelf: shelf, products: data.products || [] };
          })
          .catch(function () {
            return { shelf: shelf, products: [] };
          });
      });

      var results = await Promise.all(promises);

      // Render each shelf
      results.forEach(function (result) {
        if (result.products.length === 0) return;

        var selector =
          result.shelf.anchor_selector ||
          "#smarthint-position-" + result.shelf.position;
        var anchor = document.querySelector(selector);

        if (anchor) {
          renderShelf(result.shelf, result.products, anchor);
        }
      });

      // Installment calculation (Bulking config)
      try {
        var valorMinimoParcela = 12.72;
        var numeroMaximoParcelas = 6;
        var installmentEls = document.querySelectorAll(
          ".apoio-sh .max_installments"
        );
        for (var j = 0; j < installmentEls.length; j++) {
          var val = parseFloat(installmentEls[j].getAttribute("value"));
          if (val && val > valorMinimoParcela) {
            var parcelas = Math.min(
              Math.floor(val / valorMinimoParcela),
              numeroMaximoParcelas
            );
            if (parcelas >= 2) {
              var valorParcela = (val / parcelas).toFixed(2).replace(".", ",");
              installmentEls[j].textContent =
                "Ou em " + parcelas + "x de R$ " + valorParcela + " sem juros";
            }
          }
        }
      } catch (e) {
        // ignore installment errors
      }
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
