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

    function getCardMonth(id, state) {
      var areas = [state.table || []];
      var mySeat = deps.mySeat();
      if (state.players && state.players[mySeat]) {
        areas.push(state.players[mySeat].capturedCards || []);
      }
      for (var i = 0; i < areas.length; i++) {
        for (var j = 0; j < areas[i].length; j++) {
          if (areas[i][j].id === id) return areas[i][j].month;
        }
      }
      return null;
    }

    function currentFloorRect(id) {
      var node = deps.el.table.querySelector('[data-card-id="' + id + '"]');
      return node ? node.getBoundingClientRect() : null;
    }

    function deckRect() {
      var card = deps.el.deckStack.querySelector('.card.back');
      return (card || deps.el.deckStack).getBoundingClientRect();
    }

    function targetRect(id, state, context) {
      var month = getCardMonth(id, state);
      var target = null;
      if (month !== null) {
        for (var i = 0; i < context.floorCards.length; i++) {
          var oldCard = context.floorCards[i];
          if (oldCard.month === month && context.rects[oldCard.id]) {
            target = context.rects[oldCard.id];
          }
        }
      }
      return target || currentFloorRect(id) ||
        cardBox(deps.el.table.getBoundingClientRect(), 54, 88);
    }

    function newlyPlacedHandCard(state, context) {
      for (var i = 0; i < (state.table || []).length; i++) {
        var card = state.table[i];
        if (context.handIds[card.id]) return card.id;
      }
      return null;
    }

    function flippedCardId(event, state, context) {
      for (var i = 0; i < event.cards.length; i++) {
        var id = event.cards[i];
        if (!context.handIds[id] && !context.floorIds[id]) return id;
      }
      for (var j = 0; j < (state.table || []).length; j++) {
        var card = state.table[j];
        if (!context.handIds[card.id] && !context.floorIds[card.id]) return card.id;
      }
      return null;
    }

    function animateToFloor(id, from, to, isFlip, done) {
      var node = deps.el.table.querySelector('[data-card-id="' + id + '"]');
      if (node) node.style.opacity = '0';
      var onArrive = function () {
        if (node) node.style.opacity = '';
        if (done) done();
      };
      if (isFlip && deps.fx.animateCardFlipMove) {
        deps.fx.animateCardFlipMove(from, to, deps.cardImg({ id: id }), 420, 8, onArrive);
      } else {
        deps.fx.animateCardMove(from, to, deps.cardImg({ id: id }), isFlip ? 420 : 300, -8, onArrive);
      }
    }

    function playOwnPlace(event, state, context) {
      var playedId = newlyPlacedHandCard(state, context);
      var flippedId = flippedCardId(event, state, context);
      if (flippedId === playedId) flippedId = null;
      var stages = [];
      if (playedId && context.rects[playedId]) {
        stages.push({
          id: playedId,
          from: context.rects[playedId],
          to: currentFloorRect(playedId),
          isFlip: false
        });
      }
      if (flippedId) {
        stages.push({
          id: flippedId,
          from: deckRect(),
          to: currentFloorRect(flippedId),
          isFlip: true
        });
      }
      if (!stages.length) return false;
      function next(index) {
        if (index >= stages.length) return;
        var stage = stages[index];
        animateToFloor(stage.id, stage.from, stage.to, stage.isFlip, function () {
          next(index + 1);
        });
      }
      next(0);
      return true;
    }

    function finishCapture(event, state, context, playedId, flippedId, playedTarget, flippedTarget, seat) {
      captureImpact();
      var rack = event.seat === deps.mySeat()
        ? deps.el.meCaptured
        : (seat.querySelector('.opp-box') || seat);
      var rackRect = rack.getBoundingClientRect();
      var fallbackRect = (seat || deps.el.deckStack).getBoundingClientRect();
      for (var i = 0; i < event.cards.length; i++) {
        var id = event.cards[i];
        var from = id === playedId ? playedTarget : null;
        if (id === flippedId) from = flippedTarget;
        if (!from) from = context.rects[id] || cardBox(
          fallbackRect, 54, 88
        );
        deps.fx.animateCardMove(from, rackRect, deps.cardImg({ id: id }), 380, 10);
      }
    }

    function playOwnCapture(event, state, context, seat) {
      var playedId = null;
      for (var i = 0; i < event.cards.length; i++) {
        if (context.handIds[event.cards[i]]) {
          playedId = event.cards[i];
          break;
        }
      }
      if (!playedId) playedId = newlyPlacedHandCard(state, context);
      var flippedId = flippedCardId(event, state, context);
      if (flippedId && getCardMonth(flippedId, state) === null) flippedId = null;
      if (flippedId === playedId) flippedId = null;
      if (!playedId && !flippedId) return false;

      var playedTarget = playedId ? targetRect(playedId, state, context) : null;
      var flippedTarget = flippedId ? targetRect(flippedId, state, context) : null;
      function capture() {
        finishCapture(event, state, context, playedId, flippedId, playedTarget, flippedTarget, seat);
      }
      function flip() {
        if (!flippedId) { capture(); return; }
        animateToFloor(flippedId, deckRect(), flippedTarget, true, capture);
      }
      if (!playedId) { flip(); return true; }
      animateToFloor(playedId, context.rects[playedId], playedTarget, false, flip);
      return true;
    }

    function play(events, state) {
      if (!events || !events.length) return;
      var context = deps.getPreviousMoveContext
        ? deps.getPreviousMoveContext()
        : { rects: {}, handIds: {}, floorIds: {}, floorCards: [] };
      context.handIds = context.handIds || {};
      context.floorIds = context.floorIds || {};
      context.floorCards = context.floorCards || [];
      context.rects = deps.getPreviousCardRects();
      for (var i = 0; i < events.length; i++) {
        var event = events[i];
        if (!event || !event.cards || !event.cards.length) continue;
        if (event.seat < 0) continue;
        var isMe = event.seat === deps.mySeat();
        var seat = isMe ? null : deps.seatEl(event.seat);
        if (!isMe && !seat) continue;
        var seatRect = isMe ? deps.el.meCaptured.getBoundingClientRect() : seat.getBoundingClientRect();

        if (event.kind === 'place' || event.kind === 'bbeok') {
          if (isMe) {
            if (event.kind === 'place') playOwnPlace(event, state || {}, context);
            continue;
          }
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
          if (isMe && playOwnCapture(event, state || {}, context, seat)) continue;
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
