/* JUDITE — rastreador do site. Sem cookies e sem dados pessoais.
   Uso: <script defer src="https://SEU-JUDITE/j.js" data-chave="CHAVE"></script>
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

  function enviar(tipo, nome) {
    var corpo = JSON.stringify({
      k: chave, t: tipo, n: nome || null,
      p: location.pathname.slice(0, 300),
      r: document.referrer || null,
      u: utm, a: anuncio, w: window.innerWidth || 0
    });
    if (navigator.sendBeacon && navigator.sendBeacon(destino, corpo)) return;
    fetch(destino, { method: "POST", body: corpo, keepalive: true, mode: "no-cors" }).catch(function () {});
  }

  enviar("pageview");

  var push = history.pushState;
  history.pushState = function () {
    push.apply(this, arguments);
    enviar("pageview");
  };
  window.addEventListener("popstate", function () { enviar("pageview"); });

  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("a, button, [data-judite]") : null;
    if (!el) return;
    var marcado = el.getAttribute("data-judite");
    if (marcado) return enviar(marcado === "carrinho" ? "carrinho" : "evento", marcado.slice(0, 80));
    var href = el.getAttribute("href") || "";
    if (/wa\.me|whatsapp\.com/i.test(href)) enviar("whatsapp");
  }, true);
})();
