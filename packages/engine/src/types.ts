// 規則エンジンの公開型（CLAUDE.md §4.1「型（目安）」をもとにする）。

export type Tone = "平" | "上" | "去" | "入";
export type PZ = "平" | "仄";

/** 字の読み。via は、異体字の対応で別の字として引いたときの、その字。 */
export type Reading = { tone: Tone; rhyme: string; note?: string; via?: string };

/**
 * known        平仄データにある字（異体字の対応で一つの字に決まる場合を含む）
 * undetermined 異体字の対応で候補が複数あり、どの字か一つに決まらない
 * unknown      平仄データにも異体字の対応にもない
 * kokuji       国字
 * blank        未入力のマス（「＿」）
 * invalid      漢字以外の文字
 */
export type CharStatus = "known" | "undetermined" | "unknown" | "kokuji" | "blank" | "invalid";

export type CharInfo = {
  char: string;
  /** 入力された文字がこの字と違うとき（「々」など）の、入力どおりの文字 */
  input?: string;
  status: CharStatus;
  readings: Reading[];
};

export type Severity = "ok" | "variant" | "check" | "violation";

export type Finding = {
  rule: string;
  severity: Severity;
  /** 0始まり。句に結び付かない指摘（句数など）は -1 */
  line: number;
  /** 0始まり */
  positions: number[];
  /** 利用者向けの日本語 */
  message: string;
  /** 読みによって結果が変わる指摘で、どの読みでの結果か（キーは 句×7＋位置） */
  interpretation?: Record<number, Reading>;
};

export type InputError = { line: number; position: number; char: string; message: string };

export type FormId = "heiki-nyuin" | "heiki-funyuin" | "sokki-nyuin" | "sokki-funyuin";

export type FormResult = {
  /** 判定に使った詩格。決まらないときは null（定型に依存する規則は判定しない） */
  id: FormId | null;
  /** true なら自動判定、false なら利用者が固定した */
  auto: boolean;
  /** 自動判定の補足（未入力のため推定した、など） */
  note?: string;
};

export type Interpretation = {
  /** この解釈で選んだ読み（読みが複数ある位置だけ。キーは 句×7＋位置） */
  readings: Record<number, Reading>;
  form: FormResult;
  findings: Finding[];
};

export type Analysis = {
  /** すべての解釈で同じ詩格ならそれ。解釈によって違えば、最初の解釈の詩格に note を付けて返す */
  form: FormResult;
  chars: CharInfo[][];
  /** misima 互換の記号列（句ごと）。○平 ●仄 ◎平仄両方の読み □平仄データにない ■国字 ＿未入力 ×漢字以外 */
  symbols: string[];
  /** すべての解釈に共通する指摘と、読みに依存しない指摘 */
  findings: Finding[];
  /** 読みの組み合わせごとの結果。読みが一つに決まる詩では1件 */
  interpretations: Interpretation[];
  /** 組み合わせが多すぎて、位置ごとに独立して評価したとき true（CLAUDE.md §4.1） */
  independent: boolean;
  errors: InputError[];
};

// ---- データ（data/ の JSON をそのまま渡す） ----

export type FormLine = { pattern: string; base: string };
export type FormDef = { id: FormId; name: string; rhymeLines: number[]; lines: FormLine[] };
export type RuleDef = { name: string; severity: Severity; basis: string };

export type EngineData = {
  chars: Record<string, { tone: Tone; rhyme: string; note?: string }[]>;
  variants: Record<string, string[]>;
  kokuji: { chars: { char: string; note?: string }[] };
  forms: { forms: FormDef[] };
  rules: { rules: Record<string, RuleDef> };
};

export type Options = {
  /** 詩格を固定する。省略すると自動判定 */
  form?: FormId;
  /** 平仄データにない字を、この平仄として扱う */
  unknownAs?: PZ;
  /** 国字を違反ではなく要確認として続行する */
  allowKokuji?: boolean;
  /** 規則ごとの重みの上書き（流派差に合わせる） */
  severities?: Partial<Record<string, Severity>>;
};
