'use strict';

(function (root) {
  root.GostopPhaseViews = function (deps) {
    var el = deps.el;

    function renderNegotiation(state) {
      var negotiation = state.negotiation || {};
      var waiting = negotiation.waitingSeat;
      el.promptBox.className = 'prompt';
      el.promptBox.innerHTML = '';

      var decisions = negotiation.decisions || {};
      var info = [];
      for (var key in decisions) {
        if (!Object.prototype.hasOwnProperty.call(decisions, key)) continue;
        var player = state.players[key];
        var decision = decisions[key];
        info.push((player ? deps.escapeHtml(player.name) : '') + ': ' +
          (decision === 'giveup' ? '포기' : decision === 'sell' ? '광팔기' : '참가'));
      }
      if (info.length) {
        var status = root.document.createElement('span');
        status.innerHTML = info.join(' · ');
        el.promptBox.appendChild(status);
      }

      if (waiting !== deps.mySeat()) {
        var waitMessage = root.document.createElement('span');
        var waitingPlayer = state.players[waiting];
        waitMessage.innerHTML = waiting < 0 ? '협상이 끝났습니다.' :
          (waitingPlayer ? deps.escapeHtml(waitingPlayer.name) : '') + ' 님이 결정하는 중…';
        el.promptBox.appendChild(waitMessage);
        return;
      }

      var title = root.document.createElement('strong');
      title.innerHTML = '참가하시겠습니까?';
      el.promptBox.appendChild(title);

      var join = root.document.createElement('button');
      join.className = 'primary';
      join.innerHTML = '참가';
      join.addEventListener('click', function () { deps.act('negotiate', { decision: 'join' }); });
      el.promptBox.appendChild(join);

      if (deps.mySeat() === 3) {
        var sell = root.document.createElement('button');
        sell.innerHTML = '광을 판다 (' + (negotiation.gwangCount || 0) + '광)';
        sell.addEventListener('click', function () { deps.act('negotiate', { decision: 'sell' }); });
        el.promptBox.appendChild(sell);
        if (negotiation.mySaleCards && negotiation.mySaleCards.length) {
          var label = root.document.createElement('span');
          label.innerHTML = '팔 패:';
          el.promptBox.appendChild(label);
          for (var i = 0; i < negotiation.mySaleCards.length; i++) {
            el.promptBox.appendChild(deps.makeCardEl(negotiation.mySaleCards[i], 'small', state.settings && typeof state.settings.showMonth === 'boolean' ? state.settings.showMonth : undefined));
          }
        }
      } else {
        var giveUp = root.document.createElement('button');
        giveUp.innerHTML = '포기';
        giveUp.addEventListener('click', function () { deps.act('negotiate', { decision: 'giveup' }); });
        el.promptBox.appendChild(giveUp);
      }
    }

    function renderSeon(state) {
      var candidates = state.seonCandidates[deps.mySeat()] || [];
      if (!candidates.length) {
        el.tableHint.innerHTML = '선(先)을 정하는 중입니다.';
        el.promptBox.className = 'prompt';
        el.promptBox.innerHTML = '<span>이 방은 이미 선을 정하는 중입니다. 다음 판에 참여해 주세요.</span>';
        return;
      }
      if (state.seonPicked[deps.mySeat()] !== -1) {
        el.tableHint.innerHTML = '카드를 골랐습니다. 다른 가족을 기다리는 중…';
        el.promptBox.className = 'prompt';
        el.promptBox.innerHTML = '<span>다른 가족들이 카드를 고르는 중입니다…</span>';
        return;
      }
      el.tableHint.innerHTML = '가장 크게(낮) 또는 가장 작게(밤) 나는 카드를 고르세요.';
      el.promptBox.className = 'prompt';
      el.promptBox.innerHTML = '';
      var label = root.document.createElement('strong');
      label.innerHTML = '선 결정 카드:';
      el.promptBox.appendChild(label);
      for (var i = 0; i < candidates.length; i++) {
        (function (index) {
          var card = deps.makeCardEl(candidates[index], 'pick small', state.settings && typeof state.settings.showMonth === 'boolean' ? state.settings.showMonth : undefined);
          card.setAttribute('data-card-id', candidates[index].id);
          card.addEventListener('click', function () { deps.act('seonPick', { cardIndex: index }); });
          el.promptBox.appendChild(card);
        })(i);
      }
    }

    function renderPrompt(state) {
      var prompt = state.prompt;
      if (!prompt) {
        el.promptBox.className = 'prompt hidden';
        return;
      }
      el.promptBox.className = 'prompt';
      el.promptBox.innerHTML = '';

      if (prompt.seat !== deps.mySeat()) {
        var name = state.players[prompt.seat] ? state.players[prompt.seat].name : '상대';
        el.promptBox.innerHTML = '<span>' + deps.escapeHtml(name) + ' 님이 선택하는 중입니다…</span>';
        return;
      }

      if (prompt.type === 'goStop') {
        el.promptBox.innerHTML = '<strong>고 / 스톱</strong><em class="prompt-sub">점수를 더 노릴까요, 지금 이길까요?</em>';
        var go = root.document.createElement('button');
        go.className = 'btn-go';
        go.innerHTML = '🔥 고! (계속)';
        go.addEventListener('click', function () { deps.act('go'); });
        var stop = root.document.createElement('button');
        stop.className = 'btn-stop';
        stop.innerHTML = '✋ 스톱! (승리)';
        stop.addEventListener('click', function () { deps.act('stop'); });
        el.promptBox.appendChild(go);
        el.promptBox.appendChild(stop);
        return;
      }

      if (prompt.type === 'floorChoice' || prompt.type === 'flipChoice') {
        el.promptBox.innerHTML = '<strong>가져갈 카드를 고르세요</strong>';
        var options = prompt.options || [];
        for (var i = 0; i < options.length; i++) {
          (function (index) {
            var card = deps.makeCardEl(options[index], 'pick small', state.settings && typeof state.settings.showMonth === 'boolean' ? state.settings.showMonth : undefined);
            card.setAttribute('data-card-id', options[index].id);
            card.addEventListener('click', function () {
              if (prompt.type === 'floorChoice') deps.act('floorChoice', { choice: index });
              else deps.act('flipChoice', { ordinal: index });
            });
            el.promptBox.appendChild(card);
          })(i);
        }
        return;
      }

      if (prompt.type === 'bonusDraw') {
        el.promptBox.innerHTML = '<strong>보너스패를 냈습니다 — 보충할 카드를 고르세요</strong>';
        var bonusOptions = prompt.options || [];
        for (var j = 0; j < bonusOptions.length; j++) {
          (function (option) {
            var card = deps.makeCardEl(option, 'pick small', state.settings && typeof state.settings.showMonth === 'boolean' ? state.settings.showMonth : undefined);
            card.addEventListener('click', function () { deps.act('bonusDraw', { stockIndex: option.stockIndex }); });
            el.promptBox.appendChild(card);
          })(bonusOptions[j]);
        }
      }
    }

    return {
      renderNegotiation: renderNegotiation,
      renderSeon: renderSeon,
      renderPrompt: renderPrompt
    };
  };
})(window);
