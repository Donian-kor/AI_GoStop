'use strict';

(function (root) {
  root.GostopRoomSession = function (deps) {
    var roomCode = null;
    var mySeat = -1;
    var lastFxSeq = 0;
    var lastVersion = -1;
    var pollTimer = null;
    var watchdogTimer = null;
    var pollPending = false;
    var lastUpdateAt = 0;
    var lastState = null;
    var freshJoin = true;
    var busy = false;

    function request(method, url, body, onOk, onErr) {
      var xhr = new root.XMLHttpRequest();
      try {
        xhr.open(method, url, true);
      } catch (e) {
        if (onErr) onErr();
        return;
      }
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.withCredentials = true;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          var data = null;
          try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
          if (onOk) onOk(data);
        } else if (onErr) {
          onErr(xhr);
        }
      };
      xhr.onerror = function () { if (onErr) onErr(xhr); };
      try {
        xhr.send(body ? JSON.stringify(body) : null);
      } catch (e) {
        if (onErr) onErr(xhr);
      }
    }

    function getJson(url, onOk, onErr) {
      request('GET', url, null, onOk, onErr);
    }

    function postJson(url, body, onOk, onErr) {
      request('POST', url, body, onOk, onErr);
    }

    function backToLobby(message) {
      try {
        root.sessionStorage.removeItem('gs_room');
        root.sessionStorage.removeItem('gs_name');
      } catch (e) {}
      roomCode = null;
      mySeat = -1;
      lastState = null;
      lastFxSeq = 0;
      lastVersion = -1;
      busy = false;
      if (pollTimer) { root.clearTimeout(pollTimer); pollTimer = null; }
      deps.onLeave(message);
    }

    function startPolling() {
      if (pollTimer) root.clearTimeout(pollTimer);
      var loop = function () {
        pollNow(function () {
          if (roomCode) pollTimer = root.setTimeout(loop, 50);
        });
      };
      loop();
      if (!watchdogTimer) {
        watchdogTimer = root.setInterval(watchdog, 2000);
      }
    }

    function enterRoom(code, seat) {
      deps.closeRoomBrowser();
      roomCode = code;
      mySeat = seat;
      lastFxSeq = 0;
      freshJoin = true;
      try {
        root.sessionStorage.setItem('gs_room', code);
        root.sessionStorage.setItem('gs_name', deps.el.nameInput.value.replace(/^\s+|\s+$/g, ''));
      } catch (e) {}
      deps.el.lobby.className = 'screen hidden';
      deps.el.room.className = 'screen';
      deps.el.codeChip.innerHTML = code;
      root.document.title = '명지네고스톱 ' + code;
      deps.onEnter();
      startPolling();
    }

    function createRoom(options, onError) {
      postJson('/api/room', options, function (res) {
        if (!res || !res.code) {
          onError((res && res.error) || '방을 만들지 못했습니다.');
          return;
        }
        enterRoom(res.code, res.seat);
      }, function () {
        onError('서버에 연결할 수 없습니다.');
      });
    }

    function restoreRoom() {
      var saved = null;
      try { saved = root.sessionStorage.getItem('gs_room'); } catch (e) { saved = null; }
      if (!saved) return;
      postJson('/api/room/' + saved + '/join', { name: deps.getSavedName() }, function (res) {
        if (res && res.code) {
          enterRoom(res.code, res.seat);
        } else {
          try { root.sessionStorage.removeItem('gs_room'); } catch (e) {}
        }
      }, function () {
        try { root.sessionStorage.removeItem('gs_room'); } catch (e) {}
      });
    }

    function pollNow(done) {
      if (!roomCode || pollPending) { if (done) done(); return; }
      pollPending = true;
      getJson('/api/room/' + roomCode + '/state?since=' + lastFxSeq + '&v=' + lastVersion,
        function (res) {
          pollPending = false;
          if (done) done();
          if (!res || !res.ok) return;
          lastUpdateAt = new Date().getTime();
          if (typeof res.version === 'number') lastVersion = res.version;
          var fx = res.fx || [];
          var moveFx = [];
          if (freshJoin) {
            for (var f = 0; f < fx.length; f++) {
              if (fx[f].seq > lastFxSeq) lastFxSeq = fx[f].seq;
            }
            freshJoin = false;
          } else {
            for (var i = 0; i < fx.length; i++) {
              if (fx[i].seq > lastFxSeq) lastFxSeq = fx[i].seq;
              moveFx.push(fx[i]);
              try {
                if (deps.fx) deps.fx.handleFx(fx[i], { seatEl: deps.seatEl, mySeat: mySeat });
              } catch (e) { /* 이펙트 오류가 게임을 멈추지 않게 */ }
            }
          }
          lastState = res.state;
          try {
            deps.render(res.state);
          } catch (e) {
            if (!root.console || !root.console.error) return;
            root.console.error('[render]', e);
          }
          try {
            deps.playOpponentMoves(moveFx);
          } catch (e) { /* 연출 오류가 게임을 멈추지 않게 */ }
        },
        function (xhr) {
          pollPending = false;
          if (done) done();
          if (xhr && xhr.status === 404) {
            backToLobby('방이 닫혔습니다. 방장이 방을 나갔을 수 있습니다.');
          }
        });
    }

    function watchdog() {
      if (!roomCode) return;
      if (new Date().getTime() - lastUpdateAt > 12000) {
        root.location.reload();
        return;
      }
    }

    function act(type, payload) {
      if (!roomCode || busy) return;
      busy = true;
      var body = {
        requestId: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
        type: type,
        payload: payload || {}
      };
      postJson('/api/room/' + roomCode + '/action', body, function (res) {
        busy = false;
        if (res && res.ok === false) deps.fx.showBanner(res.error || '처리할 수 없습니다.', 'red', 1400);
        pollNow(function () {});
      }, function (xhr) {
        busy = false;
        if (xhr && xhr.status === 404) {
          backToLobby('방이 닫혔습니다. 방장이 방을 나갔을 수 있습니다.');
          return;
        }
        deps.fx.showBanner('연결이 끊겼습니다', 'red', 1400);
      });
    }

    function leave() {
      var code = roomCode;
      if (code) {
        postJson('/api/room/' + code + '/action', { type: 'leave', payload: {} }, function () {}, function () {});
      }
      backToLobby('');
    }

    return {
      getJson: getJson,
      postJson: postJson,
      createRoom: createRoom,
      restoreRoom: restoreRoom,
      enterRoom: enterRoom,
      leave: leave,
      act: act,
      pollNow: pollNow,
      getRoomCode: function () { return roomCode; },
      getMySeat: function () { return mySeat; },
      getLastState: function () { return lastState; },
      isBusy: function () { return busy; }
    };
  };
})(window);
