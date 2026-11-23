# pi-cc-style

pi の見た目と UI の挙動を Claude Code 2.1.330 に合わせる pi 拡張です。システムプロンプトとツールの中身は pi のまま、画面に出るものと操作を Claude Code の実装に合わせます。

```
 ▐▛███▛█   Pi v1.5.2
▝▜██████▀  Opus 5.5 with high effort · claude-bridge
 ▝▝   ▝▝   ~/work/project

❯ Find where sessions are validated and fix the expiry check

∴ The user wants the expiry check fixed. Look at the session module first.

⏺ I'll look at the session module first.

⏺ Searched for 2 patterns, read 1 file (ctrl+o to expand)

⏺ Update(src/session.ts)
  ⎿  Added 1 line, removed 1 line
      11  export function isExpired(session: Session): boolean {
      12 -  return session.expiresAt < Date.now() / 1000;
      12 +  return session.expiresAt * 1000 <= Date.now();
      13  }

✽ Pondering… (13s · ↓ 1.2k tokens)
────────────────────────────────────────────────────────────────────
❯ Try "how does session.ts work?"
────────────────────────────────────────────────────────────────────
  ? for shortcuts
```

参照元は手元の公式バイナリ（`~/.local/share/claude/versions/2.1.330`）に埋め込まれた JS です。Claude Code のコードは同梱せず、文言・記号・色・タイミングを読み取って独立に実装しています。対応関係は [docs/claude-code-reference.md](docs/claude-code-reference.md) にあります。

## 再現している要素

| 要素 | 内容 |
|---|---|
| テーマ | Claude Code の6テーマ（`claude-code-dark` / `-light` / `-dark-ansi` / `-light-ansi` / `-dark-daltonized` / `-light-daltonized`）。色表は本体の値そのまま。構文色は本体の diff と同じ Monokai Extended（dark）/ GitHub（light） |
| 起動ヘッダー | Clawd（3行のブロック文字）と、名前・バージョン、モデル・effort・プロバイダー、作業ディレクトリの3行 |
| ユーザー入力 | `❯ ` を `inactive` 色で前に置き、`userMessageBackground` の帯で表示。折り返しは本文の位置にそろえる |
| 応答 | 応答の最初の本文の前に `⏺`（macOS 以外は `●`）。本文は2列字下げの Markdown |
| thinking | `∴` と、空白をまとめた thinking を薄い斜体で表示 |
| ツール行 | `⏺ Read(path)`。点は待機中は薄く、実行中は 600ms ごとに点滅、終了で success / error。結果は `  ⎿  ` の下に出す |
| ツールの要約 | `Read N lines`、`Found N lines` / `files`、`Wrote N lines to path` とプレビュー10行、`Added N lines, removed M lines` と diff、Bash の出力は幅-10で折り返して先頭3行と `… +N lines (ctrl+o to expand)` |
| まとめ表示 | 連続した read / grep / find / ls（2件以上）を `Searched for N patterns, read N files (ctrl+o to expand)` の1行にまとめる。ctrl+o で個別表示 |
| diff | 行番号のガター、追加・削除行の背景、変更が4割以下の組は変わった語だけ強調、長い行は折り返し |
| スピナー | `· ✢ ✳ ✶ ✻ ✽` を2秒周期で往復、動詞185語から1つ、3文字のきらめき、10秒無応答で error 色へ、thinking が長いと warning 色へ。括弧内は経過時間・`↓ N tokens`・thinking の状態（`still thinking`、`thought for Ns` など）を幅に収まる分だけ |
| ターン終了 | `✻ Cooked for 1m 5s`（動詞8語からメッセージごとに決まる） |
| 中断・エラー | `  ⎿  Interrupted · What should Claude do instead?`、API エラーは warning 色の `⏺` 行 |
| 入力欄 | 上下だけの罫線（`promptBorder`、`!` で始まると `bashBorder`）、`❯` の前置き、セッションが空のあいだの `Try "…"` |
| 入力欄の下 | `? for shortcuts` / `esc to interrupt`、権限モードと `shift+tab to cycle` |
| `!` コマンド | `! cmd` の帯と、`⎿` の下に3行までの出力 |
| compaction | `⏺ Compact summary (ctrl+o to expand)`、展開で要約 |
| 権限モード | shift+tab で manual → accept edits → plan → bypass permissions を切り替え。bash / edit / write の前に Claude Code の確認ダイアログを出す |

サブエージェントの行（`Running N Explore agents…` と `├` / `└` の枝）は [pi-cc-subagent](https://github.com/uta-a/pi-cc-subagent) が描きます。同時に使うと両方がそろいます。

## 導入

```bash
pi install git:github.com/uta-a/pi-cc-style
```

better-claude-code-ui とは同じ部分（ヘッダー、入力欄、スピナー、ツール行、テーマ名）を描くため、併用できません。導入するときは `settings.json` の `packages` から `npm:better-claude-code-ui` を外してください。テーマ名は同じ `claude-code-dark` などなので、`"theme"` の設定はそのまま使えます。

起動時の組み込みヘッダーと読み込み一覧は `"quietStartup": true` で消えます。

一度だけ試す場合:

```bash
pi -e ./   # このディレクトリで
```

API を使わずに見た目を確かめる場合は、作業用のディレクトリで台本どおりに答えるデモモデルを使います（`demo.ts` と `notes.md` を書き換えます）。

```bash
pi -ne -e /path/to/pi-cc-style -e /path/to/pi-cc-style/test/demo-provider.ts --provider demo --model demo-1 --no-session
```

## 権限モード

pi は何も確認せずにツールを実行します。これは Claude Code の bypassPermissions と同じなので、初期値は bypass permissions です。導入しただけでは動作は変わりません。

| モード | 確認するもの |
|---|---|
| manual | bash、edit、write |
| accept edits | bash |
| plan | bash、edit、write |
| bypass permissions | なし |

- 入力欄にフォーカスがあるとき、shift+tab で順に切り替えます。`/cc-mode <mode>` でも指定できます（`manual` は `default` の別名）。Claude Code と同じく、bypass permissions が循環に入るのは、起動時のモードが bypass permissions だった場合と `/cc-mode bypassPermissions` で選んだ場合だけです。pi の shift+tab（thinking レベルの切り替え）はこの拡張が受け取ります。thinking レベルを shift+tab で変えたい場合は `"modeCycle": false` にしてください
- 確認ダイアログ: `1` / `2` / `3` か ↑↓ と Enter。ダイアログが開いてから 300ms のあいだのキーは無視します（入力中の Enter で承認されないように）。`3` か Esc で拒否すると、Claude Code と同じ文面（止まってユーザーの指示を待つよう求めるもの）をツールの結果としてモデルに返し、ターンの終了を要求します。同じ応答に含まれる残りのツール呼び出しも、確認せずに拒否します。Tab で理由を書き添えられます
- `2` は、edit / write なら accept edits に切り替えます（ダイアログ内の shift+tab も同じ）。bash なら、そのコマンドのプレフィックスを、そのセッション・その作業ディレクトリに限って許可します
  - プレフィックスはプログラム名です。git、npm、cargo、docker などサブコマンドを持つものは `git status` のように2語で、`git push` は別に確認します
  - 次のコマンドには `2` を出しません（常に確認します）: `;` `&` `|` `<` `>` バッククォート `$(` 改行を含むもの、先頭に `VAR=1` があるもの、`env` / `sh` / `bash` / `eval` / `xargs` / `sudo` / `find` / `sed` / `awk` / `node` / `python` などほかのプログラムやコードを実行できるもの、サブコマンドの前にフラグがあるもの（`git -c …`）
  - それでも許可は文字列の前方一致です。`npm run` を許可すると package.json のどのスクリプトも実行されます。安全性の判断には使わず、手間を減らすためのものと考えてください
- accept edits で確認なしになるのは、作業ディレクトリの中のファイルだけです。外側のファイルと `.git/` の中は確認します。パスは pi と同じく `~` と先頭の `@` を展開して判定します（シンボリックリンクの先は見ません）
- plan モードは確認の対象だけを切り替えます。Claude Code の plan モードが持つ「計画だけを立てる」指示はシステムプロンプトの機能なので含めていません
- 確認の対象は bash、powershell、edit、write です。read / grep / find / ls、MCP のツール、サブエージェントを起動するツール、他の拡張のツールは確認しません
- サブエージェント（pi-cc-subagent）や codemode のスクリプトがツールの中から呼んだ bash / edit / write も、同じ規則で確認します。このときダイアログに「Requested by a subagent or another tool」と出ます。バックグラウンドのサブエージェントの確認は、入力中でも割り込んで開きます
- RPC など TUI 以外のモードでは、選択肢を pi の select で尋ねます。UI のない print モードでは、確認が必要な呼び出しはすべて拒否します
- 承認した後に、別の拡張の `tool_call` ハンドラが引数を書き換えた場合は検知しません

## 設定

`settings.json` の `ccStyle` で切り替えます。不正な値は初期値に戻ります。

```json
{
  "ccStyle": {
    "headerTitle": "Pi",
    "header": true,
    "spinner": true,
    "turnDuration": true,
    "prompt": true,
    "tools": true,
    "messages": true,
    "modeCycle": true,
    "permissionMode": "bypassPermissions"
  }
}
```

| キー | 内容 |
|---|---|
| `headerTitle` | ヘッダーの名前。`"Claude Code"` にもできる（バージョンは pi のもの） |
| `header` / `spinner` / `turnDuration` / `prompt` / `tools` / `messages` | 各要素の置き換えを個別に止める |
| `modeCycle` | shift+tab で権限モードを切り替える。`false` にすると shift+tab は pi の thinking レベル切り替えに戻る |
| `permissionMode` | 起動時の権限モード（`default`（`manual` も可）/ `acceptEdits` / `plan` / `bypassPermissions`）。認識できない値は `default` になり、起動時に警告します |

## pi 内部への変更

公式 API で足りない箇所は、pi が公開しているクラスのプロトタイプを包んで置き換えます。どれも設定で止めると元の処理に戻ります。

| 対象 | 理由 |
|---|---|
| `AssistantMessageComponent.prototype.updateContent` | `⏺` と2列の字下げ、`∴` の thinking、中断・エラー行 |
| `UserMessageComponent.prototype.render` | `❯` と背景の帯 |
| `BashExecutionComponent.prototype.render` | `!` コマンドの表示 |
| `CompactionSummaryMessageComponent.prototype.render` | compaction の表示 |
| `InteractiveMode.prototype.showStatus` | ctrl+o の `Tool output: expanded` 通知を出さない（Claude Code は通知しない） |

ほかは公式 API です: テーマ（`pi.themes`）、ヘッダー（`setHeader`）、ツール行（`registerToolRenderer`、`renderShell: "self"`）、スピナーと入力欄下の行（`setWidget`、`setWorkingVisible(false)`）、入力欄（`setEditorComponent`。前のエディタを包むので pi-cc-subagent の操作も残る）、ターン終了（`appendEntry` と `registerEntryRenderer`）、権限（`tool_call` と `ctx.ui.custom`）、shift+tab（`onTerminalInput`）。

## Claude Code と違うところ

- ヘッダーの名前は初期値 `Pi`、バージョンは pi のもの。2行目の右側は課金種別ではなくプロバイダー名
- スピナーの30秒後の Tips、`?` で開くショートカット一覧、全画面モード（スクロール・クリック展開）はない
- thinking と編集・Bash までを1行にまとめる要約行（`Thought for 5s, read 3 files, …`）は再現していない。まとめるのは連続した read / grep / find / ls だけ
- トークン数は応答の文字数÷4（Claude Code と同じ近似）。数え上げのアニメーションはしない
- compaction・再試行中の表示は pi のもの
- ステータスラインは pi-cc-statusline、TODO は pi-claude-todo が担当する
- 別プロセスとして起動されたサブエージェント（`PI_SUBAGENT_CHILD` / `PI_SUBAGENT_PARENT_SESSION` が付くもの）の中では何もしない。そのプロセスの bash / edit / write は確認されない

## 開発

```bash
npm install
npm test               # node --test（Node 22.6+ の型ストリップで実行）
npm run typecheck
npm run preview        # 各要素を端末に描く（--light、--plain）
node test/gen-themes.ts  # theme/ を色表から作り直す
```
