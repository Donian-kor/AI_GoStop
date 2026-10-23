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
      var settings = { moneyPerPoint: 100, timeKey: 'off' };
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
        }
      };
    }

    function saveLobbySettings(moneyPerPoint, timeKey) {
      try {
        root.localStorage.setItem(lobbySettingsKey, JSON.stringify({
          moneyPerPoint: moneyPerPoint,
          timeKey: timeKey
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

      if (el.settingsOverlay) el.settingsOverlay.className = 'overlay';
    }

    function openLobbySettings() {
      setPanel('lobby');
      var settings = getLobbySettings();
      ensurePointOption(String(settings.moneyPerPoint));
      el.pointSelect.value = String(settings.moneyPerPoint);
      el.timeSelect.value = settings.timeKey;
      if (el.settingsOverlay) el.settingsOverlay.className = 'overlay';
    }

    if (el.settingsBtn) el.settingsBtn.addEventListener('click', openRoomSettings);
    if (el.lobbySettingsBtn) el.lobbySettingsBtn.addEventListener('click', openLobbySettings);
    if (el.settingsCloseBtn) el.settingsCloseBtn.addEventListener('click', close);
    if (el.settingsSaveBtn) el.settingsSaveBtn.addEventListener('click', function () {
      var preset = timePresets[el.timeSelect.value] || timePresets.off;
      var money = Number(el.pointSelect.value);
      close();
      if (settingsMode === 'lobby') {
        saveLobbySettings(money, el.timeSelect.value);
        if (deps.fx) deps.fx.showBanner('새 방 설정을 저장했습니다', 'plain', 1100);
        return;
      }
      deps.act('settings', {
        moneyPerPoint: money,
        timeLimit: { enabled: preset.enabled, base: preset.base, increment: preset.increment }
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
