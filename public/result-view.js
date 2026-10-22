'use strict';

(function (root) {
  root.GostopResultView = function (deps) {
    var el = deps.el;

    function render(state) {
      var result = state.result;
      el.overlay.className = 'overlay';
      el.overlay.innerHTML = '';

      try {
        if (root.GostopFx && root.GostopFx.playSound) {
          var myRow = null;
          for (var i = 0; i < result.rows.length; i++) {
            if (result.rows[i].seat === deps.mySeat()) { myRow = result.rows[i]; break; }
          }
          if (myRow) {
            if (myRow.amount > 0) root.GostopFx.playSound('sfx_money_gain.ogg');
            else if (myRow.amount < 0) root.GostopFx.playSound('sfx_money_lose.ogg');
          }
          var anyBak = false;
          for (var j = 0; j < result.rows.length; j++) {
            if (result.rows[j].pibak || result.rows[j].gwangbak || result.rows[j].meongbak || result.rows[j].gobak) { anyBak = true; break; }
          }
          if (anyBak) root.GostopFx.playSound('sfx_bak.ogg');
        }
      } catch (e) {}

      var box = root.document.createElement('div');
      box.className = 'overlay-inner';

      var heading = root.document.createElement('h2');
      var winner = state.players[result.winnerSeat] ? state.players[result.winnerSeat].name : '승자';
      heading.innerHTML = result.nagari ? '나가리' : deps.escapeHtml(winner) + ' 승리!';
      box.appendChild(heading);

      var subtitle = root.document.createElement('p');
      subtitle.className = 'overlay-sub';
      subtitle.innerHTML = result.nagari ? '이번 판은 승패가 없습니다. 다음 판은 2배입니다.' : '정산 결과';
      box.appendChild(subtitle);

      var rows = root.document.createElement('div');
      rows.className = 'rows';
      for (var rowIndex = 0; rowIndex < result.rows.length; rowIndex++) {
        var row = result.rows[rowIndex];
        var line = root.document.createElement('div');
        line.className = 'rowline' + (row.seat === result.winnerSeat ? ' win' : '');
        var name = root.document.createElement('span');
        name.innerHTML = deps.escapeHtml(row.name);
        var amount = root.document.createElement('b');
        amount.innerHTML = (row.amount > 0 ? '+' : '') + deps.formatMoney(row.amount);
        line.appendChild(name);
        line.appendChild(amount);
        if (row.reasons && row.reasons.length) {
          var reasons = root.document.createElement('small');
          reasons.innerHTML = row.reasons.join(' · ');
          line.appendChild(reasons);
        }
        rows.appendChild(line);
      }
      box.appendChild(rows);

      var steps = null;
      for (var rowIndex = 0; rowIndex < result.rows.length; rowIndex++) {
        if (result.rows[rowIndex].steps && result.rows[rowIndex].steps.length) { steps = result.rows[rowIndex]; break; }
      }
      if (steps) {
        var wrap = root.document.createElement('div');
        wrap.className = 'steps';
        var title = root.document.createElement('h3');
        title.innerHTML = '점수 계산';
        wrap.appendChild(title);
        for (var stepIndex = 0; stepIndex < steps.steps.length; stepIndex++) {
          var step = root.document.createElement('div');
          step.className = 'step';
          step.innerHTML = '<span>' + steps.steps[stepIndex].label + '</span><b>' + steps.steps[stepIndex].formula + ' = ' + steps.steps[stepIndex].value + '</b>';
          wrap.appendChild(step);
        }
        var total = root.document.createElement('div');
        total.className = 'step total';
        var finalStep = steps.steps[steps.steps.length - 1];
        total.innerHTML = '<span>최종 점수</span><b>' + finalStep.value + '점</b>';
        wrap.appendChild(total);
        box.appendChild(wrap);
      }

      var close = root.document.createElement('button');
      close.className = 'primary';
      close.innerHTML = '닫기';
      close.addEventListener('click', function () { el.overlay.className = 'overlay hidden'; });
      box.appendChild(close);

      el.overlay.appendChild(box);
    }

    return { render: render };
  };
})(window);
