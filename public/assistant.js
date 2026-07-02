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
  var SS_NAME = "bkAssistName";
  var SS_TEASER = "bkAssistTeaser";

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
    var ASK_NAME = config.ask_name !== false;

    var busy = false;
    var msgs = loadMsgs();
    var customerName = ssGet(SS_NAME) || "";

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

    // Estado inicial: retoma sessão, ou pede o nome, ou já mostra boas-vindas
    if (msgs.length > 0) {
      for (var i = 0; i < msgs.length; i++) {
        addBubble(msgs[i].role, msgs[i].text, msgs[i].products || null, false, {
          whatsapp: !!msgs[i].wa,
          messageId: msgs[i].mid || null,
          feedback: msgs[i].fb || 0,
        });
      }
    } else if (ASK_NAME && !customerName) {
      addBubble("assistant", WELCOME, null, false);
      showNameGate();
    } else {
      addBubble("assistant", WELCOME, null, false);
      renderChips();
    }

    // --- Etapa de captura de nome (antes de liberar o chat) ---
    function showNameGate() {
      form.style.display = "none";
      chips.innerHTML = "";
      var gate = document.createElement("form");
      gate.id = "bk-assist-namegate";
      gate.innerHTML =
        '<label for="bk-assist-name">Como podemos te chamar?</label>' +
        '<div class="bk-assist-namerow">' +
        '<input id="bk-assist-name" type="text" maxlength="40" placeholder="Seu nome" autocomplete="given-name" />' +
        '<button type="submit">Começar</button>' +
        "</div>";
      chips.appendChild(gate);
      var nameInput = gate.querySelector("#bk-assist-name");
      try {
        nameInput.focus();
      } catch (e) {
        /* ignore */
      }
      gate.addEventListener("submit", function (ev) {
        ev.preventDefault();
        submitName(nameInput.value, gate, nameInput);
      });
    }

    function submitName(raw, gate, nameInput) {
      // Primeiro nome: letras (com acento), sem dígitos, máx 40 chars
      var cleaned = String(raw || "").replace(/\s+/g, " ").trim();
      var first = cleaned.split(" ")[0] || "";
      if (!first || /\d/.test(cleaned) || !/^[A-Za-zÀ-ÿ'’-]{1,40}$/.test(first)) {
        nameInput.value = "";
        nameInput.setAttribute("placeholder", "Digite só o seu nome");
        try {
          nameInput.focus();
        } catch (e) {
          /* ignore */
        }
        return;
      }
      customerName = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
      ssSet(SS_NAME, customerName);
      if (gate && gate.parentNode) gate.parentNode.removeChild(gate);
      form.style.display = "";
      addBubble(
        "assistant",
        "Prazer, " + customerName + "! Me conta: o que você procura ou qual sua dúvida?",
        null,
        false
      );
      renderChips();
      try {
        input.focus();
      } catch (e) {
        /* ignore */
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

    // --- Abrir/fechar (mobile: tela cheia + trava o scroll da página) ---

    function isMobile() {
      return window.innerWidth < 768;
    }

    var savedScrollY = 0;
    function lockScroll() {
      if (!isMobile()) return;
      savedScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
      document.body.style.position = "fixed";
      document.body.style.top = -savedScrollY + "px";
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.width = "100%";
    }
    function unlockScroll() {
      if (document.body.style.position !== "fixed") return;
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";
      window.scrollTo(0, savedScrollY);
    }

    // Teclado no iOS/Android: prende o painel EXATAMENTE no viewport visível
    // (altura + deslocamento). Sem isso o iOS deixa o input atrás do teclado
    // ou da barra do Safari.
    function vvResize() {
      try {
        if (!isMobile() || panel.className !== "-open") return;
        var vv = window.visualViewport;
        if (!vv) return;
        panel.style.height = Math.round(vv.height) + "px";
        panel.style.transform =
          "translateY(" + Math.round(vv.offsetTop || 0) + "px)";
        body.scrollTop = body.scrollHeight;
      } catch (e) {
        /* ignore */
      }
    }
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", vvResize);
      window.visualViewport.addEventListener("scroll", vvResize);
    }

    function open() {
      hideTeaser();
      closeHub();
      panel.className = "-open";
      launcher.className = "-hidden";
      document.body.classList.add("bk-assist-open");
      lockScroll();
      vvResize();
      body.scrollTop = body.scrollHeight;
      // Desktop: foca direto. Mobile: deixa o cliente tocar (evita o teclado
      // pular na cara antes de ele ler a mensagem).
      if (!isMobile()) {
        try {
          input.focus();
        } catch (e) {
          /* ignore */
        }
      }
    }
    function close() {
      try {
        input.blur(); // solta o teclado no mobile antes de fechar
      } catch (e) {
        /* ignore */
      }
      panel.className = "";
      panel.style.height = "";
      panel.style.transform = "";
      if (!hubMode) launcher.className = "";
      document.body.classList.remove("bk-assist-open");
      unlockScroll();
    }

    launcher.addEventListener("click", open);
    panel.querySelector("#bk-assist-close").addEventListener("click", close);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      sendMessage(input.value);
    });

    // --- Hub de ajuda: substitui a aba lateral "Ajuda" (widget mbz/WhatsApp) ---
    // Em vez de interceptar cliques do widget de terceiro (frágil), escondemos
    // a aba original via CSS e renderizamos a NOSSA, visualmente igual. O clique
    // abre um menu: Assistente (resposta na hora) ou WhatsApp (dispara o botão
    // real do mbz escondido; fallback = link oficial da loja).
    var MBZ_WRAPPER = "[data-mbz-button-popup-wrapper]";
    var WA_FALLBACK = "https://wa.me/5562942630062"; // WhatsApp oficial (site /p/atendimento)
    var hubMode = false;
    var hubEl = null;

    var CHAT_ICON =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
    var WA_ICON =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>';

    function triggerWhatsApp() {
      try {
        var mbzTab = document.querySelector(MBZ_WRAPPER);
        var btn = mbzTab ? mbzTab.querySelector("[data-mbz-popup-button]") : null;
        if (btn) {
          btn.click();
          return;
        }
      } catch (e) {
        /* cai no fallback */
      }
      try {
        window.open(WA_FALLBACK, "_blank", "noopener");
      } catch (e) {
        /* ignore */
      }
    }

    function buildHub() {
      if (hubEl) return hubEl;
      hubEl = document.createElement("div");
      hubEl.id = "bk-assist-hub";
      hubEl.innerHTML =
        '<div id="bk-assist-hub-backdrop"></div>' +
        '<div id="bk-assist-hub-sheet" role="dialog" aria-label="Ajuda">' +
        '<div id="bk-assist-hub-head"><strong>Como podemos te ajudar?</strong>' +
        '<button type="button" id="bk-assist-hub-close" aria-label="Fechar">&times;</button></div>' +
        '<button type="button" class="bk-assist-hub-opt" data-opt="assistant">' +
        '<span class="bk-assist-hub-ico -dark">' + CHAT_ICON + "</span>" +
        '<span class="bk-assist-hub-txt"><strong>Assistente da loja <em>resposta na hora</em></strong>' +
        "<span>Tamanho ideal, tecido, disponibilidade e sugestões de peças. Pergunte e resolva em segundos, sem sair da página.</span></span>" +
        '<svg class="bk-assist-hub-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>' +
        "</button>" +
        '<button type="button" class="bk-assist-hub-opt" data-opt="whatsapp">' +
        '<span class="bk-assist-hub-ico -wa">' + WA_ICON + "</span>" +
        '<span class="bk-assist-hub-txt"><strong>WhatsApp</strong>' +
        "<span>Falar com nossa equipe sobre pedidos, trocas e outros assuntos.</span></span>" +
        '<svg class="bk-assist-hub-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>' +
        "</button>" +
        "</div>";
      document.body.appendChild(hubEl);
      hubEl.querySelector("#bk-assist-hub-backdrop").addEventListener("click", closeHub);
      hubEl.querySelector("#bk-assist-hub-close").addEventListener("click", closeHub);
      hubEl
        .querySelector('[data-opt="assistant"]')
        .addEventListener("click", function () {
          closeHub();
          open();
        });
      hubEl
        .querySelector('[data-opt="whatsapp"]')
        .addEventListener("click", function () {
          closeHub();
          triggerWhatsApp();
        });
      return hubEl;
    }

    function openHub() {
      hideTeaser();
      buildHub().className = "-open";
    }
    function closeHub() {
      if (hubEl) hubEl.className = "";
    }

    function setupHelpTab() {
      hubMode = true;
      launcher.className = "-hidden";
      // Esconde a aba mbz original (a nossa assume o lugar)
      document.documentElement.classList.add("bk-assist-hub-on");
      var tab = document.createElement("button");
      tab.id = "bk-assist-tab";
      tab.type = "button";
      tab.setAttribute("aria-label", "Ajuda");
      tab.innerHTML =
        "<span id='bk-assist-tab-label'>Ajuda</span><span id='bk-assist-tab-ico'>" +
        CHAT_ICON +
        "</span>";
      document.body.appendChild(tab);
      tab.addEventListener("click", openHub);
    }

    // --- Teaser proativo (1x por sessão): torna o assistente visível mesmo
    // morando dentro do "Ajuda" ---
    var teaserEl = null;
    function hideTeaser() {
      if (teaserEl && teaserEl.parentNode) teaserEl.parentNode.removeChild(teaserEl);
      teaserEl = null;
    }
    function maybeShowTeaser() {
      if (ssGet(SS_TEASER)) return;
      setTimeout(function () {
        try {
          if (panel.className === "-open") return;
          if (hubEl && hubEl.className === "-open") return;
          ssSet(SS_TEASER, "1");
          teaserEl = document.createElement("div");
          teaserEl.id = "bk-assist-teaser";
          teaserEl.innerHTML =
            '<button type="button" id="bk-assist-teaser-x" aria-label="Dispensar">&times;</button>' +
            "<strong>Dúvida de tamanho ou tecido?</strong>" +
            "<span>Pergunta aqui e resolve na hora.</span>";
          document.body.appendChild(teaserEl);
          teaserEl.addEventListener("click", function (ev) {
            var isX = ev.target && ev.target.id === "bk-assist-teaser-x";
            hideTeaser();
            if (!isX) open();
          });
          setTimeout(hideTeaser, 15000);
        } catch (e) {
          /* ignore */
        }
      }, 8000);
    }

    setupHelpTab();
    maybeShowTeaser();

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

    function addBubble(role, text, products, persist, opts) {
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

      // Modelo direcionou pro atendimento → botão direto pro WhatsApp
      if (opts && opts.whatsapp) {
        var waBtn = document.createElement("button");
        waBtn.type = "button";
        waBtn.className = "bk-assist-wa-btn";
        waBtn.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>' +
          "<span>Falar no WhatsApp</span>";
        waBtn.addEventListener("click", triggerWhatsApp);
        wrap.appendChild(waBtn);
      }

      // Feedback 👍/👎 nas respostas do assistente (monitoramento de satisfação)
      if (role === "assistant" && opts && opts.messageId) {
        wrap.appendChild(buildFeedbackRow(opts.messageId, opts.feedback || 0));
      }

      body.appendChild(wrap);
      body.scrollTop = body.scrollHeight;

      if (persist !== false) {
        msgs.push({
          role: role,
          text: text,
          products: products || null,
          wa: !!(opts && opts.whatsapp),
          mid: (opts && opts.messageId) || null,
          fb: (opts && opts.feedback) || 0,
        });
        saveMsgs(msgs);
      }
    }

    function buildFeedbackRow(messageId, current) {
      var row = document.createElement("div");
      row.className = "bk-assist-fb" + (current ? " -done" : "");
      row.innerHTML =
        '<button type="button" data-fb="1" aria-label="Resposta útil"' +
        (current === 1 ? ' class="-sel"' : "") +
        '><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg></button>' +
        '<button type="button" data-fb="-1" aria-label="Resposta não útil"' +
        (current === -1 ? ' class="-sel"' : "") +
        '><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path></svg></button>';
      row.addEventListener("click", function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest("[data-fb]") : null;
        if (!btn || row.className.indexOf("-done") !== -1) return;
        var rating = parseInt(btn.getAttribute("data-fb"), 10);
        btn.className = "-sel";
        row.className = "bk-assist-fb -done";
        sendFeedback(messageId, rating);
        // atualiza a cópia persistida pra restaurar o estado ao reabrir
        for (var i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].mid === messageId) {
            msgs[i].fb = rating;
            break;
          }
        }
        saveMsgs(msgs);
      });
      return row;
    }

    function sendFeedback(messageId, rating) {
      try {
        var session = ssGet(SS_SESSION);
        if (!session || !messageId) return;
        fetch(API_BASE + "/api/assistant/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: API_KEY,
            session_id: session,
            message_id: messageId,
            rating: rating,
          }),
        }).catch(function () {
          /* silêncio */
        });
      } catch (e) {
        /* ignore */
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
      if (customerName) payload.customer_name = customerName;
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
            addBubble("assistant", data.reply, data.products || null, true, {
              whatsapp: data.whatsapp === true,
              messageId: data.message_id || null,
            });
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
      // ===== Launcher (fallback quando não há aba de Ajuda) =====
      "#bk-assist-launcher{position:fixed;right:20px;bottom:20px;z-index:2147483200;width:56px;height:56px;border-radius:50%;background:#111;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 24px rgba(0,0,0,.28);transition:transform .18s ease}" +
      "#bk-assist-launcher:hover{transform:scale(1.06)}" +
      "#bk-assist-launcher.-hidden{display:none}" +
      // ===== Aba lateral "Ajuda" (nossa; a mbz original fica escondida) =====
      "html.bk-assist-hub-on [data-mbz-button-popup-wrapper]{display:none!important;visibility:hidden!important;pointer-events:none!important}" +
      "#bk-assist-tab{position:fixed;right:0;bottom:96px;z-index:2147483200;width:44px;height:96px;padding:0;margin:0;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;background:rgba(255,255,255,.97);border:1px solid #d7d7d7;border-right:0;border-radius:10px 0 0 10px;box-shadow:0 6px 14px rgba(0,0,0,.10);cursor:pointer;overflow:hidden;box-sizing:border-box}" +
      "#bk-assist-tab-label{flex:1 1 auto;min-height:52px;display:flex;align-items:center;justify-content:center;color:#222;border-bottom:1px solid #e1e1e1;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:500!important;line-height:1;letter-spacing:.01em;writing-mode:vertical-rl;transform:rotate(180deg)}" +
      "#bk-assist-tab-ico{height:40px;display:flex;align-items:center;justify-content:center}" +
      "#bk-assist-tab-ico svg{width:22px;height:22px;padding:5px;border-radius:999px;background:#111;color:#fff;box-sizing:border-box}" +
      // ===== Teaser proativo =====
      "#bk-assist-teaser{position:fixed;right:54px;bottom:104px;z-index:2147483300;max-width:230px;background:#111;color:#fff;border-radius:14px;padding:12px 34px 12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.30);cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;animation:bkAssistPop .25s ease}" +
      "#bk-assist-teaser strong{display:block;font-size:13px;font-weight:700!important;margin-bottom:2px}" +
      "#bk-assist-teaser span{display:block;font-size:12px;font-weight:400!important;color:#d4d4d4;line-height:1.35}" +
      "#bk-assist-teaser:after{content:'';position:absolute;right:-6px;bottom:18px;width:12px;height:12px;background:#111;transform:rotate(45deg)}" +
      "#bk-assist-teaser-x{position:absolute;top:4px;right:6px;background:none;border:none;color:#999;font-size:18px;line-height:1;cursor:pointer;padding:4px}" +
      "@keyframes bkAssistPop{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:translateY(0)}}" +
      // ===== Hub (menu Assistente x WhatsApp) =====
      "#bk-assist-hub{display:none}" +
      "#bk-assist-hub.-open{display:block}" +
      "#bk-assist-hub-backdrop{position:fixed;inset:0;z-index:2147483643;background:rgba(0,0,0,.45)}" +
      "#bk-assist-hub-sheet{position:fixed;z-index:2147483644;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;box-shadow:0 -10px 40px rgba(0,0,0,.25);right:0;left:0;bottom:0;border-radius:18px 18px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom))}" +
      "@media(min-width:768px){#bk-assist-hub-sheet{left:auto;right:20px;bottom:100px;width:340px;border-radius:16px;box-shadow:0 14px 44px rgba(0,0,0,.28)}}" +
      "#bk-assist-hub-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}" +
      "#bk-assist-hub-head strong{font-size:15px;font-weight:700!important;color:#111}" +
      "#bk-assist-hub-close{background:none;border:none;color:#666;font-size:26px;line-height:1;cursor:pointer;padding:6px 10px;margin:-6px -10px}" +
      ".bk-assist-hub-opt{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:#fff;border:1px solid #e2e2e2;border-radius:14px;padding:13px 12px;cursor:pointer;transition:border-color .15s ease}" +
      ".bk-assist-hub-opt+.bk-assist-hub-opt{margin-top:10px}" +
      ".bk-assist-hub-opt:hover{border-color:#111}" +
      ".bk-assist-hub-ico{width:40px;height:40px;border-radius:999px;display:flex;align-items:center;justify-content:center;flex-shrink:0}" +
      ".bk-assist-hub-ico.-dark{background:#111;color:#fff}" +
      ".bk-assist-hub-ico.-wa{background:#25d366;color:#fff}" +
      ".bk-assist-hub-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}" +
      ".bk-assist-hub-txt strong{font-size:13.5px;font-weight:700!important;color:#111;display:flex;align-items:center;gap:6px;flex-wrap:wrap}" +
      ".bk-assist-hub-txt strong em{font-style:normal;font-weight:700!important;font-size:10px;letter-spacing:.03em;text-transform:uppercase;background:#e7f9d1;color:#3f6212;border-radius:999px;padding:3px 8px}" +
      ".bk-assist-hub-txt>span{font-size:12px;font-weight:400!important;color:#555;line-height:1.4}" +
      ".bk-assist-hub-chev{color:#999;flex-shrink:0}" +
      // ===== Painel do chat =====
      // z-index acima do topbar do shelves (2147483600) — com o chat aberto
      // NADA fica por cima dele
      "#bk-assist-panel{position:fixed;right:20px;bottom:86px;z-index:2147483646;width:376px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 110px);background:#fff;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.30);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}" +
      // O tema da loja herda um peso pesado; forçamos normal e deixamos só
      // strong em negrito (!important vence o CSS do tema).
      "#bk-assist-panel,#bk-assist-panel p,#bk-assist-panel span,#bk-assist-panel div,#bk-assist-panel a,#bk-assist-panel input{font-weight:400!important;letter-spacing:normal}" +
      "#bk-assist-panel strong,#bk-assist-header-txt strong{font-weight:700!important}" +
      "#bk-assist-panel em{font-weight:400!important}" +
      "#bk-assist-panel.-open{display:flex}" +
      // Mobile-first: tela cheia (100dvh), sem raio, nada por cima
      "@media(max-width:767px){#bk-assist-panel{right:0;left:0;top:0;bottom:0!important;width:100%;max-width:100%;height:100vh;height:100dvh;max-height:none;border-radius:0}}" +
      // Com o chat aberto, nada sobrepõe: some aba, teaser, mbz e whatsapp
      // (em qualquer tela — ficam atrás/do lado do chat)
      "body.bk-assist-open #bk-assist-tab,body.bk-assist-open #bk-assist-teaser,body.bk-assist-open [data-mbz-button-popup-wrapper],body.bk-assist-open .whatsapp,body.bk-assist-open [class*='stories-video-planweb']{display:none!important}" +
      // SÓ NO MOBILE (chat em tela cheia): some também buybar e topbar (fixo
      // no top, empurrava o chat e escondia o campo de texto). No desktop o
      // chat é um card no canto — topbar e buybar continuam visíveis.
      "@media(max-width:767px){body.bk-assist-open #bk-sticky-buy,body.bk-assist-open #vtx-topbar,body.bk-assist-open .top-bar,body.bk-assist-open section.top-bar{display:none!important}}" +
      // Buybar visível → aba/teaser/launcher sobem (fallback imediato; o
      // shelves.js depois ajusta o valor exato via inline style)
      "@media(max-width:767px){body.bk-buybar-on #bk-assist-tab{bottom:150px!important}body.bk-buybar-on #bk-assist-teaser{bottom:158px!important}body.bk-buybar-on #bk-assist-launcher{bottom:150px!important}}" +
      "#bk-assist-header{background:#111;color:#fff;padding:12px 8px 12px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;min-height:56px;box-sizing:border-box}" +
      "#bk-assist-header-txt{display:flex;flex-direction:column;gap:2px}" +
      "#bk-assist-header-txt strong{font-size:15px;font-weight:700;letter-spacing:.2px}" +
      "#bk-assist-header-txt span{font-size:11px;color:#a3e635;display:flex;align-items:center;gap:4px}" +
      "#bk-assist-header-txt span:before{content:'';width:6px;height:6px;border-radius:50%;background:#a3e635}" +
      // Alvo de toque 44px pro fechar (mobile-first)
      "#bk-assist-close{background:none;border:none;color:#fff;font-size:28px;line-height:1;cursor:pointer;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:10px}" +
      "#bk-assist-close:active{background:rgba(255,255,255,.14)}" +
      "#bk-assist-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:16px 12px;background:#f6f6f6;display:flex;flex-direction:column;gap:10px}" +
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
      // Botão WhatsApp (quando o assistente direciona pro atendimento)
      ".bk-assist-wa-btn{display:flex;align-items:center;justify-content:center;gap:8px;background:#25d366;color:#fff;border:none;border-radius:12px;padding:11px 14px;font-size:13px;font-weight:600!important;cursor:pointer;transition:filter .15s ease}" +
      ".bk-assist-wa-btn:hover{filter:brightness(.95)}" +
      ".bk-assist-wa-btn span{font-weight:600!important}" +
      // Feedback 👍/👎 discreto sob a resposta
      ".bk-assist-fb{display:flex;gap:4px;margin-top:-2px}" +
      ".bk-assist-fb button{background:none;border:none;padding:5px;cursor:pointer;color:#b3b3b3;border-radius:8px;display:flex;align-items:center;justify-content:center}" +
      ".bk-assist-fb button:hover{color:#111;background:#ececec}" +
      ".bk-assist-fb button.-sel{color:#111;background:#e4e4e4}" +
      ".bk-assist-fb.-done button{pointer-events:none;opacity:.55}" +
      ".bk-assist-fb.-done button.-sel{opacity:1}" +
      "#bk-assist-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px;background:#f6f6f6;flex-shrink:0}" +
      "#bk-assist-chips:empty{padding:0}" +
      ".bk-assist-chip{background:#fff;border:1px solid #d9d9d9;border-radius:999px;padding:7px 12px;font-size:12px;color:#111;cursor:pointer;transition:border-color .15s ease}" +
      ".bk-assist-chip:hover{border-color:#111}" +
      "#bk-assist-namegate{width:100%;padding:0 12px 10px;background:#f6f6f6}" +
      "#bk-assist-namegate label{display:block;font-size:12px;color:#555;margin-bottom:6px}" +
      ".bk-assist-namerow{display:flex;gap:8px}" +
      "#bk-assist-name{flex:1;border:1px solid #d9d9d9;border-radius:999px;padding:10px 14px;font-size:13.5px;outline:none;color:#111;background:#fff}" +
      "#bk-assist-name:focus{border-color:#111}" +
      "#bk-assist-namegate button{background:#111;color:#fff;border:none;border-radius:999px;padding:0 18px;font-size:13px;cursor:pointer;white-space:nowrap}" +
      "#bk-assist-form{display:flex;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid #ececec;flex-shrink:0}" +
      "#bk-assist-input{flex:1;min-width:0;border:1px solid #d9d9d9;border-radius:999px;padding:10px 14px;font-size:13.5px;outline:none;color:#111;background:#fff;-webkit-appearance:none;appearance:none}" +
      "#bk-assist-input:focus{border-color:#111}" +
      "#bk-assist-send{width:44px;height:44px;border-radius:50%;background:#111;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}" +
      "#bk-assist-send:active{transform:scale(.94)}" +
      "#bk-assist-foot{text-align:center;font-size:10px;color:#999;padding:0 12px 8px;background:#fff;flex-shrink:0}" +
      // Mobile: fonte 16px no input (iOS não dá zoom) + safe area embaixo
      "@media(max-width:767px){#bk-assist-input,#bk-assist-name{font-size:16px}#bk-assist-foot{padding-bottom:calc(8px + env(safe-area-inset-bottom))}#bk-assist-form{padding-bottom:10px}}" +
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
