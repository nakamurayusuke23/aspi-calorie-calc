/* ui.js — DOMバインディングのみ。計算/判定はcalc.js / alert.jsに委譲。 */
(function () {
  'use strict';

  const STORAGE_KEY = 'aspi.calorie.v1';

  const DEFAULTS = {
    sex: 'M',
    age: '',
    height: '',
    weight: '',
    activity: 1.5,
    goal: 'maintain',
    pCoef: 2.0,
    cRatio: 0.5,
    goalKg: '',
    goalMonths: '',
  };

  const RANGES = {
    age:    { min: 1,   max: 100, step: 1   },
    height: { min: 100, max: 220, step: 0.1 },
    weight: { min: 30,  max: 200, step: 0.1 },
  };

  const GOAL_RANGES = {
    goalKg:     { min: 0.1,  max: 50, label: '目標体重変化' },
    goalMonths: { min: 0.25, max: 24, label: '期間' },
  };

  // ---- DOM helpers ----
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function init() {
    buildActivityOptions();
    restoreState();
    bindEvents();
    recalc();
  }

  function buildActivityOptions() {
    const sel = $('#activity');
    Calc.ACTIVITY_LEVELS.forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = String(value);
      opt.textContent = `×${value} — ${label}`;
      sel.appendChild(opt);
    });
  }

  function readForm() {
    const sex = ($$('input[name="sex"]').find(r => r.checked) || {}).value || 'M';
    const goal = ($$('input[name="goal"]').find(r => r.checked) || {}).value || 'maintain';
    const goalKgRaw     = $('#goalKg').value;
    const goalMonthsRaw = $('#goalMonths').value;
    return {
      sex,
      age:      parseFloat($('#age').value),
      height:   parseFloat($('#height').value),
      weight:   parseFloat($('#weight').value),
      activity: parseFloat($('#activity').value),
      goal,
      pCoef:    DEFAULTS.pCoef,
      cRatio:   DEFAULTS.cRatio,
      goalKg:     goalKgRaw     === '' ? '' : parseFloat(goalKgRaw),
      goalMonths: goalMonthsRaw === '' ? '' : parseFloat(goalMonthsRaw),
    };
  }

  function writeForm(state) {
    $$('input[name="sex"]').forEach(r => { r.checked = (r.value === state.sex); });
    $$('input[name="goal"]').forEach(r => { r.checked = (r.value === state.goal); });
    $('#age').value        = state.age ?? '';
    $('#height').value     = state.height ?? '';
    $('#weight').value     = state.weight ?? '';
    $('#activity').value   = String(state.activity ?? DEFAULTS.activity);
    $('#goalKg').value     = state.goalKg ?? '';
    $('#goalMonths').value = state.goalMonths ?? '';
  }

  function bindEvents() {
    const inputs = ['#age', '#height', '#weight', '#activity', '#goalKg', '#goalMonths'];
    inputs.forEach(sel => $(sel).addEventListener('input', recalc));
    $$('input[name="sex"]').forEach(r => r.addEventListener('change', recalc));
    $$('input[name="goal"]').forEach(r => r.addEventListener('change', recalc));
    $('#reset').addEventListener('click', resetAll);
  }

  function updateGoalBlockVisibility(goal) {
    const block = $('#goalBlock');
    const show = (goal === 'cut' || goal === 'bulk');
    block.hidden = !show;
    if (!show) {
      $('#goalKg').value = '';
      $('#goalMonths').value = '';
    }
  }

  function validate(state) {
    const errs = {};
    for (const key of ['age', 'height', 'weight']) {
      const v = state[key];
      const r = RANGES[key];
      if (!Number.isFinite(v))                             errs[key] = '入力してください';
      else if (v < r.min || v > r.max)                     errs[key] = `${r.min}〜${r.max}で入力`;
    }
    return errs;
  }

  function applyValidationStyle(errs) {
    ['age', 'height', 'weight'].forEach(key => {
      const el  = $('#' + key);
      const msg = $('#err-' + key);
      if (errs[key]) {
        el.classList.add('invalid');
        msg.textContent = errs[key];
      } else {
        el.classList.remove('invalid');
        msg.textContent = '';
      }
    });
  }

  function recalc() {
    const state = readForm();
    updateGoalBlockVisibility(state.goal);
    persistState(state);

    const errs = validate(state);
    applyValidationStyle(errs);

    if (Object.keys(errs).length > 0) {
      renderEmpty();
      return;
    }

    // ベース計算（±500kcalのデフォルトモード）
    const baseResult = Calc.compute(state);

    // 目標逆算モード判定: goalKg と goalMonths が両方有効ならそちらを優先
    const goalPlan = Calc.calcGoalPlan({
      goal: state.goal,
      deltaKg: state.goalKg,
      months: state.goalMonths,
      weight: state.weight,
      tdee: baseResult.tdee,
    });

    // 目標逆算が有効ならtargetを差し替えてPFC再計算
    let result = baseResult;
    let mode = 'fixed';
    if (goalPlan) {
      const targetFromGoal = goalPlan.targetFromGoal;
      const pfc = Calc.calcPFC({
        target: targetFromGoal,
        weight: state.weight,
        pCoef: state.pCoef,
        cRatio: state.cRatio,
      });
      result = {
        ...baseResult,
        target: targetFromGoal,
        pfc,
      };
      mode = 'goal';
    }

    const alerts = AlertEngine.evaluate({
      sex: state.sex,
      weight: state.weight,
      goal: state.goal,
      bmr: result.bmr,
      tdee: result.tdee,
      target: result.target,
      pfc: result.pfc,
      bmi: result.bmi,
    });

    // BMR割れチェックを目標プランの判定にも反映
    if (goalPlan && result.target < result.bmr) {
      goalPlan.verdict = 'discouraged';
      goalPlan.reasons.unshift(`逆算結果 ${Math.round(result.target)}kcal が基礎代謝 ${Math.round(result.bmr)}kcal を下回ります。期間を伸ばしてください。`);
    }

    renderResult(state, result, alerts, goalPlan, mode);
  }

  // ---- Render ----
  function renderEmpty() {
    $('#result').classList.add('result--empty');
    $('#goalCard').innerHTML = '';
    $('#alerts').innerHTML = '';
    $('#numbers').innerHTML = '<p class="placeholder">入力を完了してください</p>';
    $('#pfc-bar').innerHTML = '';
    $('#pfc-list').innerHTML = '';
    $('#rationale').textContent = '';
  }

  function renderResult(state, r, alerts, goalPlan, mode) {
    $('#result').classList.remove('result--empty');
    renderGoalCard(state, goalPlan);
    renderAlerts(alerts);
    renderNumbers(state, r, mode);
    renderPFC(r.pfc, r.target);
    renderRationale(state, mode, goalPlan);
  }

  function renderGoalCard(state, plan) {
    const wrap = $('#goalCard');
    if (!plan) {
      wrap.innerHTML = '';
      return;
    }
    const verdictMeta = {
      recommended: { cls: 'goal--ok',     label: '推奨ペース' },
      caution:     { cls: 'goal--warn',   label: '要注意ペース' },
      discouraged: { cls: 'goal--danger', label: '不推奨ペース' },
    }[plan.verdict];
    const direction = state.goal === 'cut' ? '減量' : '増量';
    const sign = state.goal === 'cut' ? '-' : '+';
    const reasonsHtml = plan.reasons.length === 0
      ? '<li>推奨レンジ内のペースです</li>'
      : plan.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('');

    wrap.innerHTML = `
      <div class="goal ${verdictMeta.cls}">
        <div class="goal__head">
          <span class="goal__badge">${verdictMeta.label}</span>
          <span class="goal__title">目標: ${plan.months}ヶ月で ${sign}${plan.deltaKg}kg ${direction}</span>
        </div>
        <div class="goal__metrics">
          <div class="goal__metric">
            <span class="goal__metric-label">必要1日${state.goal === 'cut' ? '赤字' : '黒字'}</span>
            <span class="goal__metric-value">${Math.round(plan.perDay)} kcal</span>
          </div>
          <div class="goal__metric">
            <span class="goal__metric-label">週間ペース</span>
            <span class="goal__metric-value">${plan.weeklyKg.toFixed(2)} kg<span class="goal__metric-sub">/週 (${plan.weeklyPct.toFixed(2)}%)</span></span>
          </div>
          <div class="goal__metric">
            <span class="goal__metric-label">推奨摂取カロリー</span>
            <span class="goal__metric-value">${Math.round(plan.targetFromGoal)} kcal</span>
          </div>
        </div>
        <ul class="goal__reasons">${reasonsHtml}</ul>
      </div>
    `;
  }

  function renderAlerts(alerts) {
    const wrap = $('#alerts');
    if (alerts.length === 0) {
      wrap.innerHTML = '';
      return;
    }
    const top = AlertEngine.topLevel(alerts);
    const cls   = top === 'danger' ? 'alert alert--danger' : 'alert alert--warn';
    const label = top === 'danger' ? '見直しを強く推奨'    : '設定の見直しを推奨';
    const items = alerts.map(a => `
      <li class="alert__item">
        <strong>${escapeHtml(a.text)}</strong>
        <span class="alert__item-detail">${escapeHtml(a.detail || '')}</span>
      </li>
    `).join('');
    wrap.innerHTML = `
      <div class="${cls}" role="alert">
        <div class="alert__head">${label}</div>
        <ul class="alert__list">${items}</ul>
      </div>
    `;
  }

  function renderNumbers(state, r, mode) {
    const goalLabel = Calc.GOALS[state.goal].label;
    const delta     = Calc.GOALS[state.goal].delta;
    let deltaStr;
    if (mode === 'goal') {
      const diff = r.target - r.tdee;
      const sign = diff >= 0 ? '+' : '';
      deltaStr = `（${goalLabel}・目標逆算 ${sign}${Math.round(diff)}kcal）`;
    } else {
      deltaStr = delta === 0 ? '' : `（${goalLabel} ${delta > 0 ? '+' : ''}${delta}kcal）`;
    }
    $('#numbers').innerHTML = `
      <dl class="kpi">
        <div class="kpi__row kpi__row--target">
          <dt>あなたに必要な1日のカロリー</dt>
          <dd><strong>${Math.round(r.target).toLocaleString()}</strong> kcal <span class="kpi__delta">${deltaStr}</span></dd>
        </div>
        <div class="kpi__row">
          <dt>基礎代謝 (BMR)</dt>
          <dd><strong>${Math.round(r.bmr)}</strong> kcal</dd>
        </div>
        <div class="kpi__row">
          <dt>維持カロリー (TDEE)</dt>
          <dd><strong>${Math.round(r.tdee)}</strong> kcal</dd>
        </div>
        <div class="kpi__row kpi__row--sub">
          <dt>BMI（参考）</dt>
          <dd>${r.bmi.toFixed(1)}</dd>
        </div>
      </dl>
    `;
  }

  function renderPFC(pfc, target) {
    const total = pfc.P.kcal + pfc.F.kcal + pfc.C.kcal;
    const safe  = total > 0 ? total : 1;
    const pct = {
      P: (pfc.P.kcal / safe) * 100,
      F: (pfc.F.kcal / safe) * 100,
      C: (pfc.C.kcal / safe) * 100,
    };

    // SVG 横棒バー
    const w = 100;
    const segments = [
      { key: 'P', class: 'bar--p', start: 0,                  width: pct.P },
      { key: 'F', class: 'bar--f', start: pct.P,              width: pct.F },
      { key: 'C', class: 'bar--c', start: pct.P + pct.F,      width: pct.C },
    ].map(s => `<rect class="${s.class}" x="${s.start}%" y="0" width="${s.width}%" height="100%"></rect>`).join('');

    $('#pfc-bar').innerHTML = `
      <svg class="bar" viewBox="0 0 ${w} 24" preserveAspectRatio="none" aria-label="PFC構成比">
        ${segments}
      </svg>
    `;

    $('#pfc-list').innerHTML = `
      <ul class="pfc">
        <li class="pfc__item pfc__item--p">
          <span class="pfc__chip">P</span>
          <span class="pfc__label">タンパク質</span>
          <span class="pfc__g"><strong>${pfc.P.g.toFixed(1)}</strong> g</span>
          <span class="pfc__kcal">${Math.round(pfc.P.kcal)} kcal</span>
          <span class="pfc__pct">${pct.P.toFixed(0)}%</span>
        </li>
        <li class="pfc__item pfc__item--f">
          <span class="pfc__chip">F</span>
          <span class="pfc__label">脂質</span>
          <span class="pfc__g"><strong>${pfc.F.g.toFixed(1)}</strong> g</span>
          <span class="pfc__kcal">${Math.round(pfc.F.kcal)} kcal</span>
          <span class="pfc__pct">${pct.F.toFixed(0)}%</span>
        </li>
        <li class="pfc__item pfc__item--c">
          <span class="pfc__chip">C</span>
          <span class="pfc__label">糖質</span>
          <span class="pfc__g"><strong>${pfc.C.g.toFixed(1)}</strong> g</span>
          <span class="pfc__kcal">${Math.round(pfc.C.kcal)} kcal</span>
          <span class="pfc__pct">${pct.C.toFixed(0)}%</span>
        </li>
      </ul>
    `;
  }

  function renderRationale(state, mode, plan) {
    const goal = Calc.GOALS[state.goal];
    let goalText;
    if (mode === 'goal' && plan) {
      const sign = state.goal === 'cut' ? '-' : '+';
      goalText = `${goal.label}・目標逆算（${plan.months}ヶ月で ${sign}${plan.deltaKg}kg → 1日 ${Math.round(plan.perDay)}kcal ${state.goal === 'cut' ? '赤字' : '黒字'}）`;
    } else {
      goalText = goal.delta === 0 ? '維持' : `${goal.label}（${goal.delta > 0 ? '+' : ''}${goal.delta}kcal）`;
    }
    $('#rationale').innerHTML = `
      <span>計算根拠</span>
      ハリス・ベネディクト式 ・ 活動係数 ×${state.activity}
      ・ 目的: ${escapeHtml(goalText)}
      ・ P: 体重×${state.pCoef.toFixed(1)}g
      ・ C: ${Math.round(state.cRatio * 100)}%
      ・ F: 残り
    `;
  }

  // ---- Persistence ----
  function persistState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) { /* localStorage不可環境は無視 */ }
  }

  function restoreState() {
    let state = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state = { ...state, ...JSON.parse(raw) };
    } catch (_) { /* 破損データは無視 */ }
    writeForm(state);
  }

  function resetAll() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* noop */ }
    writeForm(DEFAULTS);
    recalc();
  }

  // ---- Utils ----
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
