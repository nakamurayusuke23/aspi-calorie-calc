// 手続き最適化アプリ — Mode A 消化シミュレーター / Mode B 残チケットの価値
// 計算ロジックは Google Sheets「退会＆ダウンセル阻止ツール」(1zbsuohuo3aW5z6g7iSBx1A61z9qpXAo6RDC0Uf0sZPM) を踏襲
// 顧客対面用UI: 提案文・締切日は出さず、消化完了月を中心に表示

(() => {
  const state = {
    pricing: null,
    chart: null,
    candidates: new Set(), // Mode A: 選択中プランlabel
  };

  const $ = (id) => document.getElementById(id);
  const els = (sel) => document.querySelectorAll(sel);
  const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');

  function toMin(value, unit, sessionMin) {
    return unit === 'count' ? value * sessionMin : value;
  }
  function minToCount(min, sessionMin) {
    return Math.round((min / sessionMin) * 10) / 10;
  }

  // ===== 計算 =====
  function calcLoss(remainingMin, yenPerMin) {
    return Math.floor((remainingMin * yenPerMin) / 100) * 100;
  }
  function calcDischargeMonths(remainingMin, planMinPerMonth, paceMin) {
    const dec = paceMin - planMinPerMonth;
    if (dec <= 0) return { months: null, monthlyDecrement: dec, valid: false };
    return { months: Math.ceil(remainingMin / dec), monthlyDecrement: dec, valid: true };
  }
  // 適用月（YYYY-MM）から N ヶ月後の年月を返す（適用月＝1ヶ月目とする）
  function addMonths(applyYM, monthsToAdd) {
    const [y, m] = applyYM.split('-').map(Number);
    const idx = (m - 1) + (monthsToAdd - 1);
    return { year: y + Math.floor(idx / 12), month: (idx % 12) + 1 };
  }
  function timelineSeries(remainingMin, planMinPerMonth, paceMin) {
    const dec = paceMin - planMinPerMonth;
    const series = [{ x: 0, y: remainingMin }];
    if (dec <= 0) {
      for (let i = 1; i <= 12; i++) series.push({ x: i, y: remainingMin });
      return series;
    }
    let r = remainingMin;
    let i = 0;
    while (r > 0 && i < 60) {
      i++;
      r = Math.max(0, r - dec);
      series.push({ x: i, y: r });
    }
    return series;
  }

  // ===== 初期化 =====
  async function loadPricing() {
    const res = await fetch('data/pricing.json', { cache: 'no-cache' });
    state.pricing = await res.json();
  }

  function initSelectors() {
    const { plans, categories } = state.pricing;

    const cur = $('A-currentPlan');
    plans.forEach(p => {
      const o = document.createElement('option');
      o.value = p.label; o.textContent = `${p.label}（月${p.min_per_month}分）`;
      cur.appendChild(o);
    });
    cur.value = '月8';

    const chipBox = $('A-candidates');
    plans.forEach(p => {
      const c = document.createElement('div');
      c.className = 'plan-chip';
      c.textContent = p.label;
      c.dataset.plan = p.label;
      c.addEventListener('click', () => {
        if (state.candidates.has(p.label)) {
          state.candidates.delete(p.label);
          c.classList.remove('selected');
        } else if (state.candidates.size < 3) {
          state.candidates.add(p.label);
          c.classList.add('selected');
        }
        runModeA();
      });
      chipBox.appendChild(c);
    });

    // 適用月：年・月の2セレクト（クロスブラウザで安定動作）
    const ySel = $('A-applyYear');
    const mSel = $('A-applyMonth');
    const now = new Date();
    const yStart = now.getFullYear() - 1;
    const yEnd = 2035;
    for (let y = yStart; y <= yEnd; y++) {
      const o = document.createElement('option');
      o.value = y; o.textContent = `${y}年`;
      ySel.appendChild(o);
    }
    for (let m = 1; m <= 12; m++) {
      const o = document.createElement('option');
      o.value = m; o.textContent = `${m}月`;
      mSel.appendChild(o);
    }
    ySel.value = now.getFullYear();
    mSel.value = now.getMonth() + 1;

    const bCat = $('B-category');
    categories.forEach(cat => {
      const o = document.createElement('option');
      o.value = cat.id; o.textContent = cat.label;
      bCat.appendChild(o);
    });

    const bPlan = $('B-plan');
    plans.forEach(p => {
      const o = document.createElement('option');
      o.value = p.label; o.textContent = `${p.label}（月${p.min_per_month}分）`;
      bPlan.appendChild(o);
    });
    bPlan.value = '月8';
  }

  // ===== Mode A レンダ =====
  function runModeA() {
    if (!state.pricing) return;
    const sm = state.pricing.session_min;
    const plans = state.pricing.plans;
    const remaining = toMin(Number($('A-remaining').value || 0), $('A-remainingUnit').value, sm);
    const pace      = toMin(Number($('A-paceValue').value || 0), $('A-paceUnit').value, sm);
    const applyY    = Number($('A-applyYear').value);
    const applyM    = Number($('A-applyMonth').value);
    const applyYM   = `${applyY}-${String(applyM).padStart(2, '0')}`;

    let candidateLabels = Array.from(state.candidates);
    if (candidateLabels.length === 0) candidateLabels = [$('A-currentPlan').value];

    const results = candidateLabels.map(label => {
      const plan = plans.find(p => p.label === label);
      const calc = calcDischargeMonths(remaining, plan.min_per_month, pace);
      let completion = null;
      if (calc.valid) completion = addMonths(applyYM, calc.months);
      return { label, plan, ...calc, completion, series: timelineSeries(remaining, plan.min_per_month, pace) };
    });

    renderChart(results);
    renderCards(results, sm);
  }

  function renderChart(results) {
    const ctx = $('A-chart').getContext('2d');
    if (state.chart) state.chart.destroy();

    const palette = ['#475569', '#0d9488', '#a16207'];
    const datasets = results.map((r, i) => ({
      label: `${r.label}（月${r.plan.min_per_month}分）`,
      data: r.series,
      borderColor: palette[i % palette.length],
      backgroundColor: palette[i % palette.length] + '22',
      tension: 0.1,
      pointRadius: 3,
      borderWidth: 2.5,
      fill: false,
    }));

    state.chart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        scales: {
          x: { type: 'linear', title: { display: true, text: '経過月（適用月＝0）' }, ticks: { stepSize: 1 } },
          y: { title: { display: true, text: '残チケット（分）' }, beginAtZero: true },
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (item) => `${item.dataset.label}: ${item.parsed.y}分（${(item.parsed.y / 30).toFixed(1)}回）`
            }
          }
        }
      }
    });
  }

  function renderCards(results, sm) {
    const box = $('A-cards');
    box.innerHTML = '';
    const paceUnit = $('A-paceUnit').value === 'min' ? '分' : '回';
    const paceLabel = `月${$('A-paceValue').value}${paceUnit}`;
    results.forEach(r => {
      const card = document.createElement('div');
      card.className = 'summary-card' + (r.valid ? '' : ' invalid');
      if (!r.valid) {
        card.innerHTML = `
          <div class="plan-name">${r.label}</div>
          <p class="reason">月の付与（${r.plan.min_per_month}分）が通うペース（${paceLabel}）以上のため、計画的に減らせません。</p>
        `;
      } else {
        const c = r.completion;
        const limit = r.plan.reservation_limit;
        card.innerHTML = `
          <div class="plan-name">${r.label}</div>
          <div class="completion-ym">
            <span class="y-num">${c.year}</span><span class="y-suffix">年</span><span class="m-num">${c.month}</span><span class="m-suffix">月</span>
          </div>
          <p class="completion-suffix">までに使い切れます</p>
          <div class="reservation-row">
            <span class="reservation-label">予約上限</span>
            <span class="reservation-value">${limit}<span class="reservation-unit">件</span></span>
          </div>
          <p class="pace-note">月${r.monthlyDecrement}分（${minToCount(r.monthlyDecrement, sm)}回）の純消化／全${r.months}ヶ月</p>
        `;
      }
      box.appendChild(card);
    });
  }

  // ===== Mode B =====
  function runModeB() {
    if (!state.pricing) return;
    const sm = state.pricing.session_min;
    const catId = $('B-category').value;
    const cat = state.pricing.categories.find(c => c.id === catId);
    const planLabel = $('B-plan').value;
    const plan = state.pricing.plans.find(p => p.label === planLabel);
    const remaining = toMin(Number($('B-remaining').value || 0), $('B-remainingUnit').value, sm);
    const sessionCount = minToCount(remaining, sm);

    const fee = plan.fees[catId];
    if (fee == null) {
      $('B-amount').textContent = '—';
      $('B-breakdown').innerHTML = `${cat.label} × ${plan.label} の料金データが未登録のため算出できません。`;
      $('B-feeNote').textContent = '※ 料金未登録プラン（PDF記載なし）';
      return;
    }

    const yenPerMin = fee / plan.min_per_month;
    const loss = calcLoss(remaining, yenPerMin);
    const monthsEquiv = remaining > 0 ? (remaining / plan.min_per_month) : 0;

    $('B-amount').textContent = yen(loss);
    $('B-breakdown').innerHTML = `
      残 <strong>${remaining}分</strong>（約 <strong>${sessionCount}回</strong>）<br/>
      <span class="opacity-80">月会費の約 <strong>${monthsEquiv.toFixed(1)}ヶ月分</strong>に相当</span>
    `;
    $('B-feeNote').textContent = `内部単価: ¥${(Math.round(yenPerMin * 100) / 100).toLocaleString('ja-JP')}/分`;
  }

  // ===== Mode B → A 値引継ぎ =====
  function bToA() {
    $('A-remaining').value = $('B-remaining').value;
    $('A-remainingUnit').value = $('B-remainingUnit').value;
    runModeA();
    if (window.appShell && typeof window.appShell.switchTab === 'function') {
      window.appShell.switchTab('plan');
    }
  }

  // ===== 単位ヘルプ =====
  function updateUnitHelp() {
    const sm = state.pricing.session_min;
    const u = $('A-remainingUnit').value;
    const v = Number($('A-remaining').value) || 0;
    $('A-remainingHelp').textContent = u === 'count'
      ? `1回 = ${sm}分（合計 ${v * sm}分）`
      : `1回 = ${sm}分`;
  }

  // ===== 起動 =====
  async function boot() {
    await loadPricing();
    initSelectors();

    // Mode A: 全入力でリアクティブ更新
    ['A-currentPlan','A-remaining','A-remainingUnit','A-applyYear','A-applyMonth','A-paceValue','A-paceUnit'].forEach(id => {
      const el = $(id);
      const ev = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(ev, () => { updateUnitHelp(); runModeA(); });
    });

    // Mode B: リアクティブ
    ['B-category','B-plan','B-remaining','B-remainingUnit'].forEach(id => {
      const el = $(id);
      const ev = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(ev, runModeB);
    });

    $('B-toA').addEventListener('click', bToA);

    updateUnitHelp();
    runModeA();
    runModeB();

    // shell からタブ表示時に再描画呼び出せるよう公開
    window.ticketApp = { runModeA, runModeB };
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
