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

    // 저장된 개인 월 표시 설정. 저장한 적이 없으면 null 을 돌려준다.
    function readPersonalShowMonth() {
      try {
        var raw = root.localStorage.getItem(lobbySettingsKey);
        if (!raw) return null;
        var saved = JSON.parse(raw);
        if (saved && typeof saved.showMonth === 'boolean') return saved.showMonth;
      } catch (e) {}
      return null;
    }

    // 내 화면에 적용할 월 표시 (개인 설정 > 방 설정 > 기본 보이기)
    function effectiveShowMonth(state) {
      var personal = readPersonalShowMonth();
      if (personal !== null) return personal;
      if (state && state.settings && typeof state.settings.showMonth === 'boolean') {
        return state.settings.showMonth;
      }
      return true;
    }

    // 현재 화면에 그려진 카드에 월 표시를 즉시 반영한다.
    function applyShowMonthToCards(showMonth) {
      try {
        var allCards = (root.document && root.document.querySelectorAll)
          ? root.document.querySelectorAll('.card:not(.bonus-card)')
          : [];
        for (var i = 0; i < allCards.length; i++) {
          if (!showMonth) {
            if (allCards[i].className.indexOf('hide-month') === -1) {
              allCards[i].className += ' hide-month';
            }
            if (allCards[i].removeAttribute) allCards[i].removeAttribute('data-month-label');
          } else {
            allCards[i].className = allCards[i].className.replace(/\s*hide-month\b/g, '');
            var monthMatch = allCards[i].className.match(/\bm(\d{2})\b/);
            if (monthMatch && allCards[i].setAttribute) {
              allCards[i].setAttribute('data-month-label', Number(monthMatch[1]) + '월');
            }
          }
        }
      } catch (e) {}
    }

    function byId(id) {
      try {
        return (root.document && root.document.getElementById) ? root.document.getElementById(id) : null;
      } catch (e) {
        return null;
      }
    }

    function canEditSettings(state) {
      return !!(state && state.isHost && (state.phase === 'lobby' || state.phase === 'settle'));
    }

    function close() {
      if (el.settingsOverlay) el.settingsOverlay.className = 'overlay hidden';
    }

    function setPanel(mode) {
      settingsMode = mode;
      var isLobby = mode === 'lobby';
      var isPersonal = mode === 'personal';
      if (el.settingsTitle) {
        el.settingsTitle.innerHTML = isLobby ? '새 방 설정' : (isPersonal ? '내 화면 설정' : '게임 설정');
      }
      if (el.settingsSub) {
        if (isLobby) {
          el.settingsSub.innerHTML = '방을 만들 때 적용됩니다.<br>월 표시는 내 화면에도 적용됩니다.';
        } else if (isPersonal) {
          el.settingsSub.innerHTML = '카드 상단 월 표시는 내 화면에만 적용됩니다.';
        } else {
          el.settingsSub.innerHTML = '방장만 바꿀 수 있습니다.<br>판을 시작하기 전에만 변경됩니다.<br>월 표시는 내 화면에만 적용됩니다.';
        }
      }
      var roomOnly = byId('roomOnlySettings');
      if (roomOnly) roomOnly.className = isPersonal ? 'hidden' : '';
      var note = byId('settingsNote');
      if (note) note.className = isPersonal ? 'hidden' : 'set-note';
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

      // 방 규칙을 바꿀 수 없는 경우(게스트, 또는 판 진행 중)에는
      // 개인 화면 설정만 연다.
      if (!canEditSettings(state)) {
        setPanel('personal');
        if (el.showMonthSelect) {
          el.showMonthSelect.value = effectiveShowMonth(state) ? 'on' : 'off';
        }
        if (el.settingsOverlay) el.settingsOverlay.className = 'overlay';
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
        el.showMonthSelect.value = effectiveShowMonth(state) ? 'on' : 'off';
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
      // 월 표시는 개인 설정이므로 바꾸는 즉시 저장하고 현재 카드에 반영한다.
      var showMonth = el.showMonthSelect.value !== 'off';
      applyShowMonthToCards(showMonth);
      try {
        var current = getLobbySettings();
        saveLobbySettings(current.moneyPerPoint, current.timeKey, current.bonusPack, showMonth);
      } catch (e) {}
    });
    if (el.settingsSaveBtn) el.settingsSaveBtn.addEventListener('click', function () {
      var preset = timePresets[el.timeSelect.value] || timePresets.off;
      var money = Number(el.pointSelect.value);
      var bonusPack = el.bonusPackSelect ? Number(el.bonusPackSelect.value) : 50;
      var showMonth = el.showMonthSelect ? el.showMonthSelect.value !== 'off' : true;
      if (bonusPack !== 48 && bonusPack !== 50 && bonusPack !== 51) bonusPack = 50;
      close();
      applyShowMonthToCards(showMonth);

      if (settingsMode === 'personal') {
        var personal = getLobbySettings();
        saveLobbySettings(personal.moneyPerPoint, personal.timeKey, personal.bonusPack, showMonth);
        if (deps.fx) deps.fx.showBanner('내 화면 설정을 저장했습니다', 'plain', 1100);
        return;
      }

      if (settingsMode === 'lobby') {
        saveLobbySettings(money, el.timeSelect.value, bonusPack, showMonth);
        if (deps.fx) deps.fx.showBanner('새 방 설정을 저장했습니다', 'plain', 1100);
        return;
      }

      // 게임 설정(방장) — 월 표시는 개인 설정으로만 저장하고
      // 서버 방 설정에는 보내지 않는다. (방 기본값은 방 만들 때 정해진다)
      var lobbyCurrent = getLobbySettings();
      saveLobbySettings(lobbyCurrent.moneyPerPoint, lobbyCurrent.timeKey, lobbyCurrent.bonusPack, showMonth);
      deps.act('settings', {
        moneyPerPoint: money,
        timeLimit: { enabled: preset.enabled, base: preset.base, increment: preset.increment },
        bonusPack: bonusPack
      });
      if (deps.fx) deps.fx.showBanner('설정을 저장했습니다', 'plain', 1100);
    });

    return {
      close: close,
      getRoomDefaults: getRoomDefaults,
      renderAccess: function (state) {
        if (!el.settingsBtn) return;
        var canSet = state.isHost && (state.phase === 'lobby' || state.phase === 'settle');
        // 월 표시는 개인 설정이라 누구나, 언제든 바꿀 수 있다.
        el.settingsBtn.className = 'chip icon';
        el.settingsBtn.title = canSet
          ? '게임 설정 (점당·시간 제한 / 월 표시는 내 화면)'
          : '내 화면 설정 (카드 월 표시)';
      }
    };
  };
})(window);
