/**
 * Bulking — Assistente de Vendas (widget de chat na PDP)
 *
 * Carregado pelo shelves.js em páginas de produto. Usa as mesmas globals:
 *   window._shelvesKey  — API key pública
 *   window._shelvesBase — base do dashboard (https://dash.bulking.com.br)
 *
 * O widget se auto-desliga silenciosamente se o assistente não estiver
 * habilitado para o produto da página (config no dashboard). Qualquer erro
 * aqui NUNCA pode quebrar a loja — tudo roda dentro de try/catch.
 *
 * Segurança: este arquivo não contém segredo algum. Toda a inteligência
 * (LLM, catálogo, limites) vive no servidor.
 */
(function () {
  "use strict";

  try {
    if (window.__bkAssistantLoaded) return;
    window.__bkAssistantLoaded = true;
  } catch (e) {
    return;
  }

  var API_KEY = window._shelvesKey || null;
  var API_BASE = window._shelvesBase || null;

  if (!API_BASE) {
    try {
      var scripts = document.getElementsByTagName("script");
      for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].src || "";
        if (src.indexOf("assistant.js") !== -1) {
          API_BASE = src.replace(/\/assistant\.js.*$/, "");
          break;
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  if (!API_KEY || !API_BASE) return;

  // --- Detecção de produto (mesma estratégia do shelves.js) ---

  function extractProductId() {
    try {
      var meta = document.querySelector('meta[property="product:retailer_item_id"]');
      if (meta && meta.content) return String(meta.content);

      var rmkt = document.getElementById("rmkt-product-id");
      if (rmkt && rmkt.value) return String(rmkt.value);

      var el = document.querySelector(
        ".product-section [data-product-id], .main-product [data-product-id], #product-form [data-product-id]"
      );
      if (el) return String(el.getAttribute("data-product-id"));

      var jsonScripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < jsonScripts.length; i++) {
        var content = jsonScripts[i].textContent || "";
        if (content.indexOf('"Product"') === -1) continue;
        try {
          var ld = JSON.parse(content);
          var nodes = Array.isArray(ld) ? ld : [ld];
          for (var j = 0; j < nodes.length; j++) {
            if (nodes[j] && nodes[j]["@type"] === "Product") {
              if (nodes[j].productID) return String(nodes[j].productID);
              if (nodes[j].sku) return String(nodes[j].sku);
            }
          }
        } catch (e) {
          /* ignore parse */
        }
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  var PRODUCT_ID = extractProductId();
  if (!PRODUCT_ID) return; // v1: só em PDP

  // --- Sessão (sessionStorage: some ao fechar a aba — sem tracking persistente) ---

  var SS_SESSION = "bkAssistSession";
  var SS_MSGS = "bkAssistMsgs";

  function ssGet(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function ssSet(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch (e) {
      /* ignore */
    }
  }

  function loadMsgs() {
    try {
      var raw = ssGet(SS_MSGS);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(-40) : [];
    } catch (e) {
      return [];
    }
  }
  function saveMsgs(msgs) {
    try {
      ssSet(SS_MSGS, JSON.stringify(msgs.slice(-40)));
    } catch (e) {
      /* ignore */
    }
  }

  // --- Config ---

  function fetchJSON(url, options) {
    return fetch(url, options).then(function (res) {
      return res.json().then(function (data) {
        return { status: res.status, data: data };
      });
    });
  }

  var configUrl =
    API_BASE +
    "/api/assistant/config?key=" +
    encodeURIComponent(API_KEY) +
    "&product_id=" +
    encodeURIComponent(PRODUCT_ID);

  fetchJSON(configUrl)
    .then(function (res) {
      if (res.status !== 200 || !res.data || res.data.enabled !== true) return;
      try {
        init(res.data);
      } catch (e) {
        /* nunca quebrar a loja */
      }
    })
    .catch(function () {
      /* silêncio */
    });

  // --- UI ---

  function init(config) {
    var TITLE = config.title || "Assistente";
    var WELCOME = config.welcome_message || "Como posso ajudar?";
    var SUGGESTIONS = Array.isArray(config.suggestions) ? config.suggestions.slice(0, 4) : [];

    var busy = false;
    var msgs = loadMsgs();

    injectStyles();

    // Launcher
    var launcher = document.createElement("button");
    launcher.id = "bk-assist-launcher";
    launcher.setAttribute("aria-label", "Abrir assistente da loja");
    launcher.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
    document.body.appendChild(launcher);

    // Ajusta posição se a barra de compra mobile ou o botão de WhatsApp do tema existirem
    function adjustLauncherPosition() {
      try {
        var bottom = 20;
        var stickyBuy = document.getElementById("bk-sticky-buy");
        if (stickyBuy && window.innerWidth < 768) bottom = 92;
        else if (document.querySelector(".whatsapp")) bottom = 92;
        launcher.style.bottom = bottom + "px";
        panel.style.bottom = window.innerWidth < 768 ? "0" : bottom + 66 + "px";
      } catch (e) {
        /* ignore */
      }
    }

    // Panel
    var panel = document.createElement("div");
    panel.id = "bk-assist-panel";
    panel.innerHTML =
      '<div id="bk-assist-header">' +
      '<div id="bk-assist-header-txt"><strong>' +
      escapeHtml(TITLE) +
      "</strong><span>online agora</span></div>" +
      '<button id="bk-assist-close" aria-label="Fechar">&times;</button>' +
      "</div>" +
      '<div id="bk-assist-body"></div>' +
      '<div id="bk-assist-chips"></div>' +
      '<form id="bk-assist-form">' +
      '<input id="bk-assist-input" type="text" maxlength="500" placeholder="Escreva sua dúvida..." autocomplete="off" />' +
      '<button id="bk-assist-send" type="submit" aria-label="Enviar">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>' +
      "</button>" +
      '</form>' +
      '<div id="bk-assist-foot">respostas geradas por IA &middot; não compartilhe dados pessoais</div>';
    document.body.appendChild(panel);

    var body = panel.querySelector("#bk-assist-body");
    var chips = panel.querySelector("#bk-assist-chips");
    var form = panel.querySelector("#bk-assist-form");
    var input = panel.querySelector("#bk-assist-input");

    adjustLauncherPosition();
    window.addEventListener("resize", adjustLauncherPosition);

    // Restaura conversa da sessão ou mostra boas-vindas
    if (msgs.length === 0) {
      addBubble("assistant", WELCOME, null, false);
      renderChips();
    } else {
      for (var i = 0; i < msgs.length; i++) {
        addBubble(msgs[i].role, msgs[i].text, msgs[i].products || null, false);
      }
    }

    function renderChips() {
      chips.innerHTML = "";
      if (!SUGGESTIONS.length) return;
      for (var i = 0; i < SUGGESTIONS.length; i++) {
        (function (text) {
          var chip = document.createElement("button");
          chip.className = "bk-assist-chip";
          chip.type = "button";
          chip.textContent = text;
          chip.addEventListener("click", function () {
            sendMessage(text);
          });
          chips.appendChild(chip);
        })(SUGGESTIONS[i]);
      }
    }

    function open() {
      panel.className = "-open";
      launcher.className = "-hidden";
      try {
        input.focus();
      } catch (e) {
        /* ignore */
      }
    }
    function close() {
      panel.className = "";
      launcher.className = "";
    }

    launcher.addEventListener("click", open);
    panel.querySelector("#bk-assist-close").addEventListener("click", close);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      sendMessage(input.value);
    });

    // Escapa para uso seguro em TEXTO e em ATRIBUTO (aspas incluídas).
    // textContent→innerHTML não escapa " nem ' — sem isso um valor com aspas
    // (ex.: image_url) escaparia do atributo e viraria XSS.
    function escapeHtml(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    // Só permite http(s) em href/src — bloqueia javascript:, data:, etc.
    function safeUrl(u) {
      var s = String(u == null ? "" : u).trim();
      return /^https?:\/\//i.test(s) ? s : "";
    }

    // Markdown mínimo → HTML seguro. Escapa ANTES de qualquer transformação,
    // então os únicos <strong>/<em>/<br> no resultado são os que criamos aqui.
    function renderMarkdown(raw) {
      var s = escapeHtml(raw);
      // **negrito** e __negrito__
      s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
      // *itálico* (evita casar bullets " * " — exige colado ao texto)
      s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, "$1<em>$2</em>");
      // bullets "- " ou "* " no início da linha → •
      s = s.replace(/^[ \t]*[-*][ \t]+/gm, "• ");
      // quebras de linha
      s = s.replace(/\n/g, "<br>");
      return s;
    }

    function formatPrice(n) {
      try {
        return "R$ " + Number(n).toFixed(2).replace(".", ",");
      } catch (e) {
        return "";
      }
    }

    function addBubble(role, text, products, persist) {
      var wrap = document.createElement("div");
      wrap.className = "bk-assist-msg -" + role;

      var bubble = document.createElement("div");
      bubble.className = "bk-assist-bubble";
      // Markdown básico e SEGURO: escapa tudo primeiro (nenhum HTML do LLM
      // sobrevive), depois reintroduz só <strong>/<em>/quebras que nós criamos.
      bubble.innerHTML = renderMarkdown(String(text || ""));
      wrap.appendChild(bubble);

      if (products && products.length) {
        for (var j = 0; j < products.length; j++) {
          var p = products[j];
          if (!p) continue;
          var cardUrl = safeUrl(p.url);
          if (!cardUrl) continue;
          var cardImg = safeUrl(p.image_url);
          var card = document.createElement("a");
          card.className = "bk-assist-card";
          card.setAttribute("href", cardUrl);
          card.setAttribute("target", "_blank");
          card.setAttribute("rel", "noopener");
          var priceHtml = "";
          var hasSale =
            p.sale_price != null && p.price != null && Number(p.sale_price) < Number(p.price);
          if (hasSale) {
            priceHtml =
              '<span class="bk-assist-old">' + escapeHtml(formatPrice(p.price)) + "</span> <strong>" +
              escapeHtml(formatPrice(p.sale_price)) + "</strong>";
          } else if (p.price != null || p.sale_price != null) {
            priceHtml =
              "<strong>" +
              escapeHtml(formatPrice(p.sale_price != null ? p.sale_price : p.price)) +
              "</strong>";
          }
          card.innerHTML =
            (cardImg
              ? '<img src="' + escapeHtml(cardImg) + '" alt="" loading="lazy" />'
              : '<span class="bk-assist-card-noimg"></span>') +
            '<span class="bk-assist-card-info"><span class="bk-assist-card-name">' +
            escapeHtml(p.name || "") +
            '</span><span class="bk-assist-card-price">' +
            priceHtml +
            (p.available === false ? ' <i>esgotado</i>' : "") +
            "</span></span>" +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
          wrap.appendChild(card);
        }
      }

      body.appendChild(wrap);
      body.scrollTop = body.scrollHeight;

      if (persist !== false) {
        msgs.push({ role: role, text: text, products: products || null });
        saveMsgs(msgs);
      }
    }

    function showTyping() {
      var t = document.createElement("div");
      t.className = "bk-assist-msg -assistant";
      t.id = "bk-assist-typing";
      t.innerHTML =
        '<div class="bk-assist-bubble bk-assist-typing"><span></span><span></span><span></span></div>';
      body.appendChild(t);
      body.scrollTop = body.scrollHeight;
    }
    function hideTyping() {
      var t = document.getElementById("bk-assist-typing");
      if (t && t.parentNode) t.parentNode.removeChild(t);
    }

    function sendMessage(raw) {
      var text = String(raw || "").replace(/\s+/g, " ").trim();
      if (!text || busy) return;
      if (text.length > 500) text = text.slice(0, 500);

      busy = true;
      input.value = "";
      chips.innerHTML = "";
      addBubble("user", text, null, true);
      showTyping();

      var payload = {
        key: API_KEY,
        product_id: PRODUCT_ID,
        page_url: String(window.location.href).slice(0, 300),
        message: text,
      };
      var session = ssGet(SS_SESSION);
      if (session) payload.session_id = session;

      fetchJSON(API_BASE + "/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          hideTyping();
          busy = false;
          var data = res.data || {};
          if (data.session_id) ssSet(SS_SESSION, data.session_id);
          if (data.reply) {
            addBubble("assistant", data.reply, data.products || null, true);
          } else {
            addBubble(
              "assistant",
              "Não consegui responder agora. Tenta de novo em instantes.",
              null,
              false
            );
          }
        })
        .catch(function () {
          hideTyping();
          busy = false;
          addBubble(
            "assistant",
            "Sem conexão agora. Verifica sua internet e tenta de novo.",
            null,
            false
          );
        });
    }
  }

  // --- Estilos (preto/branco Bulking; z-index alto p/ ficar sobre o tema) ---

  function injectStyles() {
    var css =
      "#bk-assist-launcher{position:fixed;right:20px;bottom:20px;z-index:999998;width:56px;height:56px;border-radius:50%;background:#111;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 24px rgba(0,0,0,.28);transition:transform .18s ease}" +
      "#bk-assist-launcher:hover{transform:scale(1.06)}" +
      "#bk-assist-launcher.-hidden{display:none}" +
      "#bk-assist-panel{position:fixed;right:20px;bottom:86px;z-index:999999;width:376px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 110px);background:#fff;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.30);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}" +
      // O tema da loja herda um peso pesado; forçamos normal e deixamos só
      // strong em negrito (!important vence o CSS do tema).
      "#bk-assist-panel,#bk-assist-panel p,#bk-assist-panel span,#bk-assist-panel div,#bk-assist-panel a,#bk-assist-panel input{font-weight:400!important;letter-spacing:normal}" +
      "#bk-assist-panel strong,#bk-assist-header-txt strong{font-weight:700!important}" +
      "#bk-assist-panel em{font-weight:400!important}" +
      "#bk-assist-panel.-open{display:flex}" +
      "@media(max-width:767px){#bk-assist-panel{right:0;left:0;bottom:0!important;width:100%;max-width:100%;height:82vh;max-height:82vh;border-radius:16px 16px 0 0}}" +
      "#bk-assist-header{background:#111;color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}" +
      "#bk-assist-header-txt{display:flex;flex-direction:column;gap:2px}" +
      "#bk-assist-header-txt strong{font-size:15px;font-weight:700;letter-spacing:.2px}" +
      "#bk-assist-header-txt span{font-size:11px;color:#a3e635;display:flex;align-items:center;gap:4px}" +
      "#bk-assist-header-txt span:before{content:'';width:6px;height:6px;border-radius:50%;background:#a3e635}" +
      "#bk-assist-close{background:none;border:none;color:#fff;font-size:26px;line-height:1;cursor:pointer;padding:0 4px}" +
      "#bk-assist-body{flex:1;overflow-y:auto;padding:16px 12px;background:#f6f6f6;display:flex;flex-direction:column;gap:10px}" +
      ".bk-assist-msg{display:flex;flex-direction:column;gap:8px;max-width:88%}" +
      ".bk-assist-msg.-assistant{align-self:flex-start}" +
      ".bk-assist-msg.-user{align-self:flex-end;align-items:flex-end}" +
      ".bk-assist-bubble{padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.5;word-wrap:break-word}" +
      ".bk-assist-msg.-assistant .bk-assist-bubble{background:#fff;color:#111;border:1px solid #e8e8e8;border-bottom-left-radius:4px}" +
      ".bk-assist-msg.-user .bk-assist-bubble{background:#111;color:#fff;border-bottom-right-radius:4px}" +
      ".bk-assist-card{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e3e3e3;border-radius:12px;padding:8px 10px;text-decoration:none;color:#111;transition:border-color .15s ease}" +
      ".bk-assist-card:hover{border-color:#111}" +
      ".bk-assist-card img,.bk-assist-card-noimg{width:48px;height:60px;object-fit:cover;border-radius:8px;background:#eee;flex-shrink:0}" +
      ".bk-assist-card-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}" +
      ".bk-assist-card-name{font-size:12px;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}" +
      ".bk-assist-card-price{font-size:12.5px}" +
      ".bk-assist-card-price strong{font-weight:700}" +
      ".bk-assist-old{text-decoration:line-through;color:#999;font-size:11px;margin-right:2px}" +
      ".bk-assist-card-price i{font-style:normal;color:#b91c1c;font-size:10.5px;font-weight:600;text-transform:uppercase}" +
      ".bk-assist-card svg{flex-shrink:0;color:#999}" +
      "#bk-assist-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px;background:#f6f6f6;flex-shrink:0}" +
      "#bk-assist-chips:empty{padding:0}" +
      ".bk-assist-chip{background:#fff;border:1px solid #d9d9d9;border-radius:999px;padding:7px 12px;font-size:12px;color:#111;cursor:pointer;transition:border-color .15s ease}" +
      ".bk-assist-chip:hover{border-color:#111}" +
      "#bk-assist-form{display:flex;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid #ececec;flex-shrink:0}" +
      "#bk-assist-input{flex:1;border:1px solid #d9d9d9;border-radius:999px;padding:10px 14px;font-size:13.5px;outline:none;color:#111;background:#fff}" +
      "#bk-assist-input:focus{border-color:#111}" +
      "#bk-assist-send{width:40px;height:40px;border-radius:50%;background:#111;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}" +
      "#bk-assist-foot{text-align:center;font-size:10px;color:#999;padding:0 12px 8px;background:#fff;flex-shrink:0}" +
      ".bk-assist-typing{display:flex;gap:4px;align-items:center;min-height:20px}" +
      ".bk-assist-typing span{width:7px;height:7px;border-radius:50%;background:#bbb;animation:bkAssistDot 1.2s infinite}" +
      ".bk-assist-typing span:nth-child(2){animation-delay:.2s}" +
      ".bk-assist-typing span:nth-child(3){animation-delay:.4s}" +
      "@keyframes bkAssistDot{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}";

    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }
})();
