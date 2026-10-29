const { createReadStream, writeFileSync, mkdirSync, statSync } = require('node:fs')
const { createInterface } = require('node:readline')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const SOURCE = path.join(ROOT, 'test-results', 'ecdict', 'ecdict.csv')
const TARGET = path.join(ROOT, 'assets', 'dict', 'ecdict-common.json')
const LIMIT = Number(process.env.DICT_LIMIT ?? 30000)

const TAG_WEIGHT = {
  zk: 100,
  gk: 90,
  cet4: 80,
  cet6: 70,
  ky: 60,
  toefl: 50,
  ielts: 40,
  gre: 30
}

function parseCsvLine(line) {
  const out = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          value += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        value += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      out.push(value)
      value = ''
    } else {
      value += char
    }
  }
  out.push(value)
  return out
}

function score(entry) {
  const tags = (entry.tag || '').split(/\s+/).filter(Boolean)
  const tag = tags.reduce((best, item) => Math.max(best, TAG_WEIGHT[item] ?? 0), 0)
  const collins = Number(entry.collins) || 0
  const frq = Number(entry.frq) || 0
  const bnc = Number(entry.bnc) || 0
  const rank = frq || bnc
  return tag * 1000 + collins * 500 + (rank > 0 ? Math.max(0, 120000 - rank) / 50 : 0)
}

async function main() {
  const lines = createInterface({ input: createReadStream(SOURCE, 'utf8'), crlfDelay: Infinity })
  const selected = []
  let index = 0
  for await (const line of lines) {
    index += 1
    if (index === 1 || !line) continue
    const fields = parseCsvLine(line)
    const [word, phonetic, , translation, pos, collins, , tag, bnc, frq] = fields
    if (!/^[a-z][a-z'-]{1,23}$/.test(word)) continue
    if (!translation || !(tag || Number(collins) > 0 || Number(bnc) > 0 || Number(frq) > 0)) {
      continue
    }
    const entry = { word, phonetic, translation, pos, collins, tag, bnc, frq }
    selected.push({ entry, score: score(entry) })
  }
  selected.sort((a, b) => b.score - a.score)
  const picked = selected.slice(0, LIMIT)
  const dictionary = {}
  for (const { entry } of picked) {
    const meanings = entry.translation
      .split(/\\n|\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4)
    if (!meanings.length) continue
    const pos = meanings
      .map((item) => /^(n|v|vt|vi|adj|adv|prep|pron|conj|num|art|int|aux|abbr)\./.exec(item)?.[1])
      .filter(Boolean)
    dictionary[entry.word] = {
      p: entry.phonetic || '',
      t: meanings,
      pos: [...new Set(pos)].slice(0, 4)
    }
  }
  mkdirSync(path.dirname(TARGET), { recursive: true })
  writeFileSync(TARGET, JSON.stringify(dictionary), 'utf8')
  const size = statSync(TARGET).size
  console.log('DICT_BUILT', Object.keys(dictionary).length, 'words', (size / 1024 / 1024).toFixed(2), 'MB')
}

main().catch((error) => {
  console.error('DICT_BUILD_FAIL', error)
  process.exit(1)
})
