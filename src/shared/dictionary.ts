import type { DictionaryEntry } from './types'

const BASIC_DICTIONARY: Record<string, DictionaryEntry> = {
  hello: { word: 'hello', phonetic: 'həˈləʊ', definitions: ['int. 你好；喂', 'n. 招呼'] },
  world: { word: 'world', phonetic: 'wɜːld', definitions: ['n. 世界；领域；世人'] },
  snap: { word: 'snap', phonetic: 'snæp', definitions: ['v. 咔嚓折断；抓拍', 'n. 快照'] },
  glass: { word: 'glass', phonetic: 'ɡlɑːs', definitions: ['n. 玻璃；玻璃杯', 'adj. 玻璃制的'] },
  screenshot: {
    word: 'screenshot',
    phonetic: 'ˈskriːnʃɒt',
    definitions: ['n. 屏幕截图']
  },
  screen: { word: 'screen', phonetic: 'skriːn', definitions: ['n. 屏幕；屏风', 'v. 筛查'] },
  shot: { word: 'shot', phonetic: 'ʃɒt', definitions: ['n. 射击；快照；镜头'] },
  capture: {
    word: 'capture',
    phonetic: 'ˈkæptʃə',
    definitions: ['v. 捕获；拍摄；记录', 'n. 捕获']
  },
  image: { word: 'image', phonetic: 'ˈɪmɪdʒ', definitions: ['n. 图像；形象', 'v. 想象'] },
  text: { word: 'text', phonetic: 'tekst', definitions: ['n. 文本；正文', 'v. 发短信'] },
  copy: { word: 'copy', phonetic: 'ˈkɒpi', definitions: ['v. 复制；抄写', 'n. 副本'] },
  save: { word: 'save', phonetic: 'seɪv', definitions: ['v. 保存；节省；拯救'] },
  pin: { word: 'pin', phonetic: 'pɪn', definitions: ['v. 钉住；固定', 'n. 别针'] },
  edit: { word: 'edit', phonetic: 'ˈedɪt', definitions: ['v. 编辑；剪辑'] },
  translate: {
    word: 'translate',
    phonetic: 'trænsˈleɪt',
    definitions: ['v. 翻译；转化']
  },
  translation: {
    word: 'translation',
    phonetic: 'trænsˈleɪʃn',
    definitions: ['n. 翻译；译文；转化']
  },
  ocr: { word: 'OCR', phonetic: 'ˌəʊ siː ˈɑː', definitions: ['n. 光学字符识别'] },
  speech: { word: 'speech', phonetic: 'spiːtʃ', definitions: ['n. 语音；演讲'] },
  voice: { word: 'voice', phonetic: 'vɔɪs', definitions: ['n. 声音；嗓音'] },
  window: { word: 'window', phonetic: 'ˈwɪndəʊ', definitions: ['n. 窗口；窗户'] },
  arrow: { word: 'arrow', phonetic: 'ˈærəʊ', definitions: ['n. 箭头；箭'] },
  line: { word: 'line', phonetic: 'laɪn', definitions: ['n. 线；台词；队列'] },
  mosaic: { word: 'mosaic', phonetic: 'məʊˈzeɪɪk', definitions: ['n. 马赛克；镶嵌画'] },
  marker: { word: 'marker', phonetic: 'ˈmɑːkə', definitions: ['n. 记号笔；标记'] },
  font: { word: 'font', phonetic: 'fɒnt', definitions: ['n. 字体；字形'] },
  bold: { word: 'bold', phonetic: 'bəʊld', definitions: ['adj. 粗体的；大胆的'] },
  italic: { word: 'italic', phonetic: 'ɪˈtælɪk', definitions: ['adj. 斜体的', 'n. 斜体字'] },
  underline: {
    word: 'underline',
    phonetic: 'ˌʌndəˈlaɪn',
    definitions: ['v. 在…下画线；强调', 'n. 下划线']
  },
  project: { word: 'project', phonetic: 'ˈprɒdʒekt', definitions: ['n. 项目；工程', 'v. 投射'] },
  skill: { word: 'skill', phonetic: 'skɪl', definitions: ['n. 技能；技巧'] },
  plugin: { word: 'plugin', phonetic: 'ˈplʌɡɪn', definitions: ['n. 插件'] },
  setting: { word: 'setting', phonetic: 'ˈsetɪŋ', definitions: ['n. 设置；环境；背景'] },
  light: { word: 'light', phonetic: 'laɪt', definitions: ['n. 光；灯', 'adj. 轻的；浅色的'] },
  dark: { word: 'dark', phonetic: 'dɑːk', definitions: ['adj. 深色的；黑暗的'] },
  system: { word: 'system', phonetic: 'ˈsɪstəm', definitions: ['n. 系统；制度'] },
  windowed: { word: 'windowed', phonetic: 'ˈwɪndəʊd', definitions: ['adj. 有窗口的'] },
  你好: { word: '你好', phonetic: 'nǐ hǎo', definitions: ['int. 见面时的问候语'] },
  世界: { word: '世界', phonetic: 'shì jiè', definitions: ['n. 地球上的全部；领域'] },
  文字: { word: '文字', phonetic: 'wén zì', definitions: ['n. 记录语言的符号；文章'] },
  翻译: { word: '翻译', phonetic: 'fān yì', definitions: ['v. 把一种语言转换成另一种语言', 'n. 翻译人员'] },
  截图: { word: '截图', phonetic: 'jié tú', definitions: ['n. 截取的屏幕图像'] }
}

export function normalizeDictionaryWord(word: string): string {
  return word.trim().toLowerCase().replace(/^[^a-z\u3400-\u9fff]+|[^a-z\u3400-\u9fff]+$/g, '')
}

export function lookupWord(word: string): DictionaryEntry | null {
  return BASIC_DICTIONARY[normalizeDictionaryWord(word)] ?? null
}
