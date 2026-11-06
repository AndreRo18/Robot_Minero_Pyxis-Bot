// ===================== Login / Registro =====================
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const params = new URLSearchParams(location.search);
  const next = (params.get("next") || "/dashboard").startsWith("/") ? params.get("next") || "/dashboard" : "/dashboard";

  // Si ya hay sesión → directo al dashboard
  fetch("/api/auth", { cache: "no-store" }).then((r) => r.ok && location.replace(next)).catch(() => {});

  // ---------- Pestañas ----------
  const tabs = $(".tabs");
  function show(which) {
    const reg = which === "register";
    tabs.classList.toggle("reg", reg);
    $("#tab-login").setAttribute("aria-selected", !reg);
    $("#tab-register").setAttribute("aria-selected", reg);
    $("#f-login").hidden = reg;
    $("#f-register").hidden = !reg;
    history.replaceState(null, "", reg ? "#registro" : location.pathname + location.search);
    (reg ? $("#f-register [name=name]") : $("#f-login [name=email]")).focus();
  }
  $("#tab-login").onclick = () => show("login");
  $("#tab-register").onclick = () => show("register");
  document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => show(b.dataset.go)));
  if (location.hash === "#registro" || params.get("modo") === "registro") show("register");
  addEventListener("hashchange", () => show(location.hash === "#registro" ? "register" : "login"));

  // ---------- Mostrar / ocultar contraseña ----------
  document.querySelectorAll(".eye").forEach((b) => (b.onclick = () => {
    const i = b.previousElementSibling;
    i.type = i.type === "password" ? "text" : "password";
    b.classList.toggle("on", i.type === "text");
  }));

  // ---------- Medidor de seguridad de contraseña ----------
  const pwReg = $("#f-register [name=password]");
  const COLORS = ["#ff4d4d", "#ff8a3d", "#ffb000", "#2ee59d"];
  const TXT = ["Muy débil", "Débil", "Aceptable", "Fuerte"];
  pwReg.addEventListener("input", () => {
    const v = pwReg.value;
    let s = 0;
    if (v.length >= 8) s++;
    if (/[A-Za-z]/.test(v) && /\d/.test(v)) s++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
    if (/[^A-Za-z0-9]/.test(v) || v.length >= 12) s++;
    document.querySelectorAll(".meter i").forEach((bar, i) => (bar.style.background = i < s ? COLORS[s - 1] : ""));
    $("#pwHint").textContent = v ? `Seguridad: ${TXT[Math.max(0, s - 1)]}` : "Usa 8+ caracteres combinando letras y números.";
  });

  // ---------- Envío ----------
  function fail(form, msg, field) {
    $(".msg", form).className = "msg";
    $(".msg", form).textContent = msg;
    form.querySelectorAll("input").forEach((i) => i.classList.remove("bad"));
    if (field) { const el = form.querySelector(`[name=${field}]`); el?.classList.add("bad"); el?.focus(); }
  }
  async function submit(form, payload) {
    const btn = $("button[type=submit]", form);
    btn.disabled = true; btn.classList.add("loading");
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) return fail(form, j.error || "No fue posible continuar", j.field);
      $(".msg", form).className = "msg ok";
      $(".msg", form).textContent = j.firstAdmin
        ? "¡Cuenta creada! Eres el administrador del sistema. Entrando…"
        : payload.action === "register" ? "¡Cuenta creada! Entrando…" : "¡Hola de nuevo! Entrando…";
      setTimeout(() => location.replace(next), 650);
    } catch {
      fail(form, "Sin conexión con el servidor. Intenta de nuevo.");
    } finally {
      btn.disabled = false; btn.classList.remove("loading");
    }
  }

  $("#f-login").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target, d = Object.fromEntries(new FormData(f));
    if (!d.email) return fail(f, "Escribe tu correo", "email");
    if (!d.password) return fail(f, "Escribe tu contraseña", "password");
    submit(f, { action: "login", email: d.email, password: d.password });
  });

  $("#f-register").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target, d = Object.fromEntries(new FormData(f));
    if ((d.name || "").trim().length < 2) return fail(f, "Escribe tu nombre completo", "name");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(d.email || "")) return fail(f, "Correo no válido", "email");
    if ((d.password || "").length < 8 || !/[A-Za-z]/.test(d.password) || !/\d/.test(d.password))
      return fail(f, "La contraseña debe tener 8+ caracteres con letras y números", "password");
    if (d.password !== d.confirm) return fail(f, "Las contraseñas no coinciden", "confirm");
    if (!d.terms) return fail(f, "Debes aceptar el tratamiento de datos", "terms");
    submit(f, { action: "register", name: d.name, company: d.company, email: d.email, password: d.password, terms: true });
  });

  $("#forgot").onclick = () => {
    const f = $("#f-login");
    $(".msg", f).className = "msg ok";
    $(".msg", f).textContent = "Pide al administrador de tu empresa que restablezca tu acceso.";
  };

  // ---------- Ticker de ejemplo ----------
  let t = 0;
  setInterval(() => {
    t++;
    $("#tk-ch4").textContent = (0.4 + 0.08 * Math.sin(t / 3)).toFixed(2) + "%";
    $("#tk-co").textContent = Math.round(9 + 3 * Math.sin(t / 4)) + " ppm";
    $("#tk-o2").textContent = (20.8 - Math.random() * 0.1).toFixed(1) + "%";
    $("#tk-h2s").textContent = (0.3 + Math.random() * 0.1).toFixed(1) + " ppm";
  }, 1300);

  // ---------- Radar ----------
  const c = $("#radar"), ctx = c.getContext("2d");
  let W, R, ang = 0;
  const pts = Array.from({ length: 60 }, () => ({ a: Math.random() * 6.283, r: 0.2 + Math.random() * 0.78, l: 0 }));
  const size = () => { const d = Math.min(devicePixelRatio || 1, 2); W = c.clientWidth; c.width = c.height = W * d; ctx.setTransform(d, 0, 0, d, 0, 0); R = W / 2 - 4; };
  addEventListener("resize", size); size();
  (function draw() {
    ctx.clearRect(0, 0, W, W); ctx.save(); ctx.translate(W / 2, W / 2);
    ctx.strokeStyle = "rgba(255,176,0,.16)";
    for (let i = 1; i <= 5; i++) { ctx.beginPath(); ctx.arc(0, 0, (R * i) / 5, 0, 6.283); ctx.stroke(); }
    if (ctx.createConicGradient) {
      const g = ctx.createConicGradient(ang - 0.9, 0, 0);
      g.addColorStop(0, "rgba(255,176,0,0)"); g.addColorStop(0.14, "rgba(255,176,0,.3)"); g.addColorStop(0.1401, "rgba(255,176,0,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.283); ctx.fill();
    }
    for (const p of pts) {
      if ((ang - p.a + 12.566) % 6.283 < 0.05) p.l = 1;
      if (p.l > 0) { ctx.fillStyle = `rgba(255,207,92,${p.l})`; ctx.beginPath(); ctx.arc(Math.cos(p.a) * p.r * R, Math.sin(p.a) * p.r * R, 2.4, 0, 6.283); ctx.fill(); p.l -= 0.006; }
    }
    ctx.restore(); ang = (ang + 0.012) % 6.283;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) requestAnimationFrame(draw);
  })();
})();
