/* eslint-disable */
(function () {
  "use strict";

  // ----- Config (passada via window globals, idem shelves.js) -----
  var API_KEY = window._topbarKey || window._shelvesKey;
  var API_BASE = (window._topbarBase || window._shelvesBase || "").replace(/\/$/, "");
  if (!API_KEY || !API_BASE) {
    // Silencioso — admin ainda não configurou
    return;
  }

  // ----- Page type detection (mesma lógica do shelves.js) -----
  function detectPageType() {
    var path = window.location.pathname.toLowerCase();
    var body = document.body;

    // GUARD DUPLO: cart/checkout NUNCA renderiza. Mesmo que o servidor falhe
    // em filtrar, esse early-return garante que a topbar não aparece.
    if (/\/(carrinho|cart|checkout|finalizar|fechamento|pagamento)/.test(path)) {
      return "cart";
    }

    if (path === "/" || path === "/home" || path === "") return "home";
    if (
      body &&
      (body.classList.contains("page-product") ||
        body.getAttribute("data-page") === "product")
    ) {
      return "product";
    }
    if (
      body &&
      (body.classList.contains("page-tag") ||
        body.classList.contains("page-category") ||
        body.getAttribute("data-page") === "tag" ||
        body.getAttribute("data-page") === "category")
    ) {
      return "category";
    }
    if (/\/(produto|product|p)\//.test(path)) return "product";
    if (/\/(categoria|category|c)\//.test(path)) return "category";

    return "other";
  }

  var pageType = detectPageType();
  // Hard guard: cart/checkout abortam antes de qualquer fetch
  if (pageType === "cart") return;

  // ----- Session id (compartilha com shelves se existir) -----
  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  var sessionId;
  try {
    sessionId = sessionStorage.getItem("_vtx_sid");
    if (!sessionId) {
      sessionId = uuid();
      sessionStorage.setItem("_vtx_sid", sessionId);
    }
  } catch (e) {
    sessionId = uuid();
  }

  // ----- Dismissal storage -----
  function dismissalKey(campaignId) {
    return "_vtx_topbar_dismissed_" + campaignId;
  }
  function isDismissed(campaignId, hoursValid) {
    try {
      var v = localStorage.getItem(dismissalKey(campaignId));
      if (!v) return false;
      var when = parseInt(v, 10);
      if (isNaN(when)) return false;
      var ageHours = (Date.now() - when) / 3600000;
      return ageHours < (hoursValid || 24);
    } catch (e) {
      return false;
    }
  }
  function markDismissed(campaignId) {
    try {
      localStorage.setItem(dismissalKey(campaignId), String(Date.now()));
    } catch (e) {}
  }

  // ----- Track -----
  function track(eventType, campaignId, variationId) {
    try {
      var payload = {
        event_type: eventType,
        campaign_id: campaignId || null,
        variation_id: variationId || null,
        page_type: pageType,
        session_id: sessionId,
      };
      // Use sendBeacon when available (não bloqueia unload)
      var url = API_BASE + "/api/topbar/track?key=" + encodeURIComponent(API_KEY);
      if (navigator.sendBeacon) {
        var blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
        navigator.sendBeacon(url, blob);
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

  // ----- Fetch config -----
  function fetchTopbar() {
    var url =
      API_BASE +
      "/api/topbar/public-config?key=" +
      encodeURIComponent(API_KEY) +
      "&page_type=" +
      encodeURIComponent(pageType);
    return fetch(url, { credentials: "omit" })
      .then(function (r) {
        if (!r.ok) throw new Error("status " + r.status);
        return r.json();
      })
      .then(function (data) {
        return data && data.topbar ? data.topbar : null;
      })
      .catch(function (err) {
        if (window.console && console.warn) console.warn("[topbar]", err);
        return null;
      });
  }

  // ----- Render -----
  function render(tb) {
    if (!tb) return;
    if (tb.campaign_id && isDismissed(tb.campaign_id, tb.close_persistence_hours)) return;

    // Remove instância anterior (hot reload safety)
    var prev = document.getElementById("vtx-topbar");
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
      "left:0",
      "right:0",
      "z-index:2147483600",
      "background:" + (tb.bg_color || "#0f172a"),
      "color:" + (tb.text_color || "#ffffff"),
      "font-size:" + (tb.font_size || "14px"),
      "min-height:" + (tb.height || "40px"),
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "gap:12px",
      "padding:6px 44px 6px 16px",
      "box-sizing:border-box",
      "text-align:center",
      "line-height:1.3",
      "font-family:inherit",
      "box-shadow:0 1px 3px rgba(0,0,0,.08)",
    ];
    bar.setAttribute("style", styles.join(";"));

    // Content
    var content = document.createElement("div");
    content.setAttribute(
      "style",
      "display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center"
    );

    var msg = document.createElement("span");
    msg.id = "vtx-topbar-msg";
    msg.textContent = tb.message || "";
    content.appendChild(msg);

    // Countdown
    var countdownEl = null;
    var countdownTarget = tb.countdown_enabled && tb.countdown_target
      ? new Date(tb.countdown_target).getTime()
      : 0;
    if (countdownTarget && countdownTarget > Date.now()) {
      countdownEl = document.createElement("span");
      countdownEl.id = "vtx-topbar-countdown";
      countdownEl.setAttribute(
        "style",
        "display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.14);font-weight:600;font-variant-numeric:tabular-nums"
      );
      content.appendChild(countdownEl);
    }

    // CTA
    if (tb.link_url && tb.link_label) {
      var cta = document.createElement("a");
      cta.href = tb.link_url;
      cta.textContent = tb.link_label;
      cta.setAttribute(
        "style",
        "display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:" +
          (tb.accent_color || "#22c55e") +
          ";color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;white-space:nowrap"
      );
      cta.addEventListener("click", function () {
        track("click", tb.campaign_id, tb.variation_id);
      });
      content.appendChild(cta);
    }

    bar.appendChild(content);

    // Close button
    if (tb.show_close_button !== false) {
      var close = document.createElement("button");
      close.setAttribute("aria-label", "Fechar");
      close.innerHTML = "&times;";
      close.setAttribute(
        "style",
        "position:absolute;right:8px;top:50%;transform:translateY(-50%);background:transparent;border:0;color:inherit;font-size:22px;cursor:pointer;opacity:.7;line-height:1;padding:4px 8px"
      );
      close.addEventListener("click", function () {
        track("close", tb.campaign_id, tb.variation_id);
        if (tb.campaign_id) markDismissed(tb.campaign_id);
        bar.remove();
        // Tira o padding do body
        document.documentElement.style.removeProperty("--vtx-topbar-h");
        document.body.style.removeProperty(isTop ? "padding-top" : "padding-bottom");
      });
      bar.appendChild(close);
    }

    document.body.appendChild(bar);

    // Empurra o conteúdo da loja pra baixo/cima pra não cobrir nada
    requestAnimationFrame(function () {
      var h = bar.getBoundingClientRect().height || parseInt(tb.height, 10) || 40;
      document.documentElement.style.setProperty("--vtx-topbar-h", h + "px");
      document.body.style[isTop ? "paddingTop" : "paddingBottom"] = h + "px";
    });

    // Impression
    track("impression", tb.campaign_id, tb.variation_id);

    // Countdown ticker
    if (countdownEl) {
      function pad(n) {
        return String(n).padStart(2, "0");
      }
      function tick() {
        var ms = countdownTarget - Date.now();
        if (ms <= 0) {
          countdownEl.textContent = "";
          countdownEl.style.display = "none";
          return;
        }
        var s = Math.floor(ms / 1000);
        var d = Math.floor(s / 86400);
        s -= d * 86400;
        var h = Math.floor(s / 3600);
        s -= h * 3600;
        var m = Math.floor(s / 60);
        s -= m * 60;
        var label = tb.countdown_label || "Termina em";
        var parts = [];
        if (d > 0) parts.push(d + "d");
        parts.push(pad(h) + ":" + pad(m) + ":" + pad(s));
        countdownEl.textContent = label + " " + parts.join(" ");
      }
      tick();
      setInterval(tick, 1000);
    }
  }

  // ----- Boot -----
  function boot() {
    fetchTopbar().then(render);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
