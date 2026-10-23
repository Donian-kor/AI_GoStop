'use strict';

(function (root) {
  root.GostopOpponentView = function (deps) {
    var el = deps.el;

    function capturedSummary(sum) {
      var wrap = root.document.createElement('div');
      wrap.className = 'captured-sum';
      if (!sum) return wrap;
      var items = [
        ['guang', '광', sum.bright],
        ['', '열', sum.animal],
        ['ribbon', '띠', sum.ribbon],
        ['junk', '피', sum.junk + sum.doubleJunk + (sum.bonusValue || sum.bonus)]
      ];
      for (var i = 0; i < items.length; i++) {
        var cls = items[i][0];
        var n = items[i][2];
        var tag = root.document.createElement('i');
        tag.className = (cls ? cls + ' ' : '') + (n > 0 ? 'on' : '');
        tag.innerHTML = '<span>' + items[i][1] + '</span><b>' + n + '</b>';
        wrap.appendChild(tag);
      }
      return wrap;
    }

    function oppCaptured(cards) {
      var wrap = root.document.createElement('div');
      wrap.className = 'opp-caps';
      for (var g = 0; g < deps.capGroups.length; g++) {
        var group = deps.capGroups[g];
        var list = deps.cardsOfKinds(cards, group.kinds);
        var cell = root.document.createElement('div');
        cell.className = 'opp-cap opp-cap-' + group.key;

        var label = root.document.createElement('span');
        label.className = 'opp-cap-label';
        label.innerHTML = group.label + ' <b>' + list.length + '</b>';
        cell.appendChild(label);

        var strip = root.document.createElement('div');
        strip.className = 'opp-cap-cards';
        if (!list.length) {
          var none = root.document.createElement('span');
          none.className = 'opp-cap-none';
          none.innerHTML = '—';
          strip.appendChild(none);
        } else {
          for (var i = 0; i < list.length; i++) {
            var card = deps.makeCardEl(list[i], 'micro');
            var tags = list[i].tags || [];
            var setTag = null;
            for (var t = 0; t < tags.length; t++) {
              if (deps.setTags.join(' ').indexOf(tags[t]) >= 0) {
                setTag = tags[t];
                break;
              }
            }
            if (setTag) {
              card.className += ' in-set';
              card.style.setProperty('--sc', deps.dotColor[deps.setColor[setTag]] || '#e8c46a');
            }
            strip.appendChild(card);
          }
        }
        cell.appendChild(strip);
        wrap.appendChild(cell);
      }
      return wrap;
    }

    function render(state) {
      el.players.innerHTML = '';
      for (var i = 0; i < state.players.length; i++) {
        var player = state.players[i];
        if (player.seat === deps.mySeat() || !player.connected) continue;
        var div = root.document.createElement('div');
        var className = 'player';
        if (player.seat === state.currentSeat) className += ' active';
        if (player.type === 'ai') className += ' ai';
        div.className = className;
        div.setAttribute('data-seat', String(player.seat));

        var pill = root.document.createElement('div');
        pill.className = 'opp-pill';

        var name = root.document.createElement('span');
        name.className = 'pname';
        var isAi = player.type === 'ai';
        var displayName = player.name;
        if (isAi) {
          var aiBadge = root.document.createElement('span');
          aiBadge.className = 'ai-badge';
          aiBadge.setAttribute('aria-label', 'AI 상대');
          aiBadge.appendChild(root.document.createTextNode('AI'));
          name.appendChild(aiBadge);
        }
        var nameText = root.document.createElement('span');
        nameText.className = 'pname-text';
        nameText.appendChild(root.document.createTextNode(displayName));
        name.appendChild(nameText);
        pill.appendChild(name);

        var meta = root.document.createElement('span');
        meta.className = 'pmeta';
        meta.innerHTML = '점수 <b>' + player.score + '</b> · ' + player.handCount + '장';
        pill.appendChild(meta);

        var money = root.document.createElement('span');
        money.className = 'pmoney';
        money.innerHTML = deps.formatMoney(player.money);
        pill.appendChild(money);

        if (player.goCount > 0) {
          var go = root.document.createElement('span');
          go.className = 'pready go';
          go.innerHTML = '🔥 ' + player.goCount + '고!';
          pill.appendChild(go);
        }
        div.appendChild(pill);

        var box = root.document.createElement('div');
        box.className = 'opp-box';
        if (deps.oppView() === 'image' && player.capturedCards && player.capturedCards.length) {
          box.appendChild(oppCaptured(player.capturedCards));
        } else if (deps.oppView() === 'image') {
          var empty = root.document.createElement('div');
          empty.className = 'opp-caps-empty';
          empty.innerHTML = '먹은 패 없음';
          box.appendChild(empty);
        } else {
          box.appendChild(capturedSummary(player.captured));
        }
        div.appendChild(box);

        el.players.appendChild(div);
      }
    }

    return { render: render, capturedSummary: capturedSummary };
  };
})(window);
