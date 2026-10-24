'use strict';

// 4인 광팔기의 실제 좌석과 엔진 좌석 변환을 확인한다.

const test = require('node:test');
const assert = require('node:assert');
const { Room, ROOM_PHASE } = require('../server/rooms');
const { PHASE, TurnEngine } = require('../engine/play');

function createRoom() {
  const room = new Room('FOURPX', { mode: 'multi', playerCount: 4 });
  for (let seat = 0; seat < 4; seat++) room.addPlayer(`p${seat}`, `플레이어${seat}`);
  room.startRound();
  return room;
}

function resolveRound(decisions) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const room = createRoom();
    for (const [seat, decision] of decisions) room.negotiateDecision(seat, decision);
    if (room.phase === ROOM_PHASE.PLAY) return room;
  }
  throw new Error('진행 가능한 4인 판을 준비하지 못했습니다.');
}

test('4인 광팔기의 모든 결과에서 선택 차례는 실제 좌석으로 표시된다', () => {
  const scenarios = [
    { decisions: [[1, 'giveup']], playSeats: [0, 2, 3], engineSeat: 1, physicalSeat: 2 },
    { decisions: [[1, 'join'], [2, 'giveup']], playSeats: [0, 1, 3], engineSeat: 2, physicalSeat: 3 },
    { decisions: [[1, 'join'], [2, 'join'], [3, 'sell']], playSeats: [0, 1, 2], engineSeat: 1, physicalSeat: 1 },
    { decisions: [[1, 'join'], [2, 'join'], [3, 'join']], playSeats: [0, 1, 2], engineSeat: 1, physicalSeat: 1 },
  ];

  for (const scenario of scenarios) {
    const room = resolveRound(scenario.decisions);
    assert.deepStrictEqual(room.playSeats, scenario.playSeats);
    room.engine.state.current = scenario.engineSeat;
    room.engine.state.phase = PHASE.AWAITING_GO_STOP;
    room.syncPrompt();
    assert.strictEqual(room.prompt.seat, scenario.physicalSeat);
    assert.strictEqual(room.snapshot(scenario.physicalSeat).currentSeat, scenario.physicalSeat);
    room.afterAction({ awaiting: 'floorChoice', options: [] });
    assert.strictEqual(room.prompt.seat, scenario.physicalSeat);
  }
});

test('4인 광팔기에서 정산 좌석을 실제 좌석으로 변환한다', () => {
  const room = resolveRound([[1, 'giveup']]);
  const rows = [
    { seat: 0, name: '플레이어0', net: -10, points: -10 },
    { seat: 1, name: '플레이어2', net: 20, points: 20 },
    { seat: 2, name: '플레이어3', net: -10, points: -10 },
  ].map((row) => ({
    ...row,
    goCount: 0,
    reverseGo: false,
    shakeCount: 0,
    bombCount: 0,
    reasons: [],
    steps: [],
    paymentExempt: false,
    pibak: false,
    gwangbak: false,
    meongbak: false,
    gobak: false,
  }));
  room.engine = {
    state: { winner: 1 },
    finalSettlement: () => rows,
  };

  room.finishRound();

  assert.strictEqual(room.result.winnerSeat, 2);
  assert.deepStrictEqual(room.result.rows.map((row) => row.seat), [0, 2, 3]);
  assert.strictEqual(room.seats[1].money, room.settings.seedMoney, '빠진 사람의 잔액은 바뀌지 않아야 한다');
  assert.strictEqual(room.seats.reduce((sum, player) => sum + player.money, 0), room.settings.seedMoney * 4);
});

test('다음 판을 시작하면 이전 판의 좌석 매핑을 버린다', () => {
  const room = resolveRound([[1, 'giveup']]);
  assert.deepStrictEqual(room.playSeats, [0, 2, 3]);

  room.startRound();

  assert.strictEqual(room.playSeats, null);
  assert.strictEqual(room.phase, ROOM_PHASE.NEGOTIATE);
});

test('다음 판은 이전 승자가 선이 되고 4인 협상 순서도 승자 기준으로 돈다', () => {
  const twoPlayerRoom = new Room('NEXT2P', { mode: 'multi', playerCount: 2 });
  twoPlayerRoom.addPlayer('host', '방장');
  twoPlayerRoom.addPlayer('winner', '이전 승자');
  twoPlayerRoom.result = { winnerSeat: 1, nagari: false };
  twoPlayerRoom.phase = ROOM_PHASE.SETTLE;

  assert.throws(
    () => twoPlayerRoom.act(twoPlayerRoom.seats[0], 'nextGame'),
    /이긴 사람만 다음 판을 시작할 수 있습니다/
  );
  twoPlayerRoom.act(twoPlayerRoom.seats[1], 'nextGame');

  assert.strictEqual(twoPlayerRoom.engine.state.current, 1);

  const fourPlayerRoom = createRoom();
  fourPlayerRoom.result = { winnerSeat: 2, nagari: false };
  fourPlayerRoom.phase = ROOM_PHASE.SETTLE;
  fourPlayerRoom.act(fourPlayerRoom.seats[2], 'nextGame');

  assert.deepStrictEqual(fourPlayerRoom.negotiation.order, [3, 0, 1]);
  fourPlayerRoom.negotiateDecision(3, 'join');
  fourPlayerRoom.negotiateDecision(0, 'join');
  fourPlayerRoom.negotiateDecision(1, 'sell');
  assert.deepStrictEqual(fourPlayerRoom.playSeats, [2, 3, 0]);
  assert.strictEqual(fourPlayerRoom.gwangSale.sellerSeat, 1);
  assert.deepStrictEqual(fourPlayerRoom.gwangSale.payerSeats, [3, 0]);
  assert.strictEqual(fourPlayerRoom.physicalSeatOf(fourPlayerRoom.engine.state.current), 2);
});

test('방 스냅샷은 상대의 흔들기 가능 월을 공개하지 않는다', () => {
  const room = new Room('SHAKEPX', { mode: 'multi', playerCount: 2 });
  room.addPlayer('p0', '플레이어0');
  room.addPlayer('p1', '플레이어1');
  room.engine = new TurnEngine({ playerCount: 2, names: ['플레이어0', '플레이어1'] });
  room.phase = ROOM_PHASE.PLAY;
  room.engine.state.players[0].hand = [{ month: 4 }, { month: 4 }, { month: 4 }];
  room.engine.state.players[1].hand = [{ month: 5 }, { month: 5 }, { month: 5 }];

  const snapshot = room.snapshot(0, 'p0');

  assert.deepStrictEqual(snapshot.players[0].shakableMonths, [4]);
  assert.deepStrictEqual(snapshot.players[1].shakableMonths, []);
  assert.ok(!('hostId' in snapshot));
});

test('방 종료는 긴 폴링 대기자를 깨우고 AI 타이머를 정리한다', async () => {
  const room = new Room('CLOSEPX', { mode: 'solo', playerCount: 2 });
  const controller = new AbortController();
  const waiting = room.waitForChange(10000, controller.signal);
  room.aiTimer = setTimeout(() => {}, 10000);

  assert.strictEqual(room.changeWaiters.length, 1);
  room.close();

  assert.strictEqual(await waiting, false);
  assert.strictEqual(room.changeWaiters.length, 0);
  assert.strictEqual(room.aiTimer, null);
});
