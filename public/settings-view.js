'use strict';

(function (root) {
  root.GostopSettingsView = function (deps) {
    var el = deps.el;
    var pointOptions = [10, 100, 500, 1000, 5000, 10000];
    var timePresets = {
      off: { enabled: false, base: 0, increment: 0 },
      '30': { enabled: true, base: 30, increment: 5 },
      '45': { enabled: true, base: 45, increment: 5 },
      '60': { enabled: true, base: 60, increment: 10 }
    };
    var lobbySettingsKey = 'gs_lobby_settings';
    var settingsMode = 'room';

    function getLobbySettings() {
      var settings = { moneyPerPoint: 100, timeKey: 'off', bonusPack: 50, showMonth: true };
      try {
        var raw = root.localStorage.getItem(lobbySettingsKey);
        if (!raw) return settings;
        var saved = JSON.parse(raw);
        var pointValue = Number(saved && saved.moneyPerPoint);
        for (var i = 0; i < pointOptions.length; i++) {
          if (pointOptions[i] === pointValue) {
            settings.moneyPerPoint = pointValue;
            break;
          }
        }
        if (saved && timePresets[saved.timeKey]) settings.timeKey = saved.timeKey;
        var bp = Number(saved && saved.bonusPack);
        if (bp === 48 || bp === 50 || bp === 51) settings.bonusPack = bp;
        if (saved && saved.hasOwnProperty('showMonth')) settings.showMonth = Boolean(saved.showMonth);
      } catch (e) {}
      return settings;
    }

    function getRoomDefaults() {
      var settings = getLobbySettings();
      var preset = timePresets[settings.timeKey] || timePresets.off;
      return {
        moneyPerPoint: settings.moneyPerPoint,
        timeLimit: {
          enabled: preset.enabled,
          base: preset.base,
          increment: preset.increment
        },
        bonusPack: settings.bonusPack,
        showMonth: settings.showMonth
      };
    }

    function saveLobbySettings(moneyPerPoint, timeKey, bonusPack, showMonth) {
      try {
        root.localStorage.setItem(lobbySettingsKey, JSON.stringify({
          moneyPerPoint: moneyPerPoint,
          timeKey: timeKey,
          bonusPack: bonusPack,
          showMonth: showMonth
        }));
      } catch (e) {}
    }

    function canEditSettings(state) {
      return !!(state && state.isHost && (state.phase === 'lobby' || state.phase === 'settle'));
    }

    function close() {
      if (el.settingsOverlay) el.settingsOverlay.className = 'overlay hidden';
    }

    function setPanel(mode) {
      settingsMode = mode;
      if (el.settingsTitle) {
        el.settingsTitle.innerHTML = mode === 'lobby' ? '새 방 설정' : '게임 설정';
      }
      if (el.settingsSub) {
        el.settingsSub.innerHTML = mode === 'lobby'
          ? '방을 만들 때 적용됩니다.<br>게임 중에는 바꿀 수 없습니다.'
          : '방장만 바꿀 수 있습니다.<br>판을 시작하기 전에만 변경됩니다.';
      }
    }

    function ensurePointOption(pointValue) {
      for (var i = 0; i < pointOptions.length; i++) {
        if (String(pointOptions[i]) === pointValue) return;
      }
      var option = root.document.createElement('option');
      option.value = pointValue;
      option.text = Number(pointValue).toLocaleString() + '원';
      el.pointSelect.appendChild(option);
    }

    function openRoomSettings() {
      var state = deps.getState();
      if (!state || !state.settings) return;
      if (!state.isHost) {
        if (deps.fx) deps.fx.showBanner('방장만 바꿀 수 있습니다', 'plain', 1200);
        return;
      }
      if (!canEditSettings(state)) {
        if (deps.fx) deps.fx.showBanner('판 시작 전에만 바꿀 수 있습니다', 'plain', 1500);
        return;
      }

      setPanel('room');
      var pointValue = String(state.settings.moneyPerPoint);
      ensurePointOption(pointValue);
      el.pointSelect.value = pointValue;

      var timeLimit = state.settings.timeLimit || {};
      var timeKey = !timeLimit.enabled ? 'off' : String(timeLimit.base);
      if (timeKey !== 'off' && timeKey !== '30' && timeKey !== '45' && timeKey !== '60') timeKey = 'off';
      el.timeSelect.value = timeKey;

      if (el.bonusPackSelect) {
        var bp = state.settings.bonusPack;
        if (bp !== 48 && bp !== 50 && bp !== 51) bp = 50;
        el.bonusPackSelect.value = String(bp);
      }

      if (el.showMonthSelect) {
        var currentMonthSetting = (state.settings && typeof state.settings.showMonth === 'boolean')
          ? state.settings.showMonth
          : getLobbySettings().showMonth;
        el.showMonthSelect.value = currentMonthSetting === false ? 'off' : 'on';
      }

      if (el.settingsOverlay) el.settingsOverlay.className = 'overlay';
    }

    function openLobbySettings() {
      setPanel('lobby');
      var settings = getLobbySettings();
      ensurePointOption(String(settings.moneyPerPoint));
      el.pointSelect.value = String(settings.moneyPerPoint);
      el.timeSelect.value = settings.timeKey;
      if (el.bonusPackSelect) el.bonusPackSelect.value = String(settings.bonusPack);
      if (el.showMonthSelect) el.showMonthSelect.value = settings.showMonth === false ? 'off' : 'on';
      if (el.settingsOverlay) el.settingsOverlay.className = 'overlay';
    }

    if (el.settingsBtn) el.settingsBtn.addEventListener('click', openRoomSettings);
    if (el.lobbySettingsBtn) el.lobbySettingsBtn.addEventListener('click', openLobbySettings);
    if (el.settingsCloseBtn) el.settingsCloseBtn.addEventListener('click', close);
    if (el.showMonthSelect) el.showMonthSelect.addEventListener('change', function () {
      var isHide = el.showMonthSelect.value === 'off';
      try {
        var allCards = (root.document && root.document.querySelectorAll) ? root.document.querySelectorAll('.card:not(.bonus-card)') : [];
        for (var i = 0; i < allCards.length; i++) {
          if (isHide) {
            if (allCards[i].className.indexOf('hide-month') === -1) allCards[i].className += ' hide-month';
            allCards[i].removeAttribute('data-month-label');
          } else {
            allCards[i].className = allCards[i].className.replace(/\s*hide-month\b/g, '');
            // data-month-label 복원: m01~m12 클래스에서 월 번호를 읽어온다
            var monthMatch = allCards[i].className.match(/\bm(\d{2})\b/);
            if (monthMatch) allCards[i].setAttribute('data-month-label', Number(monthMatch[1]) + '월');
          }
        }
      } catch (e1) {}
      try {
        var current = getLobbySettings();
        saveLobbySettings(current.moneyPerPoint, current.timeKey, current.bonusPack, !isHide);
      } catch (e2) {}
    });
    if (el.settingsSaveBtn) el.settingsSaveBtn.addEventListener('click', function () {
      var preset = timePresets[el.timeSelect.value] || timePresets.off;
      var money = Number(el.pointSelect.value);
      var bonusPack = el.bonusPackSelect ? Number(el.bonusPackSelect.value) : 50;
      var showMonth = el.showMonthSelect ? el.showMonthSelect.value !== 'off' : true;
      if (bonusPack !== 48 && bonusPack !== 50 && bonusPack !== 51) bonusPack = 50;
      close();
      try {
        var allCards = root.document.querySelectorAll ? root.document.querySelectorAll('.card:not(.bonus-card)') : [];
        for (var c = 0; c < allCards.length; c++) {
          if (!showMonth) {
            if (allCards[c].className.indexOf('hide-month') === -1) {
              allCards[c].className += ' hide-month';
              allCards[c].removeAttribute('data-month-label');
            }
          } else {
            allCards[c].className = allCards[c].className.replace(/\s*hide-month\b/g, '');
            var monthMatch2 = allCards[c].className.match(/\bm(\d{2})\b/);
            if (monthMatch2) allCards[c].setAttribute('data-month-label', Number(monthMatch2[1]) + '월');
          }
        }
      } catch (e) {}
      if (settingsMode === 'lobby') {
        saveLobbySettings(money, el.timeSelect.value, bonusPack, showMonth);
        if (deps.fx) deps.fx.showBanner('새 방 설정을 저장했습니다', 'plain', 1100);
        return;
      }
      var lobbyCurrent = getLobbySettings();
      saveLobbySettings(lobbyCurrent.moneyPerPoint, lobbyCurrent.timeKey, lobbyCurrent.bonusPack, showMonth);
      deps.act('settings', {
        moneyPerPoint: money,
        timeLimit: { enabled: preset.enabled, base: preset.base, increment: preset.increment },
        bonusPack: bonusPack,
        showMonth: showMonth
      });
      if (deps.fx) deps.fx.showBanner('설정을 저장했습니다', 'plain', 1100);
    });

    return {
      close: close,
      getRoomDefaults: getRoomDefaults,
      renderAccess: function (state) {
        if (!el.settingsBtn) return;
        var canSet = state.isHost && (state.phase === 'lobby' || state.phase === 'settle');
        el.settingsBtn.className = 'chip icon' + (state.isHost ? '' : ' hidden') + (canSet ? '' : ' off');
        el.settingsBtn.title = canSet ? '게임 설정 (점당·시간 제한)' : '판 시작 전에만 설정을 바꿀 수 있습니다';
      }
    };
  };
})(window);
