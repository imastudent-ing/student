/* ==========================================================================
   $YJKW — main.js
   ========================================================================== */
(() => {
  'use strict';

  const CA = '6WqTZgmwi5ytyMaCFm88xoLPu26Bips35V4u6CCopump';
  const LINK_PUMP = 'https://pump.fun/coin/' + CA;
  const LINK_COMMUNITY = 'https://x.com/i/communities/2038327343748730919';

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ------------------------------------------------------------------
     マスター rAF ループ
  ------------------------------------------------------------------ */
  const frameFns = new Set();
  let lastT = performance.now();
  function masterLoop(t) {
    const dt = Math.min((t - lastT) / 1000, 0.05) || 0.016;
    lastT = t;
    frameFns.forEach(fn => fn(dt, t));
    requestAnimationFrame(masterLoop);
  }
  requestAnimationFrame(masterLoop);

  const maxScroll = () =>
    Math.max(0, document.documentElement.scrollHeight - innerHeight);

  /* ------------------------------------------------------------------
     慣性スムーススクロール(デスクトップのホイールのみ)
     モバイルはネイティブスクロール + 後述の fxY 補間でヌルヌルに
  ------------------------------------------------------------------ */
  let targetY = window.scrollY;
  let animY = window.scrollY;
  let smoothActive = false;

  if (!reduced && finePointer) {
    addEventListener('wheel', (e) => {
      if (e.ctrlKey) return; // ピンチズームは邪魔しない
      if (document.body.classList.contains('menu-open')) { e.preventDefault(); return; }
      e.preventDefault();
      const mult = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
      if (!smoothActive) { targetY = animY = window.scrollY; }
      targetY = clamp(targetY + e.deltaY * mult, 0, maxScroll());
      smoothActive = true;
    }, { passive: false });

    frameFns.add((dt) => {
      if (!smoothActive) return;
      animY = lerp(animY, targetY, 1 - Math.exp(-dt * 10));
      if (Math.abs(targetY - animY) < 0.4) { animY = targetY; smoothActive = false; }
      window.scrollTo(0, animY);
    });

    // スクロールバー / キーボード等の外部スクロールと同期
    addEventListener('scroll', () => {
      if (Math.abs(window.scrollY - animY) > 2) {
        animY = targetY = window.scrollY;
        smoothActive = false;
      }
    }, { passive: true });
  }

  function scrollToY(y) {
    y = clamp(y, 0, maxScroll());
    if (!reduced && finePointer) {
      animY = window.scrollY;
      targetY = y;
      smoothActive = true;
    } else {
      window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
    }
  }

  /* エフェクト用のなめらかスクロール値 */
  let fxY = window.scrollY;
  frameFns.add((dt) => {
    fxY = lerp(fxY, window.scrollY, 1 - Math.exp(-dt * 12));
    if (Math.abs(fxY - window.scrollY) < 0.05) fxY = window.scrollY;
  });

  /* ------------------------------------------------------------------
     プログレスバー / ヘッダー / トップへ戻る
  ------------------------------------------------------------------ */
  const progressFill = $('#progressFill');
  const header = $('#header');
  const toTop = $('#toTop');

  frameFns.add(() => {
    const m = maxScroll();
    progressFill.style.width = (m ? (fxY / m) * 100 : 0) + '%';
  });

  const onScrollUI = () => {
    header.classList.toggle('scrolled', window.scrollY > 30);
    toTop.classList.toggle('show', window.scrollY > 600);
  };
  addEventListener('scroll', onScrollUI, { passive: true });
  onScrollUI();

  toTop.addEventListener('click', () => scrollToY(0));

  /* ------------------------------------------------------------------
     アンカーリンク
  ------------------------------------------------------------------ */
  $$('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const el = $(id);
      if (!el) return;
      e.preventDefault();
      closeMenu();
      const top = el.getBoundingClientRect().top + window.scrollY - 58;
      scrollToY(top);
      history.replaceState(null, '', id);
      el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    });
  });

  /* ------------------------------------------------------------------
     モバイルメニュー
  ------------------------------------------------------------------ */
  const navToggle = $('#navToggle');
  const mobileMenu = $('#mobileMenu');

  function closeMenu() {
    document.body.classList.remove('menu-open');
    document.body.style.overflow = '';
    navToggle.setAttribute('aria-expanded', 'false');
    mobileMenu.setAttribute('aria-hidden', 'true');
  }
  navToggle.addEventListener('click', () => {
    const open = !document.body.classList.contains('menu-open');
    document.body.classList.toggle('menu-open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    navToggle.setAttribute('aria-expanded', String(open));
    mobileMenu.setAttribute('aria-hidden', String(!open));
  });

  /* ------------------------------------------------------------------
     リビール(スクロールで順番にふわっと)
  ------------------------------------------------------------------ */
  const revealEls = $$('[data-reveal]');
  if (reduced || !('IntersectionObserver' in window)) {
    revealEls.forEach(el => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach(el => io.observe(el));
  }

  /* ------------------------------------------------------------------
     パララックス
  ------------------------------------------------------------------ */
  const pxItems = $$('[data-parallax]').map(el => ({
    el,
    sp: parseFloat(el.dataset.parallax) || 0,
    base: 0,
    cur: 0,
  }));

  function measureParallax() {
    pxItems.forEach(it => {
      const r = it.el.getBoundingClientRect();
      it.base = r.top + window.scrollY + r.height / 2 - it.cur;
    });
  }

  if (!reduced && pxItems.length) {
    measureParallax();
    addEventListener('resize', measureParallax);
    addEventListener('load', measureParallax);
    frameFns.add((dt) => {
      const vc = fxY + innerHeight / 2;
      pxItems.forEach(it => {
        const target = (vc - it.base) * it.sp;
        it.cur = lerp(it.cur, target, 1 - Math.exp(-dt * 8));
        it.el.style.transform = `translate3d(0, ${it.cur.toFixed(2)}px, 0)`;
      });
    });
  }

  /* ------------------------------------------------------------------
     ヒーロー: スクロール連動の回転・退場 / ポインタでチルト
  ------------------------------------------------------------------ */
  const hero = $('.hero');
  const heroInner = $('.hero-inner');
  const heroCoinImg = $('#heroCoinImg');
  let tiltX = 0, tiltY = 0, tiltTX = 0, tiltTY = 0;

  if (!reduced) {
    if (finePointer) {
      hero.addEventListener('pointermove', (e) => {
        const r = hero.getBoundingClientRect();
        tiltTX = ((e.clientY - r.top) / r.height - 0.5) * -10;
        tiltTY = ((e.clientX - r.left) / r.width - 0.5) * 12;
      });
      hero.addEventListener('pointerleave', () => { tiltTX = 0; tiltTY = 0; });
    }
    frameFns.add((dt) => {
      const k = 1 - Math.exp(-dt * 7);
      tiltX = lerp(tiltX, tiltTX, k);
      tiltY = lerp(tiltY, tiltTY, k);
      const rot = fxY * 0.05;
      heroCoinImg.style.transform =
        `perspective(700px) rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg) rotate(${rot.toFixed(2)}deg)`;

      // ヒーローの退場(スクロールで沈み込みながらフェード)
      const vh = innerHeight;
      if (fxY < vh * 1.2) {
        const p = clamp(fxY / (vh * 0.85), 0, 1);
        heroInner.style.opacity = String(1 - p * 0.9);
        heroInner.style.transform = `translate3d(0, ${(fxY * 0.28).toFixed(2)}px, 0)`;
      }
    });
  }

  /* ------------------------------------------------------------------
     ヒーローのきらきらパーティクル
  ------------------------------------------------------------------ */
  const canvas = $('#particles');
  if (canvas && !reduced) {
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let W = 0, H = 0, heroVisible = true;
    let parts = [];

    function sizeCanvas() {
      W = hero.clientWidth;
      H = hero.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function initParts() {
      const n = Math.round(clamp(W / 24, 30, 60));
      parts = Array.from({ length: n }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.6 + Math.random() * 2,
        vy: 6 + Math.random() * 16,
        vx: (Math.random() - 0.5) * 6,
        ph: Math.random() * Math.PI * 2,
        tw: 0.6 + Math.random() * 1.8,
      }));
    }
    sizeCanvas(); initParts();
    addEventListener('resize', () => { sizeCanvas(); initParts(); });

    new IntersectionObserver(([en]) => { heroVisible = en.isIntersecting; })
      .observe(hero);

    frameFns.add((dt, t) => {
      if (!heroVisible || document.hidden) return;
      ctx.clearRect(0, 0, W, H);
      parts.forEach(p => {
        p.y -= p.vy * dt;
        p.x += p.vx * dt;
        if (p.y < -6) { p.y = H + 6; p.x = Math.random() * W; }
        if (p.x < -6) p.x = W + 6;
        if (p.x > W + 6) p.x = -6;
        const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(p.ph + t / 1000 * p.tw * Math.PI));
        ctx.globalAlpha = a;
        ctx.fillStyle = p.r > 1.8 ? '#ffe9a3' : '#f5c542';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    });
  }

  /* ------------------------------------------------------------------
     トースト
  ------------------------------------------------------------------ */
  const toastEl = $('#toast');
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  /* ------------------------------------------------------------------
     CAコピー
  ------------------------------------------------------------------ */
  $$('.copy-ca').forEach(btn => {
    btn.addEventListener('click', async () => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(CA);
        ok = true;
      } catch {
        const ta = document.createElement('textarea');
        ta.value = CA;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand('copy'); } catch { /* noop */ }
        ta.remove();
      }
      toast(ok ? 'CAをコピーしました 🐻‍❄️' : 'コピーできませんでした…長押しで選択してください');
    });
  });

  /* ------------------------------------------------------------------
     コインレイン
  ------------------------------------------------------------------ */
  const rainLayer = $('#rainLayer');
  function coinRain(n = 14) {
    if (reduced || !rainLayer || rainLayer.childElementCount > 70) return;
    for (let i = 0; i < n; i++) {
      const img = document.createElement('img');
      img.src = 'assets/img/coin-96.png';
      img.alt = '';
      const size = 20 + Math.random() * 28;
      img.style.width = size + 'px';
      img.style.left = Math.random() * 100 + 'vw';
      rainLayer.appendChild(img);
      const anim = img.animate([
        { transform: 'translate3d(0,-12vh,0) rotate(0deg)', opacity: 1 },
        { transform: `translate3d(${(Math.random() - 0.5) * 160}px, 112vh, 0) rotate(${(Math.random() - 0.5) * 720}deg)`, opacity: 1 },
      ], {
        duration: 1300 + Math.random() * 1300,
        delay: Math.random() * 350,
        easing: 'cubic-bezier(0.35, 0.05, 0.6, 1)',
      });
      anim.onfinish = () => img.remove();
    }
  }

  $('#heroCoin').addEventListener('click', () => {
    coinRain(12);
    toast('🪙 $YJKW!');
  });

  /* ------------------------------------------------------------------
     カウントアップ(トークノミクス供給量など)
  ------------------------------------------------------------------ */
  function countUp(el, to, dur = 1600, fmt = v => Math.round(v).toLocaleString('en-US')) {
    if (reduced) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    (function tick(t) {
      const p = clamp((t - t0) / dur, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * e);
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  $$('[data-count]').forEach(el => {
    const to = parseFloat(el.dataset.count);
    if (reduced || !('IntersectionObserver' in window)) {
      el.textContent = to.toLocaleString('en-US');
      return;
    }
    const io = new IntersectionObserver(([en]) => {
      if (en.isIntersecting) {
        countUp(el, to);
        io.disconnect();
      }
    }, { threshold: 0.4 });
    io.observe(el);
  });

  /* ------------------------------------------------------------------
     ライブデータ (DexScreener API)
  ------------------------------------------------------------------ */
  const statPrice = $('#statPrice');
  const statDelta = $('#statDelta');
  const statMcap = $('#statMcap');
  const statVol = $('#statVol');
  const statLiq = $('#statLiq');
  const statUpdated = $('#statUpdated');
  const statNote = $('#statNote');
  const chartWrap = $('#chartWrap');
  const chartSkeleton = $('#chartSkeleton');

  const SUBS = '₀₁₂₃₄₅₆₇₈₉';
  const subDigits = n => String(n).split('').map(d => SUBS[+d]).join('');

  function fmtPrice(p) {
    if (!isFinite(p) || p <= 0) return '—';
    if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 4 });
    if (p >= 0.01) return '$' + p.toFixed(4);
    const m = p.toFixed(20).match(/^0\.(0*)([1-9]\d*)/);
    if (!m) return '$' + p;
    const zeros = m[1].length;
    const digits = m[2].slice(0, 4);
    return zeros >= 4 ? `$0.0${subDigits(zeros)}${digits}` : '$' + p.toFixed(zeros + 4);
  }

  function fmtUsd(v) {
    if (!isFinite(v)) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(2);
  }

  function setVal(el, text, flash) {
    if (el.textContent === text) return;
    el.textContent = text;
    if (flash && !reduced) {
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }
  }

  let pairAddr = null;
  let chartMounted = false;
  let chartVisible = false;
  let gotData = false;

  function showNote(html) {
    statNote.innerHTML = html;
    statNote.hidden = false;
  }

  function mountChartIfReady() {
    if (chartMounted || !pairAddr || !chartVisible) return;
    chartMounted = true;
    const iframe = document.createElement('iframe');
    iframe.title = '$YJKW 価格チャート (DexScreener)';
    iframe.loading = 'lazy';
    iframe.src = `https://dexscreener.com/solana/${pairAddr}?embed=1&theme=dark&trades=0&info=0`;
    iframe.addEventListener('load', () => chartSkeleton.remove());
    chartWrap.appendChild(iframe);
  }

  new IntersectionObserver(([en]) => {
    if (en.isIntersecting) {
      chartVisible = true;
      mountChartIfReady();
    }
  }, { rootMargin: '200px' }).observe(chartWrap);

  async function loadStats(first) {
    try {
      const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + CA, { cache: 'no-store' });
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.json();
      const pairs = (data.pairs || []).filter(p => p.chainId === 'solana');

      if (!pairs.length) {
        showNote(`まだDEXペアが見つかりません(pump.funボンディングカーブ中の可能性があります)。最新情報は <a href="${LINK_PUMP}" target="_blank" rel="noopener">pump.fun ↗</a> でチェック!`);
        chartSkeleton.innerHTML = `<span>チャートは DEX ペア生成後に表示されます — <a href="${LINK_PUMP}" target="_blank" rel="noopener">pump.fun で見る ↗</a></span>`;
        statUpdated.textContent = '(' + new Date().toLocaleTimeString('ja-JP') + ' 時点)';
        return;
      }

      const best = pairs.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0];
      const flash = !first;

      setVal(statPrice, fmtPrice(parseFloat(best.priceUsd)), flash);
      setVal(statMcap, fmtUsd(best.marketCap != null ? best.marketCap : best.fdv), flash);
      setVal(statVol, fmtUsd(best.volume && best.volume.h24), flash);
      setVal(statLiq, fmtUsd(best.liquidity && best.liquidity.usd), flash);

      const ch = best.priceChange && best.priceChange.h24;
      if (typeof ch === 'number') {
        statDelta.textContent = `${ch >= 0 ? '▲ +' : '▼ '}${ch.toFixed(2)}% (24h)`;
        statDelta.className = 'stat-delta ' + (ch >= 0 ? 'good' : 'bad');
      } else {
        statDelta.textContent = '';
      }

      statUpdated.textContent = '(' + new Date().toLocaleTimeString('ja-JP') + ' 更新)';
      statNote.hidden = true;
      gotData = true;

      if (best.pairAddress) {
        pairAddr = best.pairAddress;
        mountChartIfReady();
      }
    } catch {
      if (!gotData) {
        showNote(`データを取得できませんでした。<a href="https://dexscreener.com/solana/${CA}" target="_blank" rel="noopener">DexScreener ↗</a> で直接確認できます。`);
        chartSkeleton.innerHTML = `<span><a href="https://dexscreener.com/solana/${CA}" target="_blank" rel="noopener">DexScreener でチャートを見る ↗</a></span>`;
      }
    }
  }

  loadStats(true);
  setInterval(() => { if (!document.hidden) loadStats(false); }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadStats(false);
  });

  /* ------------------------------------------------------------------
     白くまクリッカー
  ------------------------------------------------------------------ */
  const PETS_KEY = 'yjkw_pets';
  const clickerCoin = $('#clickerCoin');
  const clickCountEl = $('#clickCount');
  const clickRankEl = $('#clickRank');
  const comboBadge = $('#comboBadge');
  const coinWrap = $('.clicker-coin-wrap');

  let pets = parseInt(localStorage.getItem(PETS_KEY) || '0', 10) || 0;
  let combo = 0;
  let lastTap = 0;
  let comboTimer = null;
  let popTimer = null;

  const RANKS = [
    [0, 'こぐま見習い'],
    [10, 'こぐま'],
    [50, '白くま見習い'],
    [100, '一人前の白くま'],
    [500, '白くまエリート'],
    [1000, '白くまマスター'],
    [5000, '白くまの神'],
  ];
  const MILESTONES = {
    10: '🎉 10なでなで!「こぐま」に進化!',
    50: '🎉 50なでなで!「白くま見習い」に進化!',
    100: '💯 100なでなで!「一人前の白くま」に進化!',
    500: '🔥 500なでなで!「白くまエリート」に進化!',
    1000: '👑 1,000なでなで!「白くまマスター」に進化!',
    5000: '🌟 5,000なでなで!「白くまの神」爆誕!!',
  };

  function rankFor(n) {
    let r = RANKS[0][1];
    RANKS.forEach(([min, name]) => { if (n >= min) r = name; });
    return r;
  }
  function renderClicker() {
    clickCountEl.textContent = pets.toLocaleString('en-US');
    clickRankEl.textContent = rankFor(pets);
  }
  renderClicker();

  function floatLabel() {
    if (reduced || !coinWrap) return;
    const span = document.createElement('span');
    span.className = 'float-label';
    span.textContent = Math.random() < 0.12 ? '🐻‍❄️' : Math.random() < 0.5 ? '+1' : '💛';
    span.style.left = 18 + Math.random() * 64 + '%';
    span.style.top = 8 + Math.random() * 30 + '%';
    coinWrap.appendChild(span);
    span.animate([
      { transform: 'translateY(0) scale(0.8)', opacity: 1 },
      { transform: `translateY(-${60 + Math.random() * 40}px) scale(1.25) rotate(${(Math.random() - 0.5) * 30}deg)`, opacity: 0 },
    ], { duration: 750, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' })
      .onfinish = () => span.remove();
  }

  function petOnce() {
    pets++;
    localStorage.setItem(PETS_KEY, String(pets));
    renderClicker();

    clickerCoin.classList.add('pop');
    clearTimeout(popTimer);
    popTimer = setTimeout(() => clickerCoin.classList.remove('pop'), 110);

    floatLabel();

    const now = performance.now();
    combo = now - lastTap < 650 ? combo + 1 : 1;
    lastTap = now;
    if (combo >= 3) {
      comboBadge.textContent = 'COMBO ×' + combo;
      comboBadge.classList.add('show');
      clearTimeout(comboTimer);
      comboTimer = setTimeout(() => comboBadge.classList.remove('show'), 900);
    }

    if (MILESTONES[pets]) {
      toast(MILESTONES[pets]);
      coinRain(18);
    }
  }

  clickerCoin.addEventListener('pointerdown', petOnce);
  clickerCoin.addEventListener('click', (e) => { if (e.detail === 0) petOnce(); }); // キーボード操作

  $('#shareX').addEventListener('click', () => {
    const text = `白くまコイン $YJKW を ${pets.toLocaleString('en-US')} 回なでなでした🐻‍❄️✨\nランク:「${rankFor(pets)}」\n#YJKW`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(LINK_COMMUNITY)}`;
    window.open(url, '_blank', 'noopener,width=560,height=640');
  });

  /* ------------------------------------------------------------------
     ナビのアクティブ状態
  ------------------------------------------------------------------ */
  const navLinks = $$('.nav-links a');
  const sectionsForNav = navLinks
    .map(a => $(a.getAttribute('href')))
    .filter(Boolean);
  if ('IntersectionObserver' in window && sectionsForNav.length) {
    const navIO = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        navLinks.forEach(a =>
          a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id));
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sectionsForNav.forEach(s => navIO.observe(s));
  }

  /* ------------------------------------------------------------------
     ローディング
  ------------------------------------------------------------------ */
  const loader = $('#loader');
  const loaderFill = $('#loaderFill');
  const loaderPct = $('#loaderPct');
  let fakeProgress = 0;
  let pageLoaded = false;
  const loaderT0 = performance.now();

  addEventListener('load', () => { pageLoaded = true; });

  const loaderTick = setInterval(() => {
    const elapsed = performance.now() - loaderT0;
    const cap = pageLoaded || elapsed > 1800 ? 100 : 88;
    fakeProgress = Math.min(cap, fakeProgress + (cap - fakeProgress) * 0.16 + 1.2);
    loaderFill.style.width = fakeProgress + '%';
    loaderPct.textContent = Math.round(fakeProgress) + '%';
    if (fakeProgress >= 99.5 && elapsed > 500) {
      clearInterval(loaderTick);
      loaderFill.style.width = '100%';
      loaderPct.textContent = '100%';
      setTimeout(() => {
        loader.classList.add('done');
        document.body.classList.add('loaded');
        measureParallax();
        setTimeout(() => loader.remove(), 700);
      }, 120);
    }
  }, 40);

  /* ------------------------------------------------------------------
     その他
  ------------------------------------------------------------------ */
  $('#year').textContent = String(new Date().getFullYear());

  addEventListener('resize', () => {
    targetY = clamp(targetY, 0, maxScroll());
  });

  console.log('%c$YJKW 🐻‍❄️ かわいいは正義', 'font-size:16px;font-weight:bold;color:#f5c542');
})();
