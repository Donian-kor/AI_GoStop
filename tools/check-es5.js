'use strict';
// 구형 브라우저(Android 4.4) 호환 검사 — ES6+ 구문이 남아있는지 찾는다.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'public');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

const PATTERNS = [
  ['화살표 함수', /=>/],
  ['let 선언', /(^|[^.\w])let\s+[A-Za-z_$]/],
  ['const 선언', /(^|[^.\w])const\s+[A-Za-z_$]/],
  ['템플릿리터럴', /`/],
  ['async/await', /\b(async|await)\b/],
  ['Promise', /\bPromise\b/],
  ['fetch(', /\bfetch\s*\(/],
  ['전개연산자', /\.\.\./],
  ['기본매개변수', /function\s*\([^)]*=[^)]*\)/],
  ['?. / ??', /(\?\.|\?\?)/],
  ['Object.assign', /Object\.assign/],
  ['Array find/includes', /\.(find|includes)\s*\(/],
  ['padStart', /pad(Start|End)/],
  ['Object.entries/values', /Object\.(entries|values)/],
  ['Array.from', /Array\.from/],
  ['class ', /(^|[^.\w])class\s+[A-Za-z_$]/],
  ['for...of', /for\s*\(\s*(var|let|const)?\s*\w+\s+of\s/],
  ['getElementById 후 ?. 등', /\?\./],
];

let total = 0;
for (const f of files) {
  const p = path.join(dir, f);
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    // 주석 줄은 무시
    const trimmed = line.replace(/^\s*(\/\/|\*|\/\*).*/, '');
    for (const [name, re] of PATTERNS) {
      if (re.test(trimmed)) {
        console.log(`${f}:${i + 1}  [${name}]  ${line.trim().slice(0, 90)}`);
        total++;
      }
    }
  });
}
console.log(total === 0 ? '\n✅ ES6+ 구문 없음 — 구형 브라우저 호환' : `\n⚠️  ${total}건 발견`);
