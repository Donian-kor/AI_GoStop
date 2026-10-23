'use strict';

(function (root) {
  root.GostopOpponentCardMotion = function (deps) {
    var impactTimer = null;

    function cardBox(centerRect, width, height) {
      return {
        left: centerRect.left + centerRect.width / 2 - width / 2,
        top: centerRect.top + centerRect.height / 2 - height / 2,
        width: width,
        height: height
      };
    }

    function captureImpact() {
      var table = deps.el.table;
      var classes = (table.className || '').split(/\s+/);
      var nextClasses = [];
      for (var i = 0; i < classes.length; i++) {
        if (classes[i] && classes[i] !== 'capture-impact') nextClasses.push(classes[i]);
      }
      table.className = nextClasses.join(' ');
      table.offsetWidth;
      nextClasses.push('capture-impact');
      table.className = nextClasses.join(' ');

      if (impactTimer) clearTimeout(impactTimer);
      impactTimer = setTimeout(function () {
        var current = (table.className || '').split(/\s+/);
        var remaining = [];
        for (var j = 0; j < current.length; j++) {
          if (current[j] && current[j] !== 'capture-impact') remaining.push(current[j]);
        }
        table.className = remaining.join(' ');
        impactTimer = null;
      }, 360);
    }

    function play(events) {
      if (!events || !events.length) return;
      for (var i = 0; i < events.length; i++) {
        var event = events[i];
        if (!event || !event.cards || !event.cards.length) continue;
        if (event.seat < 0) continue;
        var isMe = event.seat === deps.mySeat();
        var seat = isMe ? null : deps.seatEl(event.seat);
        if (!isMe && !seat) continue;
        var seatRect = isMe ? deps.el.meCaptured.getBoundingClientRect() : seat.getBoundingClientRect();

        if (event.kind === 'place' || event.kind === 'bbeok') {
          if (isMe) continue;
          for (var c = 0; c < event.cards.length; c++) {
            var id = event.cards[c];
            var target = deps.el.table.querySelector('[data-card-id="' + id + '"]');
            if (!target) continue;
            var toRect = target.getBoundingClientRect();
            var fromBox = cardBox(seatRect, toRect.width, toRect.height);
            target.style.opacity = '0';
            deps.getFlyingCards()[id] = 1;
            deps.fx.animateCardMove(fromBox, toRect, deps.cardImg({ id: id }), 340, -8, (function (cardId, node) {
              return function () {
                delete deps.getFlyingCards()[cardId];
                var again = node && node.parentNode
                  ? node
                  : deps.el.table.querySelector('[data-card-id="' + cardId + '"]');
                if (again) again.style.opacity = '';
              };
            })(id, target));
          }
        } else if (event.kind === 'capture') {
          captureImpact();
          var rack = isMe ? deps.el.meCaptured : (seat.querySelector('.opp-box') || seat);
          var rackRect = rack.getBoundingClientRect();
          for (var k = 0; k < event.cards.length; k++) {
            var cardId = event.cards[k];
            var old = deps.getPreviousCardRects()[cardId];
            var from = old || cardBox(seatRect, 54, 88);
            deps.fx.animateCardMove(from, rackRect, deps.cardImg({ id: cardId }), 380, 10);
          }
        }
      }
    }

    return { play: play };
  };
})(window);
