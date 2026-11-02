// 定型（data/forms.json）と規則（data/rules.json）の検査（CLAUDE.md §4.1）。`npm test` で走る。
// 定型は記憶ではなく、照合元の記事（data/raw/ に版を固定して保存）の本文から組み立てて確かめる。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf-8");

type FormLine = { pattern: string; base: string };
type Form = { id: string; name: string; rhymeLines: number[]; lines: FormLine[] };
const formsDoc: { source: { references: { raw: string }[] }; forms: Form[] } = JSON.parse(read("data/forms.json"));
const rulesDoc: { rules: Record<string, { name: string; severity: string; basis: string }> } = JSON.parse(
  read("data/rules.json"),
);
const ja = read("data/raw/wikipedia-ja-kintaishi-96547510.wiki");
const zh = read("data/raw/wikipedia-zh-kintaishi-92701000.wiki");

const P = "○";
const Z = "●";
const flip = (c: string) => (c === P ? Z : P);
const toPZ = (s: string) => [...s].map((c) => (c === "平" || c === "○" || c === "◎" ? P : Z)).join("");

/** ja「七言句の例」の4つの律句（例: "* ○○｜●●｜●○◎"）。◎は平として読む。 */
function jaSevenCharLines(): string[] {
  const start = ja.indexOf("'''七言句の例'''");
  expect(start, "ja に「七言句の例」がない").toBeGreaterThan(0);
  const lines = ja.slice(start).split("\n").slice(1, 5);
  return lines.map((l) => {
    expect(l.startsWith("* "), l).toBe(true);
    return toPZ(l.slice(2).replaceAll("｜", ""));
  });
}

/** zh「七言近體詩則有「…」、「…」…等四種基本句式」の4句式。 */
function zhSevenCharLines(): string[] {
  const m = /七言近體詩則有((?:「[平仄]{7}」、?)+)等四種基本句式/.exec(zh);
  expect(m, "zh に七言の4基本句式がない").not.toBeNull();
  return [...m![1]!.matchAll(/「([平仄]{7})」/g)].map((x) => toPZ(x[1]!));
}

/** zh の「七言絕句仄起格，首句入韻」の譜。 */
function zhSokkiNyuinExample(): string[] {
  const start = zh.indexOf("「七言絕句仄起格，首句入韻」格式如下");
  expect(start, "zh に七言絶句仄起格首句入韻の譜がない").toBeGreaterThan(0);
  return [...zh.slice(start).matchAll(/^([平仄]{7})[，。]$/gm)].slice(0, 4).map((x) => toPZ(x[1]!));
}

/**
 * zh の組み立て方で4句を作る:
 * - 首句の2字目で平起・仄起が決まる。首句は入韻なら末字が平、不入韻なら仄
 * - 聯の2句は平仄が相対する（2字目が逆）。前の聯の対句と次の聯の出句は相黏（2字目が同じ）
 * - 偶数句は押韻するので末字は平、押韻しない奇数句は末字が仄
 * 律句は (2字目, 末字) の組で一つに決まる。
 */
function derive(basics: string[], heiki: boolean, nyuin: boolean): string[] {
  const pick = (second: string, last: string) => {
    const found = basics.filter((b) => b[1] === second && b[6] === last);
    expect(found, `2字目${second}・末字${last}の律句`).toHaveLength(1);
    return found[0]!;
  };
  const l0 = pick(heiki ? P : Z, nyuin ? P : Z);
  const l1 = pick(flip(l0[1]!), P);
  const l2 = pick(l1[1]!, Z);
  const l3 = pick(flip(l2[1]!), P);
  return [l0, l1, l2, l3];
}

const FORM_KEYS: Record<string, [boolean, boolean]> = {
  "heiki-nyuin": [true, true],
  "heiki-funyuin": [true, false],
  "sokki-nyuin": [false, true],
  "sokki-funyuin": [false, false],
};

describe("forms.json（定型）", () => {
  it("照合元の記事が data/raw/ にあり、ja と zh の七言の律句4種が一致する", () => {
    for (const ref of formsDoc.source.references) expect(() => read(ref.raw)).not.toThrow();
    expect(new Set(jaSevenCharLines())).toEqual(new Set(zhSevenCharLines()));
  });

  it("4定型がそろっている", () => {
    expect(formsDoc.forms.map((f) => f.id).sort()).toEqual(Object.keys(FORM_KEYS).sort());
  });

  for (const form of formsDoc.forms) {
    describe(form.name, () => {
      const [heiki, nyuin] = FORM_KEYS[form.id]!;
      const derived = derive(zhSevenCharLines(), heiki, nyuin);

      it("base は資料の組み立て方で作った4句と一致する", () => {
        expect(form.lines.map((l) => l.base)).toEqual(derived);
      });

      it("pattern の○●◎は base と一致し、◎は押韻する句の末字だけにある", () => {
        expect(form.rhymeLines).toEqual(nyuin ? [0, 1, 3] : [1, 3]);
        form.lines.forEach((line, i) => {
          expect([...line.pattern]).toHaveLength(7);
          [...line.pattern].forEach((sym, pos) => {
            if (sym === "◐") return;
            const expected = sym === "◎" ? P : sym;
            expect(expected, `${i + 1}句${pos + 1}字`).toBe(line.base[pos]);
            expect(sym === "◎", `${i + 1}句${pos + 1}字の◎`).toBe(pos === 6 && form.rhymeLines.includes(i));
          });
        });
      });

      it("◐は1・3・5字目だけで、5字目は変えると下三連になる句でだけ固定されている（ja「一三五不論」）", () => {
        form.lines.forEach((line, i) => {
          const free = [...line.pattern].flatMap((s, pos) => (s === "◐" ? [pos] : []));
          const flipped5 = line.base.slice(0, 4) + flip(line.base[4]!) + line.base.slice(5);
          const sanren = new Set(flipped5.slice(4)).size === 1;
          expect(free, `${i + 1}句`).toEqual(sanren ? [0, 2] : [0, 2, 4]);
        });
      });
    });
  }

  it("zh の「七言絶句仄起格，首句入韻」の譜は sokki-nyuin の base と一致する", () => {
    const form = formsDoc.forms.find((f) => f.id === "sokki-nyuin")!;
    expect(zhSokkiNyuinExample()).toEqual(form.lines.map((l) => l.base));
  });
});

describe("rules.json（規則）", () => {
  const SEVERITY: Record<string, string> = { 違反: "violation", 要確認: "check", 許容される変格: "variant" };
  // CLAUDE.md §4.1 の規則表から、規則IDと既定の重みを読む
  const spec = read("CLAUDE.md");
  const table = [...spec.matchAll(/^\| `([a-z-]+)` \| .+ \| ([^|]+) \|$/gm)].map((m) => {
    const label = Object.keys(SEVERITY).find((k) => m[2]!.trim().startsWith(k));
    return { id: m[1]!, severity: label ? SEVERITY[label] : undefined };
  });
  // 表にない規則：◐の位置の揺れ（CLAUDE.md §4.1「許容される変格は、◐の位置での揺れのうち規則上認められているもの」）
  const EXTRA = ["ichisango-furon"];

  it("CLAUDE.md §4.1 の表の規則がすべてあり、既定の重みが表と同じ", () => {
    expect(table.length).toBeGreaterThanOrEqual(18);
    for (const { id, severity } of table) {
      expect(rulesDoc.rules[id], `rules.json に ${id} がない`).toBeDefined();
      expect(rulesDoc.rules[id]!.severity, id).toBe(severity);
    }
  });

  it("表にない規則は決められたものだけで、どの規則にも名前と根拠がある", () => {
    const ids = new Set(table.map((t) => t.id));
    expect(Object.keys(rulesDoc.rules).filter((id) => !ids.has(id))).toEqual(EXTRA);
    expect(rulesDoc.rules["ichisango-furon"]!.severity).toBe("variant");
    for (const [id, r] of Object.entries(rulesDoc.rules)) {
      expect(r.name.length, id).toBeGreaterThan(0);
      expect(r.basis.length, id).toBeGreaterThan(0);
      expect(["ok", "variant", "check", "violation"], id).toContain(r.severity);
    }
  });
});
