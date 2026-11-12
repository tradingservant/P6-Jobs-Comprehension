const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const Marking = require(path.join(root, "js/marking.js"));
const Passages = require(path.join(root, "js/passages.js"));

const EXERCISES_HASH = "97ca5c304d440a3a0b4b7f5ac12eaa27ce5e0ee7b7791e225814435616657b4e";
const PASSAGES_HASH = "6cbdd07a77b609eff1d8c11222cc590e946819cdbf7c290b22d19a5aa042d383";
const SCORED_IDS = ["Q01", "Q02", "Q03", "Q04", "Q05", "Q06a", "Q06b"];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath));
}

function loadPack() {
  return JSON.parse(read("data/exercises.json").toString("utf8"));
}

function itemById(pack, id) {
  for (const station of pack.stations) {
    const found = station.items.find((item) => item.id === id);
    if (found) return found;
  }
  return null;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function numberedPassageLines(markdown) {
  const map = new Map();
  const pattern = /^\*\*\(line (\d+)\)\*\*\s*(.*)$/gm;
  let match;
  while ((match = pattern.exec(markdown))) {
    map.set(Number(match[1]), match[2].trim());
  }
  return map;
}

test("exercises.json and passages.md stay byte-identical", () => {
  assert.equal(sha256(read("data/exercises.json")), EXERCISES_HASH);
  assert.equal(sha256(read("data/passages.md")), PASSAGES_HASH);
});

test("the pack scores exactly the seven required items and not the Q06 group", () => {
  const pack = loadPack();
  const station = pack.stations[0];
  const group = itemById(pack, "Q06");
  assert.equal(pack.stations.length, 1);
  assert.equal(station.id, "bright-days");
  assert.deepEqual(pack.meta.scored_item_ids, SCORED_IDS);
  assert.equal(pack.meta.total_scored_items, 7);
  assert.equal(group.scored, false);
  assert.equal(group.marks, 0);
  assert.equal(group.type, "note_display_group");
  assert.equal(Marking.isScoredItem(group), false);
  const scored = Marking.scoredItems(pack);
  assert.deepEqual(
    scored.map((item) => item.id),
    SCORED_IDS
  );
  assert.equal(scored.length, 7);
  assert.ok(scored.every((item) => item.teacher_review !== true && item.marks === 1));
  const score = Marking.scoreStation(station.items, {});
  assert.deepEqual(score.ids, SCORED_IDS);
  assert.equal(score.total, 7);
  assert.equal(score.count, 7);
  assert.equal(score.earned, 0);
  const withGroup = Marking.scoreStation(station.items.concat([group]), {
    Q06: { outcome: "first_correct" },
    Q01: { outcome: "first_correct" },
  });
  assert.deepEqual(withGroup.ids, SCORED_IDS);
  assert.equal(withGroup.total, 7);
  assert.equal(withGroup.earned, 1);
  const screens = Marking.buildScreens(station);
  const ids = screens.flatMap((screen) => screen.ids);
  assert.equal(ids.includes("Q06"), false);
  const gaps = screens.find((screen) => screen.kind === "gaps");
  assert.deepEqual(gaps.ids, ["Q06a", "Q06b"]);
  assert.equal(gaps.noteId, "Q06");
  assert.equal(screens[screens.length - 1].kind, "review");
  assert.deepEqual(screens[screens.length - 1].ids, SCORED_IDS);
  assert.equal(
    screens.filter((screen) => screen.kind !== "review").length,
    6
  );
});

test("question keys match the pack, including Q03 sense 4", () => {
  const pack = loadPack();
  assert.deepEqual(itemById(pack, "Q01").accepted, ["C"]);
  assert.equal(itemById(pack, "Q01").type, "mcq_combination");
  assert.equal(itemById(pack, "Q01").statements.length, 4);
  assert.equal(Marking.markItem(itemById(pack, "Q01"), "C").correct, true);
  assert.equal(Marking.markItem(itemById(pack, "Q01"), "A").correct, false);
  assert.equal(Marking.markItem(itemById(pack, "Q01"), "c").correct, false);
  assert.equal(Marking.markItem(itemById(pack, "Q02"), "B").correct, true);
  assert.equal(Marking.markItem(itemById(pack, "Q02"), "D").correct, false);
  const q03 = itemById(pack, "Q03");
  assert.equal(q03.type, "dictionary_sense");
  assert.deepEqual(q03.accepted, ["D"]);
  assert.equal(q03.glossary.length, 4);
  assert.deepEqual(
    q03.glossary.map((sense) => sense.sense),
    [1, 2, 3, 4]
  );
  assert.equal(q03.glossary[3].pos, "v");
  assert.equal(Marking.markItem(q03, "D").correct, true);
  assert.equal(Marking.markItem(q03, "A").correct, false);
  assert.equal(Marking.markItem(itemById(pack, "Q04"), "B").correct, true);
  assert.equal(Marking.markItem(itemById(pack, "Q05"), "C").correct, true);
  assert.equal(read("js/marking.js").toString("utf8").includes("source_key_letter"), false);
});

test("Q06 accepts only the banked keys, one word, once", () => {
  const pack = loadPack();
  const group = itemById(pack, "Q06");
  const first = itemById(pack, "Q06a");
  const second = itemById(pack, "Q06b");
  const bank = group.word_bank;
  assert.deepEqual(bank, ["patient", "creative", "outstanding", "interesting", "familiar"]);
  assert.deepEqual(first.accepted, ["creative", "Creative", "CREATIVE"]);
  assert.deepEqual(second.accepted, ["familiar", "Familiar", "FAMILIAR"]);

  for (const form of ["creative", "Creative", "CREATIVE", " creative ", " CrEaTiVe "]) {
    assert.equal(Marking.markGap(first, form, bank).correct, true, form);
  }
  for (const form of ["familiar", "Familiar", "FAMILIAR", " familiar "]) {
    assert.equal(Marking.markGap(second, form, bank).correct, true, form);
  }
  for (const rejected of ["interesting", "outstanding", "patient", "familiar", "creative ideas", "brave", "", "   "]) {
    assert.equal(Marking.markGap(first, rejected, bank).correct, false, rejected);
  }
  for (const rejected of ["patient", "interesting", "outstanding", "creative", "familiar with", "calm"]) {
    assert.equal(Marking.markGap(second, rejected, bank).correct, false, rejected);
  }

  const both = Marking.markGapGroup([first, second], { Q06a: " creative ", Q06b: "FAMILIAR" }, bank);
  assert.deepEqual(
    both.map((row) => row.correct),
    [true, true]
  );
  const duplicated = Marking.markGapGroup([first, second], { Q06a: "creative", Q06b: "creative" }, bank);
  assert.deepEqual(
    duplicated.map((row) => row.correct),
    [true, false]
  );
  const duplicatedKey = Marking.markGapGroup([first, second], { Q06a: "familiar", Q06b: "familiar" }, bank);
  assert.deepEqual(
    duplicatedKey.map((row) => row.correct),
    [false, false]
  );
  const traps = Marking.markGapGroup(
    [first, second],
    { Q06a: "interesting", Q06b: "patient" },
    bank
  );
  assert.deepEqual(
    traps.map((row) => row.correct),
    [false, false]
  );
});

test("first unhinted success, first-error hint, and hinted retry is not first_correct", () => {
  let attempt = Marking.applySubmission(null, true);
  assert.equal(attempt.outcome, "first_correct");
  assert.equal(attempt.hintShown, false);
  assert.equal(Marking.feedbackMode(attempt), "first_correct");

  attempt = Marking.applySubmission(null, false);
  assert.equal(attempt.outcome, null);
  assert.equal(attempt.hintShown, true);
  assert.equal(attempt.attempts, 1);
  assert.equal(Marking.feedbackMode(attempt), "hint");
  const pack = loadPack();
  assert.equal(Marking.hintText(itemById(pack, "Q01")), itemById(pack, "Q01").hints.first_error);
  assert.equal(Marking.hintText(itemById(pack, "Q01")).includes("The answer is"), false);

  attempt = Marking.applySubmission(attempt, true);
  assert.equal(attempt.outcome, "hinted_success");
  assert.notEqual(attempt.outcome, "first_correct");
  assert.equal(Marking.feedbackMode(attempt), "hinted_success");

  attempt = Marking.applySubmission(null, false);
  attempt = Marking.applySubmission(attempt, false);
  assert.equal(attempt.outcome, "incorrect");
  assert.equal(Marking.feedbackMode(attempt), "incorrect_after_retry");
  const frozen = Marking.applySubmission(attempt, true);
  assert.equal(frozen.outcome, "incorrect");
});

test("Q06 hints only the first incorrect blank, then records hinted_success", () => {
  const pack = loadPack();
  const first = itemById(pack, "Q06a");
  const second = itemById(pack, "Q06b");
  const bank = itemById(pack, "Q06").word_bank;
  const items = [first, second];

  let attempts = Marking.applyGapSubmission(
    {},
    Marking.markGapGroup(items, { Q06a: "creative", Q06b: "familiar" }, bank)
  );
  assert.equal(attempts.Q06a.outcome, "first_correct");
  assert.equal(attempts.Q06b.outcome, "first_correct");

  attempts = Marking.applyGapSubmission(
    {},
    Marking.markGapGroup(items, { Q06a: "outstanding", Q06b: "familiar" }, bank)
  );
  assert.equal(attempts.Q06a.hintShown, true);
  assert.equal(attempts.Q06a.outcome, null);
  assert.equal(Marking.feedbackMode(attempts.Q06a), "hint");
  assert.equal(attempts.Q06b.outcome, "first_correct");
  assert.equal(attempts.Q06b.hintShown, false);
  attempts = Marking.applyGapSubmission(
    attempts,
    Marking.markGapGroup(items, { Q06a: "creative", Q06b: "familiar" }, bank)
  );
  assert.equal(attempts.Q06a.outcome, "hinted_success");
  assert.notEqual(attempts.Q06a.outcome, "first_correct");
  assert.equal(attempts.Q06b.outcome, "first_correct");

  attempts = Marking.applyGapSubmission(
    {},
    Marking.markGapGroup(items, { Q06a: "interesting", Q06b: "patient" }, bank)
  );
  assert.equal(attempts.Q06a.hintShown, true);
  assert.equal(attempts.Q06a.outcome, null);
  assert.equal(attempts.Q06b.hintShown, false);
  assert.equal(attempts.Q06b.outcome, null);
  assert.equal(attempts.Q06b.wasWrong, true);
  assert.equal(Marking.feedbackMode(attempts.Q06b), "none");
  assert.equal(Marking.hintText(second), second.hints.first_error);
  attempts = Marking.applyGapSubmission(
    attempts,
    Marking.markGapGroup(items, { Q06a: "Creative", Q06b: "Familiar" }, bank)
  );
  assert.equal(attempts.Q06a.outcome, "hinted_success");
  assert.equal(attempts.Q06b.outcome, "hinted_success");
  assert.notEqual(attempts.Q06a.outcome, "first_correct");
  assert.notEqual(attempts.Q06b.outcome, "first_correct");

  attempts = Marking.applyGapSubmission(
    {},
    Marking.markGapGroup(items, { Q06a: "creative", Q06b: "outstanding" }, bank)
  );
  assert.equal(attempts.Q06a.outcome, "first_correct");
  assert.equal(Marking.feedbackMode(attempts.Q06b), "hint");
  attempts = Marking.applyGapSubmission(
    attempts,
    Marking.markGapGroup(items, { Q06a: "creative", Q06b: "patient" }, bank)
  );
  assert.equal(attempts.Q06b.outcome, "incorrect");
  assert.equal(Marking.feedbackMode(attempts.Q06b), "incorrect_after_retry");
  assert.equal(attempts.Q06a.outcome, "first_correct");
});

test("numbered passage lines stay plain and drop the teacher section", () => {
  const markdown = read("data/passages.md").toString("utf8");
  const parsed = Passages.parsePassages(markdown);
  const source = numberedPassageLines(markdown);
  assert.equal(parsed.lines.length, 24);
  assert.deepEqual(
    parsed.lines.map((line) => line.line),
    Array.from({ length: 24 }, (_, index) => index + 1)
  );
  for (const line of parsed.lines) {
    assert.equal(line.text, source.get(line.line));
  }
  const covered = [];
  for (const group of Passages.GROUPS) {
    for (let line = group.from; line <= group.to; line += 1) covered.push(line);
  }
  assert.deepEqual(covered, Array.from({ length: 24 }, (_, index) => index + 1));
  assert.equal(source.get(15), "• You need to be patient so that you can calm down scared animals.");
  assert.equal(source.get(17), "Cook’s Assistant at Rainbow Youth Centre");
  assert.match(source.get(23), /brightdays@joymail\.com/);
  assert.match(source.get(24), /2646 2642/);
  const pupilText = JSON.stringify(parsed);
  assert.equal(pupilText.includes("範例／教師用"), false);
  assert.equal(pupilText.includes("Teacher-only"), false);
  assert.equal(/\bhelper\b/i.test(pupilText), false);
  assert.equal(pupilText.includes("29nd"), false);
  assert.equal(pupilText.includes("September"), false);
  assert.equal(markdown.includes("## Teacher-only notes（範例／教師用）"), true);
});

test("pupil files use relative paths and do not persist or publish", () => {
  const html = read("index.html").toString("utf8");
  const app = read("js/app.js").toString("utf8");
  const marking = read("js/marking.js").toString("utf8");
  const passages = read("js/passages.js").toString("utf8");
  const css = read("css/styles.css").toString("utf8");
  const pupilSource = [html, app, marking, passages, css].join("\n");
  assert.match(html, /href="css\/styles\.css"/);
  assert.match(html, /src="js\/marking\.js"/);
  assert.match(html, /src="js\/passages\.js"/);
  assert.match(html, /src="js\/app\.js"/);
  assert.match(app, /data\/exercises\.json/);
  assert.match(app, /data\/passages\.md/);
  assert.doesNotMatch(html, /(?:href|src)="\/[^"]+"/);
  assert.doesNotMatch(pupilSource, /https?:\/\//);
  for (const phrase of [
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "document.cookie",
    "serviceWorker",
    "sendBeacon",
    "XMLHttpRequest",
    "範例／教師用",
    "teacher_note",
    "source_key_letter",
    "q3_key_decision",
    "supported_by",
    "acceptable_notes",
    "profile_note",
    "word_bank_rule",
    "29nd",
    "September",
  ]) {
    assert.equal(pupilSource.includes(phrase), false, phrase);
  }
  assert.equal(/\bhelper\b/i.test(pupilSource), false);
  assert.doesNotMatch(app, /\.explanation/);
  assert.equal(fs.existsSync(path.join(root, ".github")), false);
  assert.equal(fs.existsSync(path.join(root, ".github/workflows")), false);
});
