// データ検査（CLAUDE.md §4.3）。`npm test` で走る。
// 生成物（data/*.json）が、エンジンが前提にしてよい形になっているかを確かめる。
// 平仄・韻目の正誤そのものは判定しない（根拠は元データとゴールデンテストに置く）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Tone = "平" | "上" | "去" | "入";
type Reading = { tone: Tone; rhyme: string; note?: string };
type Rhyme = { id: string; tone: Tone };

const read = (path: string) => readFileSync(new URL(`../data/${path}`, import.meta.url), "utf-8");

const rhymes: Rhyme[] = JSON.parse(read("rhymes.json"));
const charsText = read("chars.json");
const chars: Record<string, Reading[]> = JSON.parse(charsText);
const variants: Record<string, string[]> = JSON.parse(read("variants.json"));
const kokuji: {
  source: { url: string; license: string };
  chars: { char: string; note?: string }[];
} = JSON.parse(read("kokuji.json"));
const corrections: {
  corrections: { action: string; char: string; rhyme: string; reason: string; evidence: string[] }[];
} = JSON.parse(read("corrections.json"));

const TONES: readonly Tone[] = ["平", "上", "去", "入"];
const PREFIX_TONE: Record<string, Tone> = { 上平: "平", 下平: "平", 上声: "上", 去声: "去", 入声: "入" };
const RHYME_ID = /^(上平|下平|上声|去声|入声)([一二三四五六七八九十]+)(\p{Script=Han})$/u;
const NOTES = new Set(["【詞】", "【辭】"]);
const rhymeById = new Map(rhymes.map((r) => [r.id, r]));

const isSingleHan = (s: string) => [...s].length === 1 && /^\p{Script=Han}$/u.test(s);

describe("rhymes.json（韻目）", () => {
  it("平水韻の106韻目がそろい、重複がない", () => {
    expect(rhymes).toHaveLength(106);
    expect(rhymeById.size).toBe(106);
  });

  it("韻目名の書き方が統一され、接頭辞と声調が合っている", () => {
    for (const r of rhymes) {
      const m = RHYME_ID.exec(r.id);
      expect(m, `韻目名の書き方が違う: ${r.id}`).not.toBeNull();
      expect(r.tone, r.id).toBe(PREFIX_TONE[m![1]!]);
    }
  });

  it("韻目の見出し字は、その韻目の本体に載っている", () => {
    for (const r of rhymes) {
      const head = [...r.id].at(-1)!;
      const reading = chars[head]?.find((x) => x.rhyme === r.id);
      expect(reading, `${r.id} の見出し字「${head}」が載っていない`).toBeDefined();
      expect(reading!.note, `${r.id} の見出し字「${head}」が【詞】【辭】欄にしかない`).toBeUndefined();
    }
  });
});

describe("chars.json（平仄データ）", () => {
  it("同じ字が2回定義されていない（JSON として読む前のテキストで確かめる）", () => {
    const keys = [...charsText.matchAll(/^\s*"([^"]+)":/gmu)].map((m) => m[1]!);
    expect(keys.length).toBe(Object.keys(chars).length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("見出しはすべて漢字1字", () => {
    const bad = Object.keys(chars).filter((c) => !isSingleHan(c));
    expect(bad).toEqual([]);
  });

  it("読みの声調は 平・上・去・入 のいずれかで、韻目は rhymes.json にあり、声調と韻目が合っている", () => {
    for (const [c, readings] of Object.entries(chars)) {
      expect(readings.length, c).toBeGreaterThan(0);
      for (const r of readings) {
        expect(TONES, `${c} の声調`).toContain(r.tone);
        const rhyme = rhymeById.get(r.rhyme);
        expect(rhyme, `${c} の韻目 ${r.rhyme} が rhymes.json にない`).toBeDefined();
        expect(r.tone, `${c} ${r.rhyme}`).toBe(rhyme!.tone);
        if (r.note !== undefined) expect(NOTES, `${c} の note`).toContain(r.note);
        expect(Object.keys(r).filter((k) => !["tone", "rhyme", "note"].includes(k)), c).toEqual([]);
      }
    }
  });

  it("1字の中で同じ韻目の読みが重複していない", () => {
    for (const [c, readings] of Object.entries(chars)) {
      const ids = readings.map((r) => r.rhyme);
      expect(new Set(ids).size, c).toBe(ids.length);
    }
  });

  it("どの韻目にも本体の字が1字以上ある", () => {
    const withBody = new Set(
      Object.values(chars).flatMap((rs) => rs.filter((r) => r.note === undefined).map((r) => r.rhyme)),
    );
    expect(rhymes.filter((r) => !withBody.has(r.id)).map((r) => r.id)).toEqual([]);
  });
});

describe("corrections.json（元データの修正）", () => {
  it("修正には理由と根拠があり、生成結果に反映されている", () => {
    for (const c of corrections.corrections) {
      expect(c.reason.length, `${c.char} ${c.rhyme}`).toBeGreaterThan(0);
      expect(c.evidence.length, `${c.char} ${c.rhyme}`).toBeGreaterThan(0);
      expect(c.action).toBe("add");
      const reading = chars[c.char]?.find((r) => r.rhyme === c.rhyme);
      expect(reading, `${c.char} ${c.rhyme}`).toEqual({ tone: rhymeById.get(c.rhyme)!.tone, rhyme: c.rhyme });
    }
  });
});

describe("variants.json（新字体・簡体字の対応）", () => {
  it("見出しは漢字1字で、候補はすべて平仄データにあり、重複がない", () => {
    for (const [k, cands] of Object.entries(variants)) {
      expect(isSingleHan(k), k).toBe(true);
      expect(cands.length, k).toBeGreaterThan(0);
      expect(new Set(cands).size, k).toBe(cands.length);
      for (const c of cands) expect(chars[c], `${k} → ${c}`).toBeDefined();
    }
  });

  it("自分自身にしか対応しない見出しは載せていない", () => {
    const selfOnly = Object.entries(variants).filter(([k, cands]) => cands.length === 1 && cands[0] === k);
    expect(selfOnly).toEqual([]);
  });
});

describe("kokuji.json（国字）", () => {
  it("出典とライセンスが書かれている", () => {
    expect(kokuji.source.url).toMatch(/^https:\/\//);
    expect(kokuji.source.license.length).toBeGreaterThan(0);
  });

  it("漢字1字ずつで、重複がない", () => {
    const list = kokuji.chars.map((k) => k.char);
    expect(list.filter((c) => !isSingleHan(c))).toEqual([]);
    expect(new Set(list).size).toBe(list.length);
  });
});
