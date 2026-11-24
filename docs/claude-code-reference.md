# Claude Code 2.1.330 との対応

## 参照元

- 公式バイナリ: `~/.local/share/claude/versions/2.1.330`（Mach-O arm64、Bun compiled、363,855,808 B）
- SHA-256: `f7c5093b9dd6560d08af28bc27b123fb55091deae3180ac39df199522da86815`
- 埋め込み値: BUILD_TIME `2026-11-20T17:34:37Z`、GIT_SHA `8c664bec500172ded713624f9ecac0eb7e714829`
- 読んだもの: バイナリに埋め込まれた `/$bunfs/root/chunk-*.js`（minify 済み）。バイナリは起動していません

バイナリやその JS は同梱していません。文言・記号・色の値・タイミングを読み取り、pi の拡張 API の上に独立に実装しています。minify 後の識別子はチャンクごとに付け直されたもので、バージョンごとに変わります。

## 要素ごとの対応

| 要素 | 2.1.330 の識別子 | 読み取った仕様 | 実装 |
|---|---|---|---|
| 色表 | `w` `x` `W` `I` `D` `P`（テーマ名で選択） | 6テーマ×72キー | `extension/palette-data.ts`、`extension/themes.ts` |
| 記号 | `Fc` `SD` `Lut` `JKn` `HJe` `Ngn` `eC` `xe` | ⏺/● ✻ ⎿ ∴ ⏸ ⏵⏵ ├└│ ❯ | `extension/format.ts` |
| 時間・数値 | `Cn` `Ec` `go` `$y` | `1m 5s`、`1.2k`、`… +N lines` | `extension/format.ts` |
| ヘッダー | `N5t` `l_e` `J` `K` `M` | Clawd の default ポーズ、3行、`with <effort> effort` | `extension/header.ts` |
| ユーザー入力 | `vm` | `❯` inactive、`userMessageBackground` | `extension/messages.ts` |
| 応答 | `ef` `ki` | 最初の本文だけ `⏺`、2列の字下げ | `extension/messages.ts` |
| thinking | `Ur` | `∴` dim、空白をまとめた本文を dim・italic | `extension/messages.ts` |
| 中断 | `YS` `Rd` | `  ⎿  Interrupted · What should Claude do instead?` | `extension/messages.ts` |
| API エラー | `Xg` | warning 色の `⏺` 行 | `extension/messages.ts` |
| ツール行の点 | `Ote` | 600ms の点滅、dim / success / error | `extension/tools.ts` |
| 結果行 | `Wn` `At` | `  ⎿ ` + NBSP、続く行は5列 | `extension/messages.ts`（`resultRows`） |
| Read / Write / Edit / Search | 各ツールの `renderToolResultMessage` | `Read N lines`、`Wrote N lines to path`、`Added N lines, removed M lines`、`Found N files` | `extension/tools.ts` |
| Bash の出力 | `Lyi` `nW` | 幅-10で折り返し、3行（残り1行なら4行）、`(No output)` | `extension/tools.ts`（`truncatedOutput`） |
| まとめ表示 | `collapsed_read_search` → `oc` / `Ey`、`oo`、`R9e`（集計） | 1件からまとめる、終了後は点なしで dim、件数 bold、read は `readFilePaths.size`、進行中は `-ing` と `…` と直近の対象（`latestDisplayHint`） | `extension/grouping.ts` |
| diff | color-diff（`ee` `Te` `We` `_e` `ue` `He` `Pe`） | ガター ` N `、記号、行背景、語の強調（0.4 以下）、幅 `columns-12`、Monokai Extended / GitHub | `extension/diff.ts` |
| スピナー（thinking の effort） | `lcn` | `thinking with high effort`、幅が足りなければ `thinking` | `extension/spinner.ts` |
| スピナー | `Iya` `De` `Omt` `i7n` `On` `Ln` `Oya` `$n` `tt` `Wse` `PIt` | 本文冒頭の説明のとおり | `extension/spinner.ts` |
| 動詞 | `b`（187語）、`jy`（8語）、`Wy`、`fse` | 一覧とハッシュによる選び方 | `extension/format.ts` |
| ターン終了 | `iM` `lM` `VMn` | `✻ <Verb> for <time> · done <時刻>`、行全体 dim、完了したターンだけ。時刻の書式（ロケール、曜日・日付の付け方）は本体の関数を特定できておらず、近い関数の `hour: "numeric", minute: "2-digit"` に合わせた推定 | `extension/turn.ts` |
| 入力欄 | `jpt` `pbn` `zwa` | 上下だけの round 罫線、`❯`+NBSP、`Try "…"` | `extension/editor.ts` |
| 入力欄の下 | `ylt` `yD` `Uut` `YC` `Dr`（全画面版は `jRe` `eH`） | inline 版: `⏵⏵ accept edits on` をモードの色、dim の ` (shift+tab to cycle)`、`esc to interrupt`、`? for shortcuts` | `extension/turn.ts`（`renderPromptFooter`） |
| 権限モード | `Dr` `Tr` | manual / accept edits / plan / bypass permissions | `extension/permissions.ts` |
| 確認ダイアログ | `tl` `Ate` `ct` `n8n` `$t` `hp` `r8i` | タイトル、`Do you want to proceed?`、3択の文言（cwd は `~` に置き換えず絶対パスで表示）、拒否時の文面 | `extension/permissions.ts` |
| compaction | `s7n` ほか | `⏺ Compact summary (ctrl+o to expand)` | `extension/messages.ts` |

## pi への適応

- 色は pi のテーマトークンでは表せないキー（claude、claudeShimmer、promptBorder など）があるため、拡張が色表を持ち、pi のテーマ名から6種類のどれかを選びます。pi の部品（Markdown、選択リスト）は同梱テーマで色を合わせます
- 余白: Claude Code は1列目から描くので、pi の `outputPad` に関係なく1列目から描きます
- スピナーは pi の作業インジケーターを隠し（`setWorkingVisible(false)`）、入力欄の上のウィジェットとして 50ms ごとに描き直します
- 応答の文字数は pi のストリーミングイベントの delta から数えます
- 権限は pi の `tool_call` で止めます。pi に権限の概念がないため、初期値は bypass permissions です

## 再確認の方法

```bash
shasum -a 256 ~/.local/share/claude/versions/2.1.330
# 生の UTF-8 ではなく ⏺ のようなエスケープで書かれている
LC_ALL=C grep -a -b -o -F 'thinking some more' ~/.local/share/claude/versions/2.1.330
```
