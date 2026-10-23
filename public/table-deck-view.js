'use strict';

(function (root) {
  root.GostopTableDeckView = function (deps) {
    var el = deps.el;

    function render(state) {
      el.table.innerHTML = '';
      var groups = [];
      for (var i = 0; i < state.table.length; i++) {
        var cardData = state.table[i];
        var month = cardData.month >= 1 && cardData.month <= 12 ? cardData.month : null;
        var group = null;
        if (month !== null) {
          for (var g = 0; g < groups.length; g++) {
            if (groups[g].month === month) {
              group = groups[g];
              break;
            }
          }
        }
        if (!group) {
          group = {
            month: month,
            cards: [],
            order: i
          };
          groups.push(group);
        }
        group.cards.push(cardData);
      }
      groups.sort(function (a, b) {
        if (a.month === null && b.month === null) return a.order - b.order;
        if (a.month === null) return 1;
        if (b.month === null) return -1;
        return a.month - b.month;
      });
      for (var j = 0; j < groups.length; j++) {
        var monthGroup = root.document.createElement('div');
        monthGroup.className = 'floor-month-group';
        if (groups[j].month !== null) {
          monthGroup.setAttribute('data-month', groups[j].month);
        }
        for (var c = 0; c < groups[j].cards.length; c++) {
          var card = deps.makeCardEl(groups[j].cards[c], 'small');
          card.setAttribute('data-card-id', groups[j].cards[c].id);
          monthGroup.appendChild(card);
        }
        el.table.appendChild(monthGroup);
      }
      el.tableHint.innerHTML = state.table.length ? '바닥 ' + state.table.length + '장' : '';

      el.deckStack.innerHTML = '';
      if (state.deckCount > 0) {
        var stack = root.document.createElement('div');
        stack.className = 'deck';
        for (var d = 0; d < Math.min(state.deckCount, 5); d++) {
          var back = root.document.createElement('div');
          back.className = 'card back';
          stack.appendChild(back);
        }
        el.deckStack.appendChild(stack);
        var label = root.document.createElement('span');
        label.className = 'deck-count';
        label.innerHTML = '뒷패 ' + state.deckCount + '장';
        el.deckStack.appendChild(label);
      }
    }

    return { render: render };
  };
})(window);
