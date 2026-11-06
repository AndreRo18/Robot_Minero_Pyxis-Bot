"use strict";
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var modo = q.get("modo") === "registro" ? "registro" : "entrar";
  var next = q.get("next") || "/dashboard";
  if (next.charAt(0) !== "/" || next.charAt(1) === "/" || next.indexOf("\\") >= 0) next = "/dashboard";   // solo rutas internas

  function msg(texto, tipo) {
    var m = $("mensaje");
    if (!texto) { m.hidden = true; m.textContent = ""; return; }
    m.hidden = false; m.className = "msg " + (tipo || "err"); m.textContent = texto;
  }
  function poner(m) {
    modo = m; var reg = m === "registro";
    $("tabEntrar").setAttribute("aria-selected", String(!reg));
    $("tabRegistro").setAttribute("aria-selected", String(reg));
    ["fNombre", "fEmpresa", "fFuerza", "fTerminos"].forEach(function (id) { $(id).hidden = !reg; });
    $("clave").autocomplete = reg ? "new-password" : "current-password";
    $("enviar").textContent = reg ? "Crear mi cuenta" : "Entrar al panel";
    $("nota").textContent = reg ? "La primera cuenta registrada en una instalación nueva es la del administrador. Las demás empiezan como observador y el administrador les da permiso de operar." : "";
    document.title = (reg ? "Crear cuenta" : "Iniciar sesión") + " · TOPO Robotics";
    msg("");
  }
  $("tabEntrar").onclick = function () { poner("entrar"); };
  $("tabRegistro").onclick = function () { poner("registro"); };
  $("ver").onclick = function () {
    var o = $("clave").type === "password"; $("clave").type = o ? "text" : "password";
    this.textContent = o ? "Ocultar" : "Mostrar"; this.setAttribute("aria-pressed", String(o));
  };
  function fuerza(p) {
    var s = 0;
    if (p.length >= 8) s++; if (p.length >= 12) s++;
    if (/[a-zA-Z]/.test(p) && /\d/.test(p)) s++;
    if (/[^a-zA-Z0-9]/.test(p) && p.length >= 8) s++;
    return s;
  }
  $("clave").addEventListener("input", function () {
    var s = fuerza(this.value), b = $("barra");
    b.style.width = (s * 25) + "%"; b.style.background = s <= 1 ? "#c0432f" : s === 2 ? "#b8861a" : "#4a8a3c";
  });

  // Si ya hay sesión, ir directo al panel
  fetch("/api/auth", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d && d.user) location.replace(next); }).catch(function () {});

  $("form").addEventListener("submit", function (e) {
    e.preventDefault(); msg("");
    var reg = modo === "registro", email = $("correo").value.trim(), pw = $("clave").value;
    if (reg && $("nombre").value.trim().length < 2) { msg("Escribe tu nombre."); $("nombre").focus(); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg("Escribe un correo válido."); $("correo").focus(); return; }
    if (!pw) { msg("Escribe tu contraseña."); $("clave").focus(); return; }
    if (reg && (pw.length < 8 || !/[a-zA-Z]/.test(pw) || !/\d/.test(pw))) { msg("La contraseña necesita mínimo 8 caracteres, con letras y números."); $("clave").focus(); return; }
    if (reg && !$("terminos").checked) { msg("Debes aceptar los términos y la política de privacidad."); $("terminos").focus(); return; }
    var body = reg ? { action: "register", name: $("nombre").value.trim(), company: $("empresa").value.trim(), email: email, password: pw, terms: true }
                   : { action: "login", email: email, password: pw };
    var bt = $("enviar"), txt = bt.textContent; bt.disabled = true; bt.textContent = "Un momento…";
    fetch("/api/auth", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, s: r.status, d: d }; }); })
      .then(function (x) {
        if (x.ok) { location.replace(next); return; }
        var t = x.d && x.d.error ? x.d.error : "No se pudo completar la solicitud.";
        if (x.s === 429 && x.d.retryAfter) t += " (espera " + Math.ceil(x.d.retryAfter / 60) + " min)";
        if (x.s === 503) t = "El servidor aún no está configurado (falta AUTH_SECRET). Avisa al administrador del sitio.";
        msg(t); bt.disabled = false; bt.textContent = txt;
      })
      .catch(function () { msg("Sin conexión con el servidor. Revisa tu Internet e inténtalo de nuevo."); bt.disabled = false; bt.textContent = txt; });
  });
  poner(modo);
})();
