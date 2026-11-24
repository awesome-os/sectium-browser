(() => {
  const clockEl = document.getElementById('clock');
  const dateEl = document.getElementById('date');
  const formEl = document.getElementById('omnibar-form');
  const inputEl = document.getElementById('omnibar-input');

  function updateClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    if (clockEl) {
      clockEl.textContent = `${hh}:${mm}`;
      clockEl.setAttribute('datetime', now.toISOString());
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
    }
  }
  updateClock();
  setInterval(updateClock, 1000);

  if (formEl && inputEl) {
    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = inputEl.value.trim();
      if (!raw) return;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
        window.location.href = raw;
        return;
      }
      if (/^[^\s]+\.[^\s]{2,}$/.test(raw) || /^localhost(:\d+)?(\/|$)/i.test(raw)) {
        window.location.href = /^localhost/i.test(raw) ? `http://${raw}` : `https://${raw}`;
        return;
      }
      window.location.href = `https://duckduckgo.com/?q=${encodeURIComponent(raw)}`;
    });
  }

  // Bottom-left VS-Code-style >< Host Device / Workspace switcher
  const pill = document.getElementById('device-pill');
  const labelEl = document.getElementById('device-label');
  const menu = document.getElementById('device-menu');
  const customForm = document.getElementById('device-custom-form');
  const customInput = document.getElementById('device-custom-input');
  const STORAGE_KEY = 'sectium.activeHostDevice';

  function setActiveDevice(endpoint, label) {
    if (labelEl) labelEl.textContent = label;
    if (pill) pill.title = `Attached: ${endpoint}`;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ endpoint, label }));
    } catch {
      // ignore storage restrictions
    }
  }

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.endpoint && saved.label) {
      setActiveDevice(saved.endpoint, saved.label);
    }
  } catch {
    // default local device
  }

  if (pill && menu) {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      pill.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== pill) {
        menu.hidden = true;
        pill.setAttribute('aria-expanded', 'false');
      }
    });
    menu.querySelectorAll('.device-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ep = btn.getAttribute('data-endpoint') || '\\\\.\\pipe\\sectium-dev';
        const lbl = btn.getAttribute('data-label') || ep;
        setActiveDevice(ep, lbl);
        menu.hidden = true;
        pill.setAttribute('aria-expanded', 'false');
      });
    });
  }

  if (customForm && customInput) {
    customForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = customInput.value.trim();
      if (!val) return;
      setActiveDevice(val, val);
      customInput.value = '';
      if (menu && pill) {
        menu.hidden = true;
        pill.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Subtle living aurora canvas
  const canvas = document.getElementById('aurora');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isLight = () => window.matchMedia('(prefers-color-scheme: light)').matches;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  const orbs = [
    { x: 0.25, y: 0.30, r: 0.42, speed: 0.00018, phase: 0.0, dark: 'rgba(56, 189, 248, 0.14)', light: 'rgba(56, 189, 248, 0.18)' },
    { x: 0.76, y: 0.36, r: 0.44, speed: 0.00014, phase: 2.1, dark: 'rgba(167, 139, 250, 0.13)', light: 'rgba(139, 92, 246, 0.14)' },
    { x: 0.52, y: 0.78, r: 0.48, speed: 0.00012, phase: 4.3, dark: 'rgba(52, 211, 153, 0.09)', light: 'rgba(16, 185, 129, 0.12)' },
  ];

  function draw(t) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const minDim = Math.min(w, h);
    ctx.clearRect(0, 0, w, h);

    const light = isLight();
    for (const o of orbs) {
      const cx = (o.x + Math.sin(t * o.speed + o.phase) * 0.08) * w;
      const cy = (o.y + Math.cos(t * o.speed * 0.9 + o.phase) * 0.07) * h;
      const rad = o.r * minDim * 1.15;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grad.addColorStop(0, light ? o.light : o.dark);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!reduced) {
      requestAnimationFrame(draw);
    }
  }

  requestAnimationFrame(draw);
})();
