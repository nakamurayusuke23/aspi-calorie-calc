/* calc.js — pure functions for BMR / TDEE / 目標カロリー / PFC
 * 出典: ニュートリションコーチ.pdf p.74〜p.78
 * 副作用なし。ブラウザのconsoleからも単体検証可能。
 */
(function (global) {
  'use strict';

  const ACTIVITY_LEVELS = [
    { value: 1.2,   label: 'ほぼ運動ナシ（デスクワーク中心）' },
    { value: 1.375, label: '週1〜3回の軽い運動' },
    { value: 1.5,   label: '週3〜5回の中程度の運動' },
    { value: 1.75,  label: '週5〜7回の激しい運動' },
    { value: 1.9,   label: '毎日の激しい運動＋肉体労働/マラソン' },
  ];

  const GOALS = {
    cut:      { label: '減量', delta: -500 },
    maintain: { label: '維持', delta: 0    },
    bulk:     { label: '増量', delta: +500 },
  };

  // 体脂肪 1kg ≒ 7000kcal（ニュートリションコーチ.pdf p.78 実践例の前提）
  const KCAL_PER_KG_FAT = 7000;
  const DAYS_PER_MONTH  = 30; // 概算（月→日換算）

  // ハリス・ベネディクト式
  function calcBMR({ sex, weight, height, age }) {
    if (sex === 'M') {
      return 66.47 + (13.75 * weight) + (5.00 * height) - (6.78 * age);
    }
    return 655.1 + (9.56 * weight) + (1.85 * height) - (4.68 * age);
  }

  function calcTDEE(bmr, activity) {
    return bmr * activity;
  }

  function calcTarget(tdee, goal) {
    const g = GOALS[goal];
    if (!g) throw new Error('unknown goal: ' + goal);
    return tdee + g.delta;
  }

  // PFC: P → C → F の残り
  function calcPFC({ target, weight, pCoef, cRatio }) {
    const P_g    = weight * pCoef;
    const P_kcal = P_g * 4;
    const C_kcal = target * cRatio;
    const C_g    = C_kcal / 4;
    const F_kcal = target - P_kcal - C_kcal;
    const F_g    = F_kcal / 9;
    return {
      P: { g: P_g, kcal: P_kcal },
      F: { g: F_g, kcal: F_kcal },
      C: { g: C_g, kcal: C_kcal },
    };
  }

  // 目標から1日のカロリー赤字/黒字を逆算 → 推奨/要注意/不推奨を判定
  // 入力: { goal('cut'|'bulk'), deltaKg(>0), months, weight, tdee }
  // 出力: {
  //   deltaKg, months, days, perDay, weeklyKg, weeklyPct,
  //   targetFromGoal (TDEE±perDay),
  //   verdict: 'recommended'|'caution'|'discouraged',
  //   reasons: string[]
  // }
  function calcGoalPlan({ goal, deltaKg, months, weight, tdee }) {
    if (!(goal === 'cut' || goal === 'bulk')) return null;
    if (!Number.isFinite(deltaKg) || deltaKg <= 0) return null;
    if (!Number.isFinite(months) || months <= 0) return null;

    const days      = months * DAYS_PER_MONTH;
    const totalKcal = deltaKg * KCAL_PER_KG_FAT;
    const perDay    = totalKcal / days;
    const weeklyKg  = (perDay * 7) / KCAL_PER_KG_FAT;
    const weeklyPct = (weeklyKg / weight) * 100;

    // エビデンス閾値（ニュートリションコーチ p.77 / p.78）
    // 減量: 週 体重×1% を超えると筋分解亢進 → 1日赤字上限 = 体重×10kcal/日
    // 増量: +500kcal/日を超えると筋肥大頭打ち、+750kcal/日超で脂肪蓄積優位
    const cutDailyMaxRecommended  = weight * 10;
    const cutDailyMaxCaution      = weight * 10 * 1.1;
    const bulkDailyMaxRecommended = 500;
    const bulkDailyMaxCaution     = 750;

    let targetFromGoal;
    let verdict = 'recommended';
    const reasons = [];

    if (goal === 'cut') {
      targetFromGoal = tdee - perDay;
      if (perDay > cutDailyMaxCaution) {
        verdict = 'discouraged';
        reasons.push(`1日赤字 ${Math.round(perDay)}kcal は週減量${weeklyPct.toFixed(2)}%（${weeklyKg.toFixed(2)}kg/週）で、推奨上限「週1%」を大きく超過。筋分解亢進・代謝低下のリスクがあります。`);
      } else if (perDay > cutDailyMaxRecommended) {
        verdict = 'caution';
        reasons.push(`1日赤字 ${Math.round(perDay)}kcal は週減量${weeklyPct.toFixed(2)}% で推奨ライン（週1%）をわずかに超過。期間を伸ばすか目標を緩和すると安全です。`);
      } else if (perDay < weight * 3) {
        verdict = 'caution';
        reasons.push(`1日赤字 ${Math.round(perDay)}kcal は緩やか過ぎて体感成果が出にくい可能性。期間短縮または目標増量も検討してください。`);
      }
    } else {
      targetFromGoal = tdee + perDay;
      if (perDay > bulkDailyMaxCaution) {
        verdict = 'discouraged';
        reasons.push(`1日黒字 ${Math.round(perDay)}kcal は推奨上限+500kcalを大きく超過。+500kcal以上では筋肥大効果が頭打ちで脂肪蓄積優位になります。`);
      } else if (perDay > bulkDailyMaxRecommended) {
        verdict = 'caution';
        reasons.push(`1日黒字 ${Math.round(perDay)}kcal は推奨上限+500kcalを超過。期間を延ばすと筋肥大効率が改善します。`);
      }
    }

    return {
      deltaKg, months, days, perDay,
      weeklyKg, weeklyPct,
      targetFromGoal,
      verdict, reasons,
    };
  }

  function calcBMI(weightKg, heightCm) {
    const m = heightCm / 100;
    return weightKg / (m * m);
  }

  function compute(input) {
    const bmr    = calcBMR(input);
    const tdee   = calcTDEE(bmr, input.activity);
    const target = calcTarget(tdee, input.goal);
    const pfc    = calcPFC({
      target,
      weight: input.weight,
      pCoef: input.pCoef,
      cRatio: input.cRatio,
    });
    const bmi = calcBMI(input.weight, input.height);
    return { bmr, tdee, target, pfc, bmi };
  }

  global.Calc = {
    ACTIVITY_LEVELS,
    GOALS,
    KCAL_PER_KG_FAT,
    DAYS_PER_MONTH,
    calcBMR,
    calcTDEE,
    calcTarget,
    calcPFC,
    calcBMI,
    calcGoalPlan,
    compute,
  };
})(window);
