#!/usr/bin/env node
// 자산 1회 다운로드 스크립트
//
// 1) civilian7/gostop — 화투 카드 SVG (CC BY-SA 4.0) · Kenney 효과음 OGG (CC0)
// 2) itsent-lab/hwatu — 카드 SVG(m01-01.svg, CC BY-SA 4.0) · 고스톱용 효과음 WAV (CC0)
// 3) civilian7/gostop — 재플레이 레코드 (.rec)
//
// 사용법: node tools/fetch-assets.js [--force]
//
// 주의: 재다운로드하되 기존 파일이 있으면 건너뛴다(--force 로 강제 재다운로드).

'use strict';

const fs = require('fs');
const path = require('path');

const REPOS = {
  gostop: { owner: 'civilian7', repo: 'gostop', branch: 'main' },
  hwatu: { owner: 'itsent-lab', repo: 'hwatu', branch: 'main' },
};

const ROOT = path.join(__dirname, '..');
const FORCE = process.argv.includes('--force');

/** 저장 위치별 규칙: [저장 디렉터리, 저장된 파일명 → 원본 경로(prefix) 안에서의 이름] */
const TARGETS = [
  // civilian7: 화투 카드 SVG
  {
    dir: path.join(ROOT, 'assets', 'hwatu', 'svg'),
    repo: 'gostop',
    prefix: 'assets/hwatu/svg/',
    ext: '.svg',
    exclude: (n) => n.endsWith('_flipped.svg') || n === 'overview.svg',
  },
  // civilian7: Kenney 효과음 OGG
  {
    dir: path.join(ROOT, 'assets', 'audio'),
    repo: 'gostop',
    prefix: 'assets/audio/',
    ext: '.ogg',
    exclude: () => false,
  },
  // itsent-lab: 카드 SVG (m01-01.svg … m12-04.svg) — 동일 저작자·라이선스
  {
    dir: path.join(ROOT, 'assets', 'hwatu', 'svg'),
    repo: 'hwatu',
    prefix: 'apps/web/public/cards/hwatu/',
    ext: '.svg',
    exclude: (n) => n === 'verification.json',
  },
  // itsent-lab: 고스톱용 효과음 WAV (CC0)
  {
    dir: path.join(ROOT, 'assets', 'audio'),
    repo: 'hwatu',
    prefix: 'apps/web/public/audio/effects/',
    ext: '.wav',
    exclude: (n) => n === 'verification.json' || n === 'mission.wav',
  },
  // civilian7: 화투 카드 PNG (600x978, 미리 래스터화)
  //   → SVG 는 고DPR 기기에서 내재 크기(103px)로 래스터화돼 확대 시 흐려진다.
  //      PNG 는 600px 로 미리 그려져 있어 어떤 기기에서든 선명하다.
  {
    dir: path.join(ROOT, 'assets', 'hwatu', 'png'),
    repo: 'gostop',
    prefix: 'assets/hwatu/',
    ext: '.png',
    exclude: (n) => n.startsWith('back_'),
  },
  // itsent-lab: 추가 효과음 MP3 (CC0) + 국악 배경음악 (CC BY 4.0)
  {
    dir: path.join(ROOT, 'assets', 'audio'),
    repo: 'hwatu',
    prefix: 'apps/web/public/audio/',
    ext: '.mp3',
    exclude: (n) => n === 'verification.json',
  },
  // civilian7: 재플레이 레코드
  {
    dir: path.join(ROOT, 'tests', 'records'),
    repo: 'gostop',
    prefix: 'delphi/records/',
    ext: '.rec',
    exclude: () => false,
  },
];

function apiUrl(repo) {
  const { owner, repo: name, branch } = REPOS[repo];
  return `https://api.github.com/repos/${owner}/${name}/git/trees/${branch}?recursive=1`;
}

function rawUrl(repo, p) {
  const { owner, repo: name, branch } = REPOS[repo];
  return `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${p}`;
}

async function getTree(repo) {
  const res = await fetch(apiUrl(repo), { headers: { 'User-Agent': 'gostop-game-fetch-assets' } });
  if (!res.ok) throw new Error(`GitHub API 실패 (${repo}): ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (!json.tree) throw new Error(`tree 응답에 tree 배열이 없습니다 (${repo}).`);
  return json.tree;
}

async function download(url, dest, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'gostop-game-fetch-assets' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    if (dest.endsWith('.svg')) stripFixedSize(dest);
    return buf.length;
  } catch (err) {
    if (attempt >= 3) throw err;
    await new Promise((r) => setTimeout(r, 600 * attempt));
    return download(url, dest, attempt + 1);
  }
}

/**
 * SVG의 고정 크기(width/height) 속성을 제거한다.
 * 고정 크기가 있으면 브라우저가 내재 크기로 래스터화한 뒤 확대해
 * 고DPR 기기에서 뿌옇게 보이기 때문이다.
 */
function stripFixedSize(file) {
  const text = fs.readFileSync(file, 'utf8');
  const fixed = text.replace(/<svg\s+width="[^"]*"\s+height="[^"]*"/, '<svg');
  if (fixed !== text) fs.writeFileSync(file, fixed, 'utf8');
}

async function main() {
  const trees = {};
  let done = 0;
  let skipped = 0;
  let bytes = 0;

  for (const t of TARGETS) {
    if (!trees[t.repo]) {
      console.log(`[fetch-assets] ${REPOS[t.repo].owner}/${REPOS[t.repo].repo} 트리 조회 중...`);
      trees[t.repo] = await getTree(t.repo);
    }
    const files = trees[t.repo].filter(
      (n) => n.type === 'blob' && n.path.startsWith(t.prefix) && n.path.endsWith(t.ext) && !t.exclude(n.path.split('/').pop())
    );
    console.log(`[fetch-assets] ${t.repo}:${t.prefix} → ${files.length}개`);

    const CONCURRENCY = 6;
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const chunk = files.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (node) => {
          const name = node.path.split('/').pop();
          const dest = path.join(t.dir, name);
          if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size === node.size) {
            skipped++;
            return;
          }
          const size = await download(rawUrl(t.repo, node.path), dest);
          done++;
          bytes += size;
        })
      );
      const pct = Math.min(i + CONCURRENCY, files.length);
      process.stdout.write(`\r  진행 ${pct}/${files.length}`);
    }
    process.stdout.write('\n');
  }

  console.log(`[fetch-assets] 완료 — 신규 ${done}개, 건너뜀 ${skipped}개, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  console.log('[fetch-assets] ※ 라이선스는 ATTRIBUTION.md 참고 (화투 SVG = CC BY-SA 4.0, 효과음 = CC0)');
}

main().catch((err) => {
  console.error('[fetch-assets] 실패:', err.message);
  process.exit(1);
});
