// 七言絶句の規則エンジン（CLAUDE.md §4.1）。
// 純関数のみで構成し、外部依存を持たない。データ（data/ の JSON）は引数で受け取る。
export { analyze, MAX_COMBINATIONS } from "./analyze";
export { constraintsAt, placementsFor, searchPhrases } from "./queries";
export type * from "./types";
