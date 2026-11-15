(() => {
  // ---------- Navigation ----------
  const nav = document.querySelector('.nav');
  const toggle = document.querySelector('.nav__toggle');
  const setOpen = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  document.querySelectorAll('.nav__links a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- Fictional dashboard: evidence-linked findings ----------
  const findings = document.querySelectorAll('.finding');
  const lines = document.querySelectorAll('#demo .line');
  const select = (btn) => {
    findings.forEach((f) => f.classList.toggle('is-active', f === btn));
    const target = btn.dataset.lines.split(',');
    const cls = btn.dataset.status === 'hr' ? 'is-green' : 'is-amber';
    lines.forEach((l) => {
      l.classList.remove('is-amber', 'is-green');
      if (target.includes(l.dataset.line)) l.classList.add(cls);
    });
  };
  findings.forEach((f) => f.addEventListener('click', () => select(f)));
  if (findings[0]) select(findings[0]);

  // ---------- Pilot registration ----------
  const form = document.getElementById('pilot-form');
  const status = document.getElementById('form-status');
  const submitBtn = form.querySelector('button[type="submit"]');
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const setError = (el, msg) => {
    const wrap = el.closest('.field') || el.closest('.consent');
    if (!wrap) return;
    wrap.classList.toggle('is-invalid', !!msg);
    el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    let err = wrap.querySelector('.field__err');
    if (msg && wrap.classList.contains('field')) {
      if (!err) {
        err = document.createElement('span');
        err.className = 'field__err';
        err.id = el.id + '-err';
        wrap.appendChild(err);
        el.setAttribute('aria-describedby', err.id);
      }
      err.textContent = msg;
    } else if (err) {
      err.remove();
      el.removeAttribute('aria-describedby');
    }
  };

  const validate = () => {
    const f = form.elements;
    const checks = [
      [f.fullName, f.fullName.value.trim().length >= 2, 'Please enter your full name.'],
      [f.email, emailRe.test(f.email.value.trim()), 'Please enter a valid business email.'],
      [f.company, f.company.value.trim().length >= 2, 'Please enter your company name.'],
      [f.businessType, !!f.businessType.value, 'Please choose a business type.'],
      [f.skuCount, !!f.skuCount.value, 'Please choose a range.'],
      [f.consent, f.consent.checked, 'Please confirm consent.'],
    ];
    let firstBad = null;
    checks.forEach(([el, ok, msg]) => {
      setError(el, ok ? '' : msg);
      if (!ok && !firstBad) firstBad = el;
    });
    return firstBad;
  };

  form.addEventListener('input', (e) => {
    if (e.target.closest('.is-invalid')) validate();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.className = 'form__status';
    status.textContent = '';
    const bad = validate();
    if (bad) { bad.focus(); return; }

    const data = Object.fromEntries(new FormData(form).entries());
    data.consent = form.elements.consent.checked;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    try {
      const res = await fetch('/api/pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `The server could not save your registration (HTTP ${res.status}).`);
      }
      // Shown only after the server confirms the registration was stored.
      status.classList.add('is-ok');
      status.textContent = `Thank you — your registration has been received (reference ${body.id}). We review every registration and will contact selected participants by email.`;
      form.classList.add('is-done');
    } catch (err) {
      status.classList.add('is-err');
      status.textContent = (err instanceof TypeError)
        ? 'We could not reach the registration server. Please check your connection and try again.'
        : err.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Join the Pilot Programme';
    }
  });

  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();
