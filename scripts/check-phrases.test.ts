// 詩語頻度表（data/phrases/）の検査（CLAUDE.md §4.3）。`npm test` で走る。
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../data/phrases/", import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, dir), "utf-8"));
const rhymeIds = new Set((JSON.parse(readFileSync(new URL("../data/rhymes.json", import.meta.url), "utf-8")) as { id: string }[]).map((r) => r.id));

type Entry = { w: string; n: number; at: Record<string, number>; p: string[]; r: string[]; e: [string, string, string][] };
const index: { slots: string[]; minCount: number; counts: Record<string, number>; chars: Record<string, { file: string; "2": number; "3": number }> } = read("index.json");
const SLOT_START: Record<string, number> = { "1-2": 0, "3-4": 2, "5-6": 4, "6-7": 5, "5-7": 4 };

describe("data/phrases（詩語頻度表）", () => {
  it("索引とファイルが過不足なく対応する", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").sort();
    expect(Object.values(index.chars).map((c) => c.file).sort()).toEqual(files);
    expect(index.counts.files).toBe(files.length);
  });

  it("各語の形が正しく、出現回数・位置・用例が一貫している", () => {
    // 9万語あまりを調べるので、1件ごとに expect を呼ばず、誤りを集めて最後に確かめる
    const errors: string[] = [];
    const check = (ok: boolean, message: string) => {
      if (!ok && errors.length < 20) errors.push(message);
    };
    let n2 = 0;
    let n3 = 0;
    for (const [first, info] of Object.entries(index.chars)) {
      const groups: Record<"2" | "3", Entry[]> = read(info.file);
      check(groups["2"].length === info["2"] && groups["3"].length === info["3"], `${first}: 索引の語数と違う`);
      n2 += groups["2"].length;
      n3 += groups["3"].length;
      for (const size of ["2", "3"] as const) {
        const pattern = size === "2" ? /^[平仄？]{2}$/u : /^[平仄？]{3}$/u;
        let prev: Entry | null = null;
        for (const e of groups[size]) {
          const chars = [...e.w];
          check(chars.length === Number(size) && chars[0] === first, `${e.w}: 字数か先頭の字が違う`);
          check(e.n >= index.minCount, `${e.w}: 出現回数が${index.minCount}未満`);
          check(Object.values(e.at).reduce((a, b) => a + b, 0) === e.n, `${e.w}: 位置ごとの回数の合計が出現回数と違う`);
          for (const slot of Object.keys(e.at)) check(index.slots.includes(slot) && (slot === "5-7") === (size === "3"), `${e.w}: 位置 ${slot}`);
          check(e.p.length > 0 && e.p.every((p) => pattern.test(p)), `${e.w}: 平仄パターン ${e.p}`);
          check(e.r.every((r) => rhymeIds.has(r)), `${e.w}: 韻目 ${e.r}`);
          check(e.e.length > 0 && e.e.length <= 3, `${e.w}: 用例の数 ${e.e.length}`);
          for (const [, , line] of e.e) {
            const found = Object.keys(e.at).some((slot) => [...line].slice(SLOT_START[slot], SLOT_START[slot]! + chars.length).join("") === e.w);
            check(found, `${e.w}: 用例「${line}」の該当の位置に語がない`);
          }
          if (prev !== null) check(prev.n > e.n || (prev.n === e.n && prev.w < e.w), `${prev.w} → ${e.w}: 並び順`);
          prev = e;
        }
      }
    }
    expect(errors).toEqual([]);
    expect([n2, n3]).toEqual([index.counts["2"], index.counts["3"]]);
  }, 60_000);

  it("平仄パターンの探索用の索引（search/）は、詩語頻度表と過不足なく一致する", () => {
    const search: { slots: string[]; files: Record<string, number> } = read("search/index.json");
    expect(search.slots).toEqual(index.slots);
    const code: Record<string, string> = { 平: "h", 仄: "z", "？": "q" };
    const rhymeList = (JSON.parse(readFileSync(new URL("../data/rhymes.json", import.meta.url), "utf-8")) as { id: string }[]).map((r) => r.id);
    // 頻度表から期待する行を作る
    const expected = new Map<string, string[]>();
    for (const info of Object.values(index.chars)) {
      const groups: Record<"2" | "3", Entry[]> = read(info.file);
      for (const size of ["2", "3"] as const)
        for (const e of groups[size]) {
          const row = JSON.stringify([e.w, e.n, e.r.map((r) => rhymeList.indexOf(r)), index.slots.map((s) => e.at[s] ?? 0)]);
          for (const p of e.p) {
            const name = `${size}-${[...p].map((c) => code[c]).join("")}`;
            if (!expected.has(name)) expected.set(name, []);
            expected.get(name)!.push(row);
          }
        }
    }
    expect(Object.keys(search.files).sort()).toEqual([...expected.keys()].sort());
    expect(readdirSync(new URL("search/", dir)).filter((f) => f !== "index.json").sort()).toEqual([...expected.keys()].map((k) => `${k}.json`).sort());
    for (const [name, rows] of expected) {
      const actual: unknown[] = read(`search/${name}.json`);
      expect(actual.length, name).toBe(search.files[name]);
      expect(actual.map((r) => JSON.stringify(r)).sort(), name).toEqual([...rows].sort());
      // 出現回数の多い順
      const counts = actual.map((r) => (r as [string, number])[1]);
      expect(counts.every((n, k) => k === 0 || counts[k - 1]! >= n), name).toBe(true);
    }
  }, 60_000);
});
