'use strict';

(function (root) {
  root.GostopScorePanel = function (deps) {
    var el = deps.el;
    var showAllCaptured = false;
    try { showAllCaptured = root.localStorage.getItem('gs_fan') === '1'; } catch (e) { showAllCaptured = false; }
    var showJokbo = true;
    try { showJokbo = root.localStorage.getItem('gs_jokbo') !== '0'; } catch (e) { showJokbo = true; }

    function miniCardEl(id, owned) {
      var d = root.document.createElement('div');
      d.className = 'jk-card' + (owned ? '' : ' miss');
      var img = root.document.createElement('img');
      img.src = deps.cardImg({ id: id });
      img.alt = '';
      d.appendChild(img);
      return d;
    }

    function jokboTile(s) {
      var tile = root.document.createElement('div');
      tile.className = 'jk-set' + (s.done ? ' done' : '');

      var top = root.document.createElement('div');
      top.className = 'jk-top';
      var name = root.document.createElement('span');
      name.className = 'jk-name';
      name.innerHTML = deps.escapeHtml(s.name);
      var need = root.document.createElement('span');
      need.className = 'jk-need';
      need.innerHTML = (s.have > s.need ? s.need : s.have) + '/' + s.need + (s.done ? ' ✔' : '');
      top.appendChild(name);
      top.appendChild(need);
      tile.appendChild(top);

      var body = root.document.createElement('div');
      body.className = 'jk-body';
      if (s.cards && s.cards.length) {
        var strip = root.document.createElement('div');
        strip.className = 'jk-cards';
        for (var i = 0; i < s.cards.length; i++) {
          strip.appendChild(miniCardEl(s.cards[i].id, s.cards[i].owned));
        }
        body.appendChild(strip);
      } else {
        var bar = root.document.createElement('div');
        bar.className = 'jk-bar';
        var fill = root.document.createElement('i');
        var pct = s.need ? Math.round((s.have / s.need) * 100) : 0;
        fill.style.width = (pct > 100 ? 100 : pct) + '%';
        bar.appendChild(fill);
        body.appendChild(bar);
      }
      tile.appendChild(body);

      var foot = root.document.createElement('div');
      foot.className = 'jk-foot';
      foot.innerHTML = s.done ? '+' + s.points + '점' : (s.need - s.have) + '장 더';
      tile.appendChild(foot);
      return tile;
    }

    var jokboFallback = [
      ['광', 3, 'bright'], ['고도리', 3, 'godori'], ['홍단', 3, 'hongdan'],
      ['청단', 3, 'cheongdan'], ['초단', 3, 'chodan'], ['열꽃', 5, 'animal'],
      ['띠', 5, 'ribbon'], ['피', 10, 'junk']
    ];

    function scorePanelClass() {
      var className = 'score-panel';
      if (showAllCaptured) className += ' show-fan';
      if (!showJokbo) className += ' folded';
      return className;
    }

    function render(state) {
      var sets = state.mySets;
      el.scorePanel.className = scorePanelClass();
      el.scorePanel.innerHTML = '';
      if (!sets) return;

      var me = state.players[deps.mySeat()];
      var total = me ? me.score : 0;
      var captured = me && me.captured ? me.captured.total : 0;

      var head = root.document.createElement('div');
      head.className = 'jk-head';

      var title = root.document.createElement('span');
      title.className = 'jk-title';
      title.innerHTML = '📜 내 족보';
      head.appendChild(title);

      var live = root.document.createElement('span');
      live.className = 'jk-live';
      live.innerHTML = '실시간 달성율';
      head.appendChild(live);

      var score = root.document.createElement('span');
      score.className = 'jk-score';
      score.innerHTML = '먹은 패 ' + captured + '장 · <b>' + total + '</b>점';
      head.appendChild(score);

      var fold = root.document.createElement('button');
      fold.className = 'jk-fold';
      fold.innerHTML = showJokbo ? '족보 접기 ▲' : '족보 펼치기 ▼';
      fold.addEventListener('click', function () {
        showJokbo = !showJokbo;
        try { root.localStorage.setItem('gs_jokbo', showJokbo ? '1' : '0'); } catch (e) {}
        el.scorePanel.className = scorePanelClass();
        deps.fitTableCards();
        fold.innerHTML = showJokbo ? '족보 접기 ▲' : '족보 펼치기 ▼';
      });
      head.appendChild(fold);

      var toggle = root.document.createElement('button');
      toggle.className = 'jk-toggle';
      toggle.innerHTML = showAllCaptured ? '🎴 먹은 패 접기' : '🎴 먹은 패 보기';
      toggle.addEventListener('click', function () {
        showAllCaptured = !showAllCaptured;
        try { root.localStorage.setItem('gs_fan', showAllCaptured ? '1' : '0'); } catch (e) {}
        el.scorePanel.className = scorePanelClass();
        deps.fitTableCards();
        toggle.innerHTML = showAllCaptured ? '🎴 먹은 패 접기' : '🎴 먹은 패 보기';
      });
      head.appendChild(toggle);
      el.scorePanel.appendChild(head);

      var drawer = root.document.createElement('div');
      drawer.className = 'jk-drawer';

      var row = root.document.createElement('div');
      row.className = 'jk-row';

      var list = state.myJokbo;
      if (list && list.length) {
        for (var i = 0; i < list.length; i++) row.appendChild(jokboTile(list[i]));
      } else {
        for (var f = 0; f < jokboFallback.length; f++) {
          var fallback = jokboFallback[f];
          var have = sets[fallback[2]] || 0;
          row.appendChild(jokboTile({ name: fallback[0], need: fallback[1], have: have, done: have >= fallback[1], points: 0 }));
        }
      }
      drawer.appendChild(row);
      el.scorePanel.appendChild(drawer);

      var cards = state.myCaptured || [];
      var rack = root.document.createElement('div');
      rack.className = 'my-cards';
      var capturedTitle = root.document.createElement('span');
      capturedTitle.className = 'my-cards-title';
      capturedTitle.innerHTML = '내가 먹은 패';
      rack.appendChild(capturedTitle);

      var anyCards = false;
      for (var g = 0; g < deps.capGroups.length; g++) {
        var group = deps.capGroups[g];
        var groupCards = deps.cardsOfKinds(cards, group.kinds);
        if (!groupCards.length) continue;
        anyCards = true;

        var groupEl = root.document.createElement('div');
        groupEl.className = 'cap-group cap-' + group.key;
        var label = root.document.createElement('span');
        label.className = 'cap-label';
        label.innerHTML = group.label + ' <b>' + groupCards.length + '</b>';
        groupEl.appendChild(label);

        var fan = root.document.createElement('div');
        fan.className = 'card-fan';
        for (var c = 0; c < groupCards.length; c++) {
          var card = groupCards[c];
          var cardEl = deps.makeCardEl(card, 'tiny');
          var tags = card.tags || [];
          var setTag = null;
          for (var t = 0; t < tags.length; t++) {
            if (deps.setTags.join(' ').indexOf(tags[t]) >= 0) { setTag = tags[t]; break; }
          }
          if (setTag) {
            cardEl.className += ' in-set';
            cardEl.style.setProperty('--sc', deps.dotColor[deps.setColor[setTag]] || '#e8c46a');
          }
          fan.appendChild(cardEl);
        }
        groupEl.appendChild(fan);
        rack.appendChild(groupEl);
      }
      if (!anyCards) {
        var empty = root.document.createElement('span');
        empty.className = 'my-cards-empty';
        empty.innerHTML = '아직 먹은 패가 없습니다';
        rack.appendChild(empty);
      }
      el.scorePanel.appendChild(rack);
    }

    return { render: render };
  };
})(window);
