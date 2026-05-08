// shell.js — サイドバーのタブ切替
(() => {
  const TABS = ['calorie', 'plan', 'value'];
  const DEFAULT_TAB = 'calorie';

  function getTabFromHash() {
    const h = (location.hash || '').replace('#', '');
    return TABS.includes(h) ? h : DEFAULT_TAB;
  }

  function activate(tab) {
    document.querySelectorAll('.sidebar__item').forEach(el => {
      el.classList.toggle('is-active', el.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach(el => {
      el.classList.toggle('is-active', el.id === `tab-${tab}`);
    });
    // チケットのチャートは表示時に再描画（hidden中はキャンバスサイズが0）
    if (tab === 'plan' && window.ticketApp) {
      requestAnimationFrame(() => window.ticketApp.runModeA());
    }
    if (tab === 'value' && window.ticketApp) {
      requestAnimationFrame(() => window.ticketApp.runModeB());
    }
  }

  function init() {
    activate(getTabFromHash());

    document.querySelectorAll('.sidebar__item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = el.dataset.tab;
        if (location.hash !== `#${tab}`) {
          history.replaceState(null, '', `#${tab}`);
        }
        activate(tab);
      });
    });

    window.addEventListener('hashchange', () => activate(getTabFromHash()));
  }

  window.appShell = {
    switchTab: (tab) => {
      if (!TABS.includes(tab)) return;
      history.replaceState(null, '', `#${tab}`);
      activate(tab);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
