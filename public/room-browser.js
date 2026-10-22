'use strict';

(function (root) {
  root.GostopRoomBrowser = function (deps) {
    var el = deps.el;
    var getJson = deps.getJson;
    var postJson = deps.postJson;
    var currentName = deps.currentName;
    var enterRoom = deps.enterRoom;
    var roomListState = {
      rooms: [],
      selectedCode: null,
      lastTapCode: '',
      lastTapAt: 0,
      suppressClickUntil: 0
    };

    function roomListFind(code) {
      for (var i = 0; i < roomListState.rooms.length; i++) {
        if (roomListState.rooms[i].code === code) return roomListState.rooms[i];
      }
      return null;
    }

    function roomListMeta(room) {
      if (room.mode === 'solo') return room.playerCount + '인 · AI 대결';
      var text = room.playerCount + '인 · ' + room.humanCount + '명 참가';
      if (room.openSeats > 0) text += ' · ' + room.openSeats + '자리 남음';
      return text;
    }

    function roomListStatus(room) {
      if (room.isMember) return room.phase === 'play' ? '이어하기' : '다시 참가';
      if (room.canJoin) return '참가 가능';
      if (room.mode === 'solo') return 'AI 대결';
      if (room.phase === 'play') return '대국 중';
      if (room.phase === 'seon') return '선 결정 중';
      if (room.phase === 'negotiate') return '협상 중';
      if (room.phase === 'settle') return '정산 중';
      return '자리 없음';
    }

    function roomListBlocked(room) {
      if (room.mode === 'solo') return 'AI와 혼자 치는 방이라 참가할 수 없습니다.';
      if (room.phase === 'play') return '지금 대국 중인 방입니다.';
      if (room.phase === 'seon') return '지금 선을 정하는 중인 방입니다.';
      if (room.phase === 'negotiate') return '지금 광팔기 협상을 하는 방입니다.';
      if (room.phase === 'settle') return '지금 정산 중인 방입니다.';
      if (room.openSeats <= 0) return '방이 가득 찼습니다.';
      return '지금은 참가할 수 없습니다.';
    }

    function updateRoomListJoinButton() {
      if (!el.roomListJoinBtn) return;
      var room = roomListFind(roomListState.selectedCode);
      if (!room || !room.canJoin) {
        el.roomListJoinBtn.disabled = true;
        el.roomListJoinBtn.textContent = '선택한 방 참가';
        return;
      }
      el.roomListJoinBtn.disabled = false;
      el.roomListJoinBtn.textContent = room.isMember ? '이 방으로 다시 들어가기' : '선택한 방 참가';
    }

    function selectRoom(code) {
      roomListState.selectedCode = code;
      if (!el.roomList) return;
      var items = el.roomList.getElementsByTagName('button');
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var base = item.getAttribute('data-canjoin') === '1' ? 'room-item' : 'room-item is-disabled';
        item.className = base + (item.getAttribute('data-code') === code ? ' selected' : '');
      }
      updateRoomListJoinButton();
    }

    function closeRoomList() {
      if (el.roomListOverlay) el.roomListOverlay.className = 'overlay hidden';
    }

    function setJoinBoxVisible(visible) {
      el.joinBox.className = visible ? 'w-full mt-3 px-1' : 'hidden w-full mt-3 px-1';
    }

    function joinRoomByCode(code, fromList) {
      var name = currentName();
      if (!fromList) el.lobbyError.textContent = '';
      if (fromList) {
        if (el.roomListError) el.roomListError.textContent = '';
        if (el.roomListJoinBtn) el.roomListJoinBtn.disabled = true;
      }
      postJson('/api/room/' + code + '/join', { name: name }, function (res) {
        if (!res || !res.code) {
          var msg = (res && res.error) || '방에 참가할 수 없습니다.';
          if (fromList) {
            if (el.roomListError) el.roomListError.textContent = msg;
            updateRoomListJoinButton();
          } else {
            el.lobbyError.textContent = msg;
          }
          return;
        }
        closeRoomList();
        setJoinBoxVisible(false);
        enterRoom(res.code, res.seat);
      }, function (xhr) {
        var msg = '서버에 연결할 수 없습니다.';
        try {
          var data = JSON.parse(xhr.responseText);
          if (data && data.error) msg = data.error;
        } catch (e) {}
        if (fromList) {
          if (el.roomListError) el.roomListError.textContent = msg;
          updateRoomListJoinButton();
        } else {
          el.lobbyError.textContent = msg;
        }
      });
    }

    function handleRoomTap(room) {
      var now = Date.now();
      if (!room.canJoin) {
        if (el.roomListError) el.roomListError.textContent = roomListBlocked(room);
        selectRoom(room.code);
        roomListState.lastTapCode = '';
        roomListState.lastTapAt = 0;
        return false;
      }
      if (el.roomListError) el.roomListError.textContent = '';
      if (roomListState.lastTapCode === room.code && now - roomListState.lastTapAt < 500) {
        roomListState.lastTapCode = '';
        roomListState.lastTapAt = 0;
        joinRoomByCode(room.code, true);
        return true;
      }
      roomListState.lastTapCode = room.code;
      roomListState.lastTapAt = now;
      selectRoom(room.code);
      return false;
    }

    function bindRoomItem(btn, room) {
      var touchStart = null;

      btn.addEventListener('touchstart', function (ev) {
        var t = ev.touches && ev.touches[0];
        touchStart = t ? { x: t.clientX, y: t.clientY } : null;
      });

      btn.addEventListener('touchend', function (ev) {
        var t = ev.changedTouches && ev.changedTouches[0];
        if (touchStart && t) {
          var dx = Math.abs(t.clientX - touchStart.x);
          var dy = Math.abs(t.clientY - touchStart.y);
          if (dx > 12 || dy > 12) {
            touchStart = null;
            roomListState.suppressClickUntil = Date.now() + 700;
            return;
          }
        }
        touchStart = null;
        roomListState.suppressClickUntil = Date.now() + 700;
        var joined = handleRoomTap(room);
        if (joined && ev.preventDefault) ev.preventDefault();
      });

      btn.addEventListener('click', function () {
        if (Date.now() < roomListState.suppressClickUntil) return;
        handleRoomTap(room);
      });
    }

    function renderRoomList() {
      if (!el.roomList) return;
      el.roomList.innerHTML = '';
      var rooms = roomListState.rooms;
      if (!rooms.length) {
        el.roomList.innerHTML = '<p class="room-list-empty">아직 만들어진 방이 없습니다.<br>방 만들기로 새 방을 만들어 주세요.</p>';
        updateRoomListJoinButton();
        return;
      }
      var onlyJoinable = null;
      var joinableCount = 0;
      for (var i = 0; i < rooms.length; i++) {
        (function (room) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'room-item' + (room.canJoin ? '' : ' is-disabled');
          btn.setAttribute('data-code', room.code);
          btn.setAttribute('data-canjoin', room.canJoin ? '1' : '0');
          if (!room.canJoin) btn.setAttribute('aria-disabled', 'true');

          var main = document.createElement('span');
          main.className = 'room-item-main';
          var title = document.createElement('span');
          title.className = 'room-item-title';
          title.textContent = (room.hostName || '방장') + '의 방';
          var meta = document.createElement('span');
          meta.className = 'room-item-meta';
          meta.textContent = room.code + ' · ' + roomListMeta(room);
          main.appendChild(title);
          main.appendChild(meta);

          var status = document.createElement('span');
          status.className = 'room-item-status' + (room.canJoin ? '' : ' off');
          status.textContent = roomListStatus(room);

          btn.appendChild(main);
          btn.appendChild(status);
          bindRoomItem(btn, room);
          el.roomList.appendChild(btn);

          if (room.canJoin) {
            joinableCount++;
            onlyJoinable = room.code;
          }
        })(rooms[i]);
      }
      if (joinableCount === 1) selectRoom(onlyJoinable);
      else updateRoomListJoinButton();
    }

    function loadRoomList() {
      if (!el.roomList) return;
      roomListState.selectedCode = null;
      roomListState.lastTapCode = '';
      roomListState.lastTapAt = 0;
      el.roomList.innerHTML = '<p class="room-list-empty">방 목록을 불러오는 중입니다.</p>';
      if (el.roomListError) el.roomListError.textContent = '';
      updateRoomListJoinButton();
      getJson('/api/rooms', function (res) {
        if (!res || !res.rooms) {
          el.roomList.innerHTML = '';
          if (el.roomListError) el.roomListError.textContent = (res && res.error) || '방 목록을 불러오지 못했습니다.';
          return;
        }
        roomListState.rooms = res.rooms;
        renderRoomList();
      }, function () {
        el.roomList.innerHTML = '';
        if (el.roomListError) el.roomListError.textContent = '서버에 연결할 수 없습니다.';
      });
    }

    function openRoomList() {
      if (!el.roomListOverlay) return;
      el.lobbyError.textContent = '';
      setJoinBoxVisible(false);
      el.roomListOverlay.className = 'overlay';
      loadRoomList();
    }

    el.joinBtn.addEventListener('click', openRoomList);

    el.joinGoBtn.addEventListener('click', function () {
      var code = el.codeInput.value.replace(/^\s+|\s+$/g, '').toUpperCase();
      if (code.length !== 6) { el.lobbyError.textContent = '방 코드는 6자리입니다.'; return; }
      joinRoomByCode(code, false);
    });

    if (el.roomListCloseBtn) el.roomListCloseBtn.addEventListener('click', closeRoomList);
    if (el.roomListRefreshBtn) el.roomListRefreshBtn.addEventListener('click', loadRoomList);
    if (el.roomListJoinBtn) el.roomListJoinBtn.addEventListener('click', function () {
      var room = roomListFind(roomListState.selectedCode);
      if (room && room.canJoin) joinRoomByCode(room.code, true);
    });
    if (el.roomListCodeBtn) el.roomListCodeBtn.addEventListener('click', function () {
      closeRoomList();
      el.lobbyError.textContent = '';
      setJoinBoxVisible(true);
      el.codeInput.focus();
    });
    if (el.roomListOverlay) el.roomListOverlay.addEventListener('click', function (ev) {
      if (ev.target === el.roomListOverlay) closeRoomList();
    });

    return { close: closeRoomList };
  };
})(window);
