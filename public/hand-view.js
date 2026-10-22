'use strict';

(function (root) {
  root.GostopHandView = function (deps) {
    var el = deps.el;

    function render(state) {
      var myTurn = state.currentSeat === deps.mySeat() && !state.prompt;
      deps.fitHandCards(state.myHand.length);
      el.hand.innerHTML = '';

      var floorMonths = {};
      for (var i = 0; i < state.table.length; i++) floorMonths[state.table[i].month] = true;
      for (var k = 0; k < state.myHand.length; k++) {
        (function (index) {
          var cardData = state.myHand[index];
          var canMatch = myTurn && floorMonths[cardData.month];
          var card = deps.makeCardEl(cardData, (myTurn ? 'pick ' : '') + (canMatch ? 'match' : ''));
          card.setAttribute('data-card-id', cardData.id);
          if (myTurn) {
            if (canMatch) {
              var badge = root.document.createElement('span');
              badge.className = 'can-play';
              badge.innerHTML = '낼수있음';
              card.appendChild(badge);
            }
            card.addEventListener('click', function () { deps.playCard(card, index); });
          }
          el.hand.appendChild(card);
        })(k);
      }
      el.hand.className = 'hand' + (!myTurn && state.phase === 'play' ? ' waiting' : '');
    }

    return { render: render };
  };
})(window);
