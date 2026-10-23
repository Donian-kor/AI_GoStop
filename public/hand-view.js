'use strict';

(function (root) {
  root.GostopHandView = function (deps) {
    var el = deps.el;

    function render(state) {
      var myTurn = state.currentSeat === deps.mySeat() && !state.prompt;
      deps.fitHandCards(state.myHand.length);

      // 이미 그려진 카드는 지우지 않고 재사용한다.
      // 새로 만들면 <img>가 다시 디코딩되면서 카드가 한순간 비어 보인다(깜빡임).
      var existing = {};
      var old = el.hand.querySelectorAll('[data-card-id]');
      for (var o = 0; o < old.length; o++) {
        existing[old[o].getAttribute('data-card-id')] = old[o];
      }
      el.hand.innerHTML = '';

      var floorMonths = {};
      for (var i = 0; i < state.table.length; i++) floorMonths[state.table[i].month] = true;
      for (var k = 0; k < state.myHand.length; k++) {
        (function (index) {
          var cardData = state.myHand[index];
          var canMatch = myTurn && floorMonths[cardData.month];
          var cls = (myTurn ? 'pick ' : '') + (canMatch ? 'match' : '');
          var showMonth = state.settings && typeof state.settings.showMonth === 'boolean' ? state.settings.showMonth : undefined;
          var card = existing[cardData.id];
          if (card) {
            // 재사용 시 남아 있는 '낼수있음' 배지는 지운다
            var badges = card.getElementsByClassName('can-play');
            while (badges.length) badges[0].parentNode.removeChild(badges[0]);
            deps.updateCardEl(card, cardData, cls, showMonth);
          } else {
            card = deps.makeCardEl(cardData, cls, showMonth);
          }
          card.setAttribute('data-card-id', cardData.id);
          card.onclick = null;
          if (myTurn) {
            if (canMatch) {
              var badge = root.document.createElement('span');
              badge.className = 'can-play';
              badge.innerHTML = '낼수있음';
              card.appendChild(badge);
            }
            card.onclick = function () { deps.playCard(card, index); };
          }
          el.hand.appendChild(card);
        })(k);
      }
      el.hand.className = 'hand' + (!myTurn && state.phase === 'play' ? ' waiting' : '');
    }

    return { render: render };
  };
})(window);
