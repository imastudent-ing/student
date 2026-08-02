/* ==========================================================================
   $YJKW — main.js
   ========================================================================== */
(() => {
  'use strict';

  const CA = '6WqTZgmwi5ytyMaCFm88xoLPu26Bips35V4u6CCopump';
  const LINK_PUMP = 'https://pump.fun/coin/' + CA;
  const LINK_COMMUNITY = 'https://x.com/i/communities/2038327343748730919';
  const LINK_LINE = 'https://line.me/ti/g2/mXHRwb6TejJAqhPZrjCuC_Na2dxY-K0DcHL38w?utm_source=invitation&utm_medium=link_copy&utm_campaign=default';

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // localStorage が使えない環境 (プライベートブラウズ等) でも落ちないように
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* noop */ } },
  };

  /* ------------------------------------------------------------------
     i18n — HTMLは日本語がデフォルト。EN辞書 + 起動時スナップショットで切替
  ------------------------------------------------------------------ */
  let lang = store.get('yjkw_lang');
  if (lang !== 'ja' && lang !== 'en') {
    lang = (navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
  }

  const STR = {
    ja: {
      docTitle: '$YJKW | やじゅかわミームコイン on Solana',
      metaDesc: '野獣なのに、かわいい。やじゅかわコイン $YJKW のコミュニティサイト。ライブチャート、買い方、Xコミュニティ、LINEオープンチャットはこちら。CA: ' + CA,
      copied: 'CAをコピーしました 🐾',
      copyFail: 'コピーできませんでした…長押しで選択してください',
      updated: t => `(${t} 更新)`,
      noPairNote: `まだDEXペアが見つかりません(pump.funボンディングカーブ中の可能性があります)。最新情報は <a href="${LINK_PUMP}" target="_blank" rel="noopener">pump.fun ↗</a> でチェック!`,
      failNote: `データを取得できませんでした。<a href="https://dexscreener.com/solana/${CA}" target="_blank" rel="noopener">DexScreener ↗</a> で直接確認できます。`,
      chartLoading: 'チャートを読み込み中…',
      chartNoPair: `チャートは DEX ペア生成後に表示されます — <a href="${LINK_PUMP}" target="_blank" rel="noopener">pump.fun で見る ↗</a>`,
      chartFail: `<a href="https://dexscreener.com/solana/${CA}" target="_blank" rel="noopener">DexScreener でチャートを見る ↗</a>`,
      share: (n, r) => `やじゅかわコイン $YJKW を ${n} 回なでなでした🐾✨\nランク:「${r}」\n#YJKW $YJKW`,
      milestones: {
        10: '🎉 10なでなで!「駆け出しやじゅかわ」に進化!',
        50: '🎉 50なでなで!「なでなで職人」に進化!',
        100: '💯 100なでなで!「一人前のやじゅかわ」に進化!',
        500: '🔥 500なでなで!「やじゅかわエリート」に進化!',
        1000: '👑 1,000なでなで!「やじゅかわマスター」に進化!',
        5000: '🌟 5,000なでなで!「やじゅかわの神」爆誕!!',
      },
    },
    en: {
      docTitle: '$YJKW | YAJUKAWA Meme Coin on Solana',
      metaDesc: 'Beast mode, but adorable. Community site for $YJKW, the yajukawa coin on Solana. Live chart, how to buy, X community & LINE OpenChat. CA: ' + CA,
      copied: 'CA copied 🐾',
      copyFail: 'Could not copy — please select the address manually',
      updated: t => `(updated ${t})`,
      noPairNote: `No DEX pair found yet (likely still on the pump.fun bonding curve). Check <a href="${LINK_PUMP}" target="_blank" rel="noopener">pump.fun ↗</a> for the latest!`,
      failNote: `Could not fetch data. You can check directly on <a href="https://dexscreener.com/solana/${CA}" target="_blank" rel="noopener">DexScreener ↗</a>.`,
      chartLoading: 'Loading chart…',
      chartNoPair: `The chart appears once a DEX pair exists — <a href="${LINK_PUMP}" target="_blank" rel="noopener">view on pump.fun ↗</a>`,
      chartFail: `<a href="https://dexscreener.com/solana/${CA}" target="_blank" rel="noopener">View the chart on DexScreener ↗</a>`,
      share: (n, r) => `I petted the yajukawa coin $YJKW ${n} times 🐾✨\nRank: "${r}"\n#YJKW $YJKW`,
      milestones: {
        10: '🎉 10 pets! Evolved into "Junior yajukawa"!',
        50: '🎉 50 pets! Evolved into "Pet-pet artisan"!',
        100: '💯 100 pets! Evolved into "Certified yajukawa"!',
        500: '🔥 500 pets! Evolved into "Elite yajukawa"!',
        1000: '👑 1,000 pets! Evolved into "Yajukawa master"!',
        5000: '🌟 5,000 pets! "Yajukawa god" has arrived!!',
      },
    },
  };

  const EN = {
    'common.skip': 'Skip to content',
    'common.copy': 'Copy',
    'nav.about': 'About',
    'nav.stats': 'Live Data',
    'nav.tok': 'Tokenomics',
    'nav.buy': 'How to Buy',
    'nav.game': 'Game',
    'nav.map': 'Roadmap',
    'nav.faq': 'FAQ',
    'nav.community': 'Community',
    'nav.buyBtn': 'Buy 🚀',
    'hero.badge': 'SOLANA MEME COIN — born on pump.fun',
    'hero.tagline': 'Beast mode, but adorable.',
    'hero.sub': 'YAJUKAWA = yajū (beast) × kawaii (cute). The miracle meme coin that landed on Solana.',
    'hero.ctaPump': 'Buy on pump.fun 🚀',
    'hero.ctaX': 'Join the X Community 🐾',
    'hero.ctaLine': 'LINE OpenChat 💬',
    'hero.cue': 'SWIPE DOWN',
    'about.h2': 'What is $YJKW?',
    'about.lead': 'The moment that face became a meme, “yajukawa” was born.<br>Now nothing can stop it.',
    'about.c1.h': 'The yajukawa meme',
    'about.c1.p': 'Beast × cute — a miracle fusion. If it made you smirk for even a second, you are already one of us.',
    'about.c2.h': 'Silky smooth on Solana',
    'about.c2.p': 'Near-zero fees, instant settlement. This site is not the only thing here that runs buttery smooth.',
    'about.c3.h': 'Community is the product',
    'about.c3.p': 'Holders and meme artisans all hang out in the X community and the LINE OpenChat. Meme makers outrank everyone.',
    'about.c4.h': 'Diamond paws',
    'about.c4.p': 'Red candles? Yajukawa stays cute anyway. No panic — pets only.',
    'stats.h2': 'Live Data',
    'stats.lead': 'Auto-refreshes every 30 seconds',
    'stats.price': 'Price',
    'stats.mcap': 'Market cap',
    'stats.vol': '24h volume',
    'stats.liq': 'Liquidity',
    'stats.source': 'Data: DexScreener API',
    'tok.h2': 'Tokenomics',
    'tok.lead': 'Simple is best. Zero tricks, 100% yajukawa.',
    'tok.supply.l': 'Total supply',
    'tok.supply.d': '$YJKW — 1 billion. Yajukawa multiplies; the supply never does.',
    'tok.tax.l': 'Buy / sell tax',
    'tok.tax.d': 'Zero tax both ways. The only thing it takes is your heart.',
    'tok.mint.l': 'Mint authority',
    'tok.mint.v': 'Revoked',
    'tok.mint.d': 'pump.fun standard — no extra tokens can ever be minted.',
    'tok.lp.l': 'Liquidity',
    'tok.lp.v': 'LP burned',
    'tok.lp.d': 'LP is burned on Raydium migration (pump.fun standard).',
    'tok.note': `※ Based on standard pump.fun launch mechanics. Always verify the latest on-chain data on <a href="https://solscan.io/token/${CA}" target="_blank" rel="noopener">Solscan</a>.`,
    'buy.h2': 'How to buy — 4 steps',
    'buy.lead': 'From zero to yajukawa family in five minutes.',
    'buy.s1.h': '👛 Get a wallet',
    'buy.s1.p': 'Install a Solana wallet such as <a href="https://phantom.com" target="_blank" rel="noopener">Phantom</a> on your phone or browser.',
    'buy.s2.h': '◎ Get some SOL',
    'buy.s2.p': 'Buy SOL on an exchange and send it to your own wallet.',
    'buy.s3.h': '🔁 Swap for $YJKW',
    'buy.s3.p': 'Paste the CA on pump.fun and swap. <button class="copy-ca link-btn">Copy the CA</button> and drop it in the search bar.',
    'buy.s4.h': '🐾 Join the family',
    'buy.s4.p': 'Post “I bought some” in the community. The welcome energy is intense.',
    'buy.cta': 'Open pump.fun 🚀',
    'game.h2': 'Yajukawa Clicker',
    'game.lead': 'Tap the coin to pet the yajukawa. Your record is saved on this device.',
    'clicker.unit': ' pets',
    'clicker.rankLabel': 'Rank: ',
    'game.share': 'Share on X 🐾',
    'map.h2': 'Roadmap',
    'map.lead': 'Destination: the moon. Cuteness beats gravity.',
    'map.done': 'DONE ✅',
    'map.p1.h': 'Birth 🐣',
    'map.p1.l1': 'Launched on pump.fun',
    'map.p1.l2': 'X community opened',
    'map.p1.l3': 'LINE OpenChat opened',
    'map.p1.l4': 'This site was born',
    'map.p2.h': 'Multiplication 🧬',
    'map.p2.l1': 'Meme production at full scale',
    'map.p2.l2': 'PFPs start turning into yajukawa',
    'map.p2.l3': 'The holder circle keeps growing',
    'map.p3.h': 'Awakening ⚡',
    'map.p3.l1': 'Timelines flooded with yajukawa',
    'map.p3.l2': '“What is YJKW?” becomes the entry point',
    'map.p3.l3': 'Yajukawa appears in your dreams',
    'map.p4.h': 'Legend 🌕',
    'map.p4.l1': 'To the moon — cuteness beats gravity',
    'map.p4.l2': '“YJKW” becomes a greeting',
    'map.p4.l3': 'Beyond that, nobody knows',
    'comm.h2': 'Welcome to the yajukawa clubhouse',
    'comm.p': 'Memes, chatter, and screams at the chart — it all happens here.<br>$YJKW has two official communities: X and LINE.',
    'comm.x': 'Join the X Community 🐾',
    'comm.line': 'Join the LINE OpenChat 💬',
    'comm.sub': 'LINE OpenChat: “Yajukawa YJKW Community”',
    'comm.warn': '⚠️ Any invite link that arrives by DM is a scam. Never open them.',
    'faq.h2': 'FAQ',
    'faq.q1.q': 'What is $YJKW?',
    'faq.q1.a': 'A Solana meme coin symbolized by that face — “yajukawa”. Its utility is being cute and being funny. Nothing more, nothing less.',
    'faq.q2.q': 'Where can I buy it?',
    'faq.q2.a': `You can buy it on <a href="${LINK_PUMP}" target="_blank" rel="noopener">pump.fun</a> — paste the CA and swap. After the Raydium migration you will also be able to swap on DEXs like Jupiter.`,
    'faq.q3.q': 'What is the contract address (CA)?',
    'faq.q3.a': 'Watch out for copycat tokens. Always make sure the CA matches exactly before you buy.',
    'faq.q4.q': 'Which communities are official?',
    'faq.q4.a': 'Two: the X community and the LINE OpenChat “Yajukawa YJKW Community”. Use the buttons on this site. Never open links or airdrop offers sent to you by DM.',
    'faq.q5.q': 'Will the price go up?',
    'faq.q5.a': 'Honestly: nobody knows. Meme coins are extremely volatile, high-risk assets. Only use money you can afford to lose, and always DYOR. This is not financial advice.',
    'footer.x': 'X Community',
    'footer.line': 'LINE OpenChat',
    'footer.disclaimer': 'This is a community site for $YJKW and is not financial advice (NFA). Crypto assets — meme coins especially — are extremely volatile and high-risk. Buy and hold at your own risk, only with funds you can afford to lose. DYOR.',
  };

  const ARIA_EN = {
    'aria.lang': 'Switch language',
    'aria.menu': 'Menu',
    'aria.copy': 'Copy contract address',
    'aria.hero': 'Tap the coin',
    'aria.clicker': 'Pet the yajukawa',
    'aria.top': 'Back to top',
  };

  const jaHTML = {};
  const ariaJA = {};

  function snapshotJa() {
    $$('[data-i18n]').forEach(el => {
      if (!(el.dataset.i18n in jaHTML)) jaHTML[el.dataset.i18n] = el.innerHTML;
    });
    $$('[data-i18n-aria]').forEach(el => {
      const k = el.dataset.i18nAria;
      if (!(k in ariaJA)) ariaJA[k] = el.getAttribute('aria-label') || '';
    });
  }

  function applyLang(next) {
    lang = next;
    store.set('yjkw_lang', lang);
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach(el => {
      const k = el.dataset.i18n;
      const v = lang === 'ja' ? jaHTML[k] : EN[k];
      if (v != null) el.innerHTML = v;
    });
    $$('[data-i18n-aria]').forEach(el => {
      const k = el.dataset.i18nAria;
      const v = lang === 'ja' ? ariaJA[k] : ARIA_EN[k];
      if (v) el.setAttribute('aria-label', v);
    });
    document.title = STR[lang].docTitle;
    const md = $('meta[name="description"]');
    if (md) md.content = STR[lang].metaDesc;
    $$('.lang-toggle span').forEach(s =>
      s.classList.toggle('active', s.dataset.l === lang));
    renderClicker();
    renderStatMeta();
    measureParallax();
  }

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
     モバイルはネイティブスクロール + fxY 補間でヌルヌルに
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
     CAコピー(言語切替でボタンが再生成されるためデリゲーション)
  ------------------------------------------------------------------ */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy-ca');
    if (!btn) return;
    copyCA();
  });

  async function copyCA() {
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
    toast(ok ? STR[lang].copied : STR[lang].copyFail);
  }

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
  let lastUpdatedStr = '';
  let noteState = null; // null | 'nopair' | 'fail'

  function renderStatMeta() {
    statUpdated.textContent = lastUpdatedStr ? STR[lang].updated(lastUpdatedStr) : '';
    if (noteState === 'nopair') {
      statNote.innerHTML = STR[lang].noPairNote;
      statNote.hidden = false;
    } else if (noteState === 'fail') {
      statNote.innerHTML = STR[lang].failNote;
      statNote.hidden = false;
    } else {
      statNote.hidden = true;
    }
    if (!chartMounted && chartSkeleton.isConnected) {
      const span = chartSkeleton.querySelector('span');
      if (span) {
        span.innerHTML = noteState === 'nopair' ? STR[lang].chartNoPair
          : noteState === 'fail' ? STR[lang].chartFail
          : STR[lang].chartLoading;
      }
    }
  }

  function mountChartIfReady() {
    if (chartMounted || !pairAddr || !chartVisible) return;
    chartMounted = true;
    const iframe = document.createElement('iframe');
    iframe.title = '$YJKW chart (DexScreener)';
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
      lastUpdatedStr = new Date().toLocaleTimeString(lang === 'ja' ? 'ja-JP' : 'en-US');

      if (!pairs.length) {
        noteState = 'nopair';
        renderStatMeta();
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

      noteState = null;
      gotData = true;
      renderStatMeta();

      if (best.pairAddress) {
        pairAddr = best.pairAddress;
        mountChartIfReady();
      }
    } catch {
      if (!gotData) {
        noteState = 'fail';
        renderStatMeta();
      }
    }
  }

  loadStats(true);
  setInterval(() => { if (!document.hidden) loadStats(false); }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadStats(false);
  });

  /* ------------------------------------------------------------------
     やじゅかわクリッカー
  ------------------------------------------------------------------ */
  const PETS_KEY = 'yjkw_pets';
  const clickerCoin = $('#clickerCoin');
  const clickCountEl = $('#clickCount');
  const clickRankEl = $('#clickRank');
  const comboBadge = $('#comboBadge');
  const coinWrap = $('.clicker-coin-wrap');

  let pets = parseInt(store.get(PETS_KEY) || '0', 10) || 0;
  let combo = 0;
  let lastTap = 0;
  let comboTimer = null;
  let popTimer = null;

  const RANKS = [
    [0, 'やじゅかわ見習い', 'Yajukawa rookie'],
    [10, '駆け出しやじゅかわ', 'Junior yajukawa'],
    [50, 'なでなで職人', 'Pet-pet artisan'],
    [100, '一人前のやじゅかわ', 'Certified yajukawa'],
    [500, 'やじゅかわエリート', 'Elite yajukawa'],
    [1000, 'やじゅかわマスター', 'Yajukawa master'],
    [5000, 'やじゅかわの神', 'Yajukawa god'],
  ];

  function rankFor(n) {
    let r = RANKS[0];
    RANKS.forEach(row => { if (n >= row[0]) r = row; });
    return lang === 'ja' ? r[1] : r[2];
  }
  function renderClicker() {
    clickCountEl.textContent = pets.toLocaleString('en-US');
    clickRankEl.textContent = rankFor(pets);
  }

  function floatLabel() {
    if (reduced || !coinWrap) return;
    const span = document.createElement('span');
    span.className = 'float-label';
    span.textContent = Math.random() < 0.12 ? '🐾' : Math.random() < 0.5 ? '+1' : '💛';
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
    store.set(PETS_KEY, String(pets));
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

    const msg = STR[lang].milestones[pets];
    if (msg) {
      toast(msg);
      coinRain(18);
    }
  }

  clickerCoin.addEventListener('pointerdown', petOnce);
  clickerCoin.addEventListener('click', (e) => { if (e.detail === 0) petOnce(); }); // キーボード操作

  $('#shareX').addEventListener('click', () => {
    const text = STR[lang].share(pets.toLocaleString('en-US'), rankFor(pets));
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
     言語トグル
  ------------------------------------------------------------------ */
  snapshotJa();
  $$('.lang-toggle').forEach(btn => {
    btn.addEventListener('click', () => applyLang(lang === 'ja' ? 'en' : 'ja'));
  });
  applyLang(lang);

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

  console.log('%c$YJKW 🐾 野獣なのに、かわいい。/ Beast mode, but adorable.', 'font-size:16px;font-weight:bold;color:#f5c542');
})();
