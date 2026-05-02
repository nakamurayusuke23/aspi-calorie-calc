/* alert.js — 「無茶なカロリー設定」検知ロジック (A1〜A8)
 * 出典: ニュートリションコーチ.pdf p.74〜p.78
 *
 * 各アラートは2層の文言を持つ:
 *   - text:   会員/見学者向け（柔らかい説明）
 *   - detail: トレーナー向け（具体的な数値・出典）
 * UIではtextを大きく、detailを控えめに添える。
 */
(function (global) {
  'use strict';

  const SOURCE = '出典: ニュートリションコーチ.pdf p.74〜p.78';

  function evaluate(ctx) {
    const { sex, weight, goal, bmr, tdee, target, pfc, bmi } = ctx;
    const alerts = [];

    // A1: 極端に低い目標カロリー
    if ((sex === 'F' && target < 1200) || (sex === 'M' && target < 1500)) {
      const limit = sex === 'F' ? 1200 : 1500;
      alerts.push({
        id: 'A1',
        level: 'danger',
        text: 'カロリーが必要量を大きく下回っています。微量栄養素が不足し、代謝の低下や筋肉減少につながりやすいペースです。',
        detail: `目標 ${Math.round(target)}kcal が下限（${sex === 'F' ? '女性' : '男性'} ${limit}kcal）を下回る`,
      });
    }

    // A2: 目標カロリー < BMR
    if (target < bmr) {
      alerts.push({
        id: 'A2',
        level: 'danger',
        text: '目標カロリーが基礎代謝を下回っています。続けると体が省エネモードになり、リバウンドやホルモンの乱れが起きやすくなります。',
        detail: `目標 ${Math.round(target)}kcal < 基礎代謝 ${Math.round(bmr)}kcal`,
      });
    }

    // A3: 目標カロリー > TDEE + 750
    if (target > tdee + 750) {
      alerts.push({
        id: 'A3',
        level: 'warn',
        text: '増量ペースが速めです。+500kcalを超えると筋肉より脂肪が増えやすくなります。',
        detail: `+${Math.round(target - tdee)}kcal（推奨上限 +500kcal）`,
      });
    }

    // A4: 減量赤字 > 体重×11kcal/日（≒週1%超減量ペース）
    if (goal === 'cut') {
      const deficit = tdee - target;
      const limit   = weight * 11;
      if (deficit > limit) {
        alerts.push({
          id: 'A4',
          level: 'warn',
          text: '減量ペースが速めです。週に体重1%以上を落とすと、脂肪より先に筋肉が落ちやすくなります。',
          detail: `1日赤字 ${Math.round(deficit)}kcal > 体重×11kcal（${Math.round(limit)}kcal）`,
        });
      }
    }

    // A5: タンパク質 < 体重×1.0g
    if (pfc.P.g < weight * 1.0) {
      alerts.push({
        id: 'A5',
        level: 'warn',
        text: 'タンパク質が少なめです。筋肉を守るには体重×1.5〜2.2gが推奨です。',
        detail: `P ${pfc.P.g.toFixed(1)}g < 体重×1.0g（${weight.toFixed(1)}g）`,
      });
    }

    // A6/A7: 脂質比率
    const fatRatio = pfc.F.kcal / target;
    if (fatRatio < 0.15) {
      alerts.push({
        id: 'A6',
        level: 'warn',
        text: '脂質が少なすぎます。ホルモンの材料が不足し、肌や生理にも影響します。総カロリーの20〜30%が目安です。',
        detail: `脂質 ${(fatRatio * 100).toFixed(1)}% < 15%`,
      });
    } else if (fatRatio > 0.35) {
      alerts.push({
        id: 'A7',
        level: 'warn',
        text: '脂質が多めです。糖質が不足するとエネルギー切れや集中力低下が起きやすくなります。',
        detail: `脂質 ${(fatRatio * 100).toFixed(1)}% > 35%`,
      });
    }

    // A8: BMI 極端域
    if (bmi < 16 || bmi > 35) {
      alerts.push({
        id: 'A8',
        level: 'warn',
        text: 'BMIが標準域を大きく外れています。一度医療機関や専門家へのご相談をおすすめします。',
        detail: `BMI ${bmi.toFixed(1)}（標準域 16〜35の外）`,
      });
    }

    return alerts;
  }

  function topLevel(alerts) {
    if (alerts.some(a => a.level === 'danger')) return 'danger';
    if (alerts.length > 0) return 'warn';
    return null;
  }

  global.AlertEngine = { evaluate, topLevel, SOURCE };
})(window);
