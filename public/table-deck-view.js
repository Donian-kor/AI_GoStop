'use strict';

(function (root) {
  root.GostopTableDeckView = function (deps) {
    var el = deps.el;

    function render(state) {
      el.table.innerHTML = '';
      for (var i = 0; i < state.table.length; i++) {
        var card = deps.makeCardEl(state.table[i], 'small');
        card.setAttribute('data-card-id', state.table[i].id);
        el.table.appendChild(card);
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
