/* JUDITE — rastreador do site. Sem cookies e sem dados pessoais.
   Uso: <script defer src="https://SEU-JUDITE/j.js" data-chave="CHAVE"></script>
   Conta sozinho: visitas, links e aberturas do WhatsApp, e marcações data-evento que o site já tenha.
   Eventos extras: adicione data-judite="carrinho" (ou outro nome) em qualquer botão. */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var chave = s.getAttribute("data-chave");
  if (!chave) return;
  var destino = new URL("/api/coleta", s.src).toString();
  var q = new URLSearchParams(location.search);
  var utm = {};
  ["utm_source", "utm_medium", "utm_campaign", "utm_content"].forEach(function (k) {
    var v = q.get(k);
    if (v) utm[k] = v.slice(0, 150);
  });
  var anuncio = q.get("gclid") || q.get("gbraid") || q.get("wbraid") ? "google"
    : q.get("fbclid") ? "meta" : q.get("ttclid") ? "tiktok" : null;

  function montar(tipo, nome, teste) {
    var dados = {
      k: chave, t: tipo, n: nome || null,
      p: location.pathname.slice(0, 300),
      r: document.referrer || null,
      u: utm, a: anuncio, w: window.innerWidth || 0
    };
    if (teste) dados.x = 1;
    return JSON.stringify(dados);
  }

  function enviar(tipo, nome) {
    var corpo = montar(tipo, nome, false);
    if (navigator.sendBeacon && navigator.sendBeacon(destino, corpo)) return;
    fetch(destino, { method: "POST", body: corpo, keepalive: true, mode: "no-cors" }).catch(function () {});
  }

  // Modo de teste: abra o site com ?judite_teste=1. Envia um evento marcado como teste
  // (não entra nas contas) e mostra na tela se a JUDITE recebeu, e o motivo quando não recebeu.
  if (q.get("judite_teste") === "1") {
    var avisar = function (ok, texto) {
      var faixa = document.createElement("div");
      faixa.textContent = "JUDITE: " + texto;
      faixa.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483647;padding:10px 14px;border-radius:8px;" +
        "font:14px/1.4 Arial,sans-serif;color:#fff;max-width:90vw;background:" + (ok ? "#047857" : "#b91c1c");
      (document.body || document.documentElement).appendChild(faixa);
      if (window.console) console.log("[JUDITE] " + texto);
    };
    var testar = function () {
      fetch(destino, { method: "POST", body: montar("evento", "judite_teste", true) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          avisar(Boolean(j && j.ok), j && j.ok ? "teste recebido. O rastreador está funcionando." : "teste recusado. Motivo: " + ((j && j.motivo) || "desconhecido"));
        })
        .catch(function () { avisar(false, "não foi possível falar com a JUDITE (bloqueio do navegador, de extensão ou da rede)."); });
    };
    if (document.body) testar(); else document.addEventListener("DOMContentLoaded", testar);
    return;
  }

  enviar("pageview");

  var push = history.pushState;
  history.pushState = function () {
    push.apply(this, arguments);
    enviar("pageview");
  };
  window.addEventListener("popstate", function () { enviar("pageview"); });

  var ehWhats = function (url) { return /wa\.me|whatsapp\.com/i.test(String(url || "")); };
  var ultimoWhats = 0;
  function whatsapp() {
    // evita contar duas vezes o mesmo clique (link + abertura por código)
    var agora = Date.now();
    if (agora - ultimoWhats < 1500) return;
    ultimoWhats = agora;
    enviar("whatsapp");
  }

  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("a, button, [data-judite], [data-evento]") : null;
    if (!el) return;
    var marcado = el.getAttribute("data-judite");
    if (marcado) return enviar(marcado === "carrinho" ? "carrinho" : "evento", marcado.slice(0, 80));
    var href = el.getAttribute("href") || "";
    if (ehWhats(href)) return whatsapp();
    // Marcações que o site já tenha (ex.: data-evento="instagram_click")
    var evento = el.getAttribute("data-evento");
    if (evento) {
      if (/whats/i.test(evento)) return whatsapp();
      if (/carrinho|roteiro|cart/i.test(evento)) return enviar("carrinho", evento.slice(0, 80));
      enviar("evento", evento.slice(0, 80));
    }
  }, true);

  // WhatsApp aberto por código (ex.: o botão que envia o roteiro montado)
  var abrir = window.open;
  window.open = function (url) {
    if (ehWhats(url)) whatsapp();
    return abrir.apply(window, arguments);
  };
})();
