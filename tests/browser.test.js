const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const puppeteer = require("puppeteer-core");

const root = path.resolve(__dirname, "..");
const SCORED_IDS = ["Q01", "Q02", "Q03", "Q04", "Q05", "Q06a", "Q06b"];

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const filePath = path.normalize(path.join(root, pathname));
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const types = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
      };
      res.writeHead(200, {
        "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500);
      res.end("error");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function installWatchers(page) {
  await page.evaluateOnNewDocument(() => {
    window.__storageWrites = [];
    const record = (kind) => window.__storageWrites.push(kind);
    for (const method of ["setItem", "removeItem", "clear"]) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        record("storage." + method);
        return original.apply(this, args);
      };
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
      if (descriptor && descriptor.set) {
        Object.defineProperty(Document.prototype, "cookie", {
          configurable: true,
          get() {
            return descriptor.get.call(this);
          },
          set(value) {
            record("cookie");
            return descriptor.set.call(this, value);
          },
        });
      }
    } catch (error) {
      /* A failed watch must not look like a write. */
    }
    const originalOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
      record("indexedDB.open");
      return originalOpen.apply(this, args);
    };
    if (navigator.serviceWorker && navigator.serviceWorker.register) {
      const originalRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = function (...args) {
        record("serviceWorker.register");
        return originalRegister(...args);
      };
    }
  });
}

async function assertPassage(page, line, stacked) {
  const info = await page.evaluate((lineNo) => {
    const passage = document.getElementById("passage");
    const questions = document.getElementById("questions");
    const passageRect = passage.getBoundingClientRect();
    const questionRect = questions.getBoundingClientRect();
    const row = passage.querySelector(`[data-line="${lineNo}"]`);
    const rowRect = row.getBoundingClientRect();
    const lineNumber = row.querySelector(".ln");
    const visibleHeight =
      Math.min(rowRect.bottom, passageRect.bottom) - Math.max(rowRect.top, passageRect.top);
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      display: getComputedStyle(passage).display,
      lineDisplay: getComputedStyle(lineNumber).display,
      p: {
        top: passageRect.top,
        left: passageRect.left,
        right: passageRect.right,
        bottom: passageRect.bottom,
        width: passageRect.width,
        height: passageRect.height,
      },
      q: {
        top: questionRect.top,
        left: questionRect.left,
        right: questionRect.right,
        bottom: questionRect.bottom,
        width: questionRect.width,
        height: questionRect.height,
      },
      lineInPane: visibleHeight > 8 && rowRect.right > 0 && rowRect.left < window.innerWidth,
      lineNo: lineNumber.textContent.trim(),
      lineText: row.innerText,
    };
  }, line);
  assert.notEqual(info.display, "none");
  assert.notEqual(info.lineDisplay, "none");
  assert.ok(info.p.height > 80, "passage should stay on screen");
  assert.ok(info.q.height > 80, "questions should stay on screen");
  assert.ok(info.p.top >= -1 && info.p.bottom <= info.vh + 2, "passage pane inside the viewport");
  assert.ok(info.q.top >= -1 && info.q.bottom <= info.vh + 2, "question pane inside the viewport");
  assert.equal(info.lineNo, String(line));
  assert.ok(info.lineInPane, "line " + line + " should be visible in the passage");
  if (stacked) {
    assert.ok(info.q.top >= info.p.bottom - 6, "narrow layout stacks the passage above the questions");
    assert.ok(info.p.width > info.vw * 0.7, "stacked passage uses the screen width");
  } else {
    assert.ok(info.p.right <= info.q.left + 2, "wide layout places the passage beside the questions");
    const overlap = Math.min(info.p.bottom, info.q.bottom) - Math.max(info.p.top, info.q.top);
    assert.ok(overlap > 80, "side-by-side panes share the vertical space");
  }
  return info;
}

async function assertCalmPlain(page) {
  const info = await page.evaluate(() => {
    const row = document.querySelector('#passage [data-line="15"]');
    const text = row.querySelector(".line-text");
    const other = document.querySelector('#passage [data-line="14"] .line-text');
    const style = getComputedStyle(text);
    const otherStyle = getComputedStyle(other);
    return {
      html: text.innerHTML,
      className: text.className,
      bg: style.backgroundColor,
      otherBg: otherStyle.backgroundColor,
      weight: style.fontWeight,
      otherWeight: otherStyle.fontWeight,
      mark: row.querySelectorAll("mark, em, strong, [class*='highlight'], [data-highlight]").length,
      text: text.textContent,
    };
  });
  assert.equal(info.mark, 0);
  assert.equal(info.html.includes("<"), false);
  assert.equal(info.className, "line-text");
  assert.equal(info.bg, info.otherBg);
  assert.equal(info.weight, info.otherWeight);
  assert.match(info.text, /calm down scared animals/);
}

async function assertNoTeacherLeak(page) {
  const text = await page.evaluate(() => document.body.innerText);
  for (const phrase of [
    "範例／教師用",
    "Teacher-only",
    "teacher_note",
    "source_key_letter",
    "q3_key_decision",
    "handwritten",
    "29nd",
    "September",
    "For the pupil site and for teachers",
    "Key remains",
    "Person-to-job",
    "Do not show this disagreement",
    "The source paper marked",
    "Confirmed 2026-11-12",
    "ticked_on_source_paper",
    "acceptable_notes",
  ]) {
    assert.equal(text.includes(phrase), false, phrase);
  }
  assert.equal(/\bhelper\b/i.test(text), false);
  assert.equal(await page.$$eval("img, svg", (els) => els.length), 0);
}

async function clickNext(page, expected) {
  await page.click("#questions button[data-action='next']");
  await page.waitForFunction(
    (exp) => {
      const el = document.getElementById("questions");
      if (exp === "review") return el.dataset.kind === "review";
      return (el.dataset.screen || "").split(/\s+/).includes(exp);
    },
    {},
    expected
  );
}

async function submit(page) {
  await page.click("#questions button[data-action='submit']");
}

async function waitOutcome(page, id, outcome) {
  await page.waitForFunction(
    (itemId, value) => {
      const el = document.querySelector(`[data-item-id="${itemId}"]`);
      return Boolean(el && el.dataset.outcome === value);
    },
    {},
    id,
    outcome
  );
}

async function packItem(page, id) {
  return page.evaluate(async (itemId) => {
    const pack = await fetch("data/exercises.json").then((response) => response.json());
    return pack.stations[0].items.find((item) => item.id === itemId);
  }, id);
}

async function dragWord(page, word, id) {
  await page.evaluate((bankWord, gapId) => {
    const chip = document.querySelector(`[data-word="${bankWord}"]`);
    const box = document.querySelector(`[data-drop-gap="${gapId}"]`);
    const transfer = new DataTransfer();
    transfer.setData("text/plain", bankWord);
    chip.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    box.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, word, id);
  assert.equal(await page.$eval(`select[data-gap="${id}"]`, (el) => el.value), word);
}

test("headless Chrome practises Bright Days and then closes", { timeout: 180000 }, async () => {
  let browser;
  let server;
  const requests = [];
  const pageErrors = [];
  try {
    server = await startServer();
    const { port } = server.address();
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const page = await browser.newPage();
    page.on("request", (request) => {
      requests.push(request.method() + " " + request.url());
    });
    page.on("pageerror", (error) => {
      pageErrors.push(String(error));
      console.error("PAGEERROR", error);
    });
    await installWatchers(page);
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle0" });
    await page.waitForSelector("#passage [data-line='1']");

    const lines = await page.$$eval("#passage [data-line]", (els) => els.map((el) => Number(el.dataset.line)));
    assert.deepEqual(lines, Array.from({ length: 24 }, (_, index) => index + 1));
    await assertPassage(page, 1, false);
    const columns = await page.$eval(".ad-grid", (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    assert.ok(columns >= 2);
    const passageText = await page.$eval("#passage", (el) => el.innerText);
    assert.match(passageText, /Bright Days Job Fair/);
    assert.match(passageText, /Find Your DREAM job here!/);
    assert.match(passageText, /Cook’s Assistant at Rainbow Youth Centre/);
    assert.match(passageText, /brightdays@joymail\.com/);
    assert.match(passageText, /2646 2642/);
    assert.doesNotMatch(passageText, /\bhelper\b/i);
    assert.doesNotMatch(passageText, /September|29nd/);
    await assertCalmPlain(page);
    await assertNoTeacherLeak(page);
    assert.equal(await page.$("#glossary"), null);
    assert.equal(await page.$("#profile"), null);
    assert.equal(await page.$("#word-bank"), null);
    assert.equal(await page.$eval("#score", (el) => el.dataset.earned), "0");
    assert.equal(await page.$eval("#score", (el) => el.dataset.total), "7");
    assert.equal(await page.$eval("#score", (el) => el.dataset.scoredCount), "7");

    const statements = await page.$$eval("#questions .statements li", (els) => els.map((el) => el.textContent.trim()));
    assert.deepEqual(statements, [
      "know what children like",
      "be creative",
      "be good at English",
      "be able to work fast",
    ]);
    const q01 = await packItem(page, "Q01");
    await page.click("input[name='Q01'][value='A']");
    await submit(page);
    const q01Hint = await page.$eval("[data-feedback-for='Q01']", (el) => el.textContent);
    assert.match(q01Hint, /請再試一次/);
    assert.equal(q01Hint.includes(q01.hints.first_error), true);
    assert.doesNotMatch(q01Hint, /The answer is|All of the above/);
    assert.equal(await page.$eval("[data-item-id='Q01']", (el) => el.dataset.outcome || ""), "");
    await page.click("input[name='Q01'][value='C']");
    await submit(page);
    await waitOutcome(page, "Q01", "hinted_success");
    assert.equal(await page.$$eval("[data-item-id='Q01'][data-outcome='first_correct']", (els) => els.length), 0);

    await clickNext(page, "Q02");
    await page.click("input[name='Q02'][value='B']");
    await submit(page);
    await waitOutcome(page, "Q02", "first_correct");
    const q02Feedback = await page.$eval("[data-feedback-for='Q02']", (el) => ({
      mode: el.dataset.feedbackMode,
      text: el.textContent,
    }));
    assert.equal(q02Feedback.mode, "first_correct");
    assert.match(q02Feedback.text, /creative/);
    assert.doesNotMatch(q02Feedback.text, /請再試一次/);

    await clickNext(page, "Q03");
    const glossary = await page.$eval("#glossary", (el) => el.innerText);
    for (const sense of (await packItem(page, "Q03")).glossary) {
      assert.equal(glossary.includes(String(sense.sense)), true);
      assert.equal(glossary.includes(sense.pos), true);
      assert.equal(glossary.includes(sense.definition), true);
      assert.equal(glossary.includes(sense.example), true);
    }
    const calmLine = await assertPassage(page, 15, false);
    assert.match(calmLine.lineText, /calm down scared animals/);
    await assertCalmPlain(page);
    const glossBox = await page.evaluate(() => {
      const pane = document.getElementById("questions");
      const el = document.getElementById("glossary");
      const paneRect = pane.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      return Math.min(rect.bottom, paneRect.bottom) - Math.max(rect.top, paneRect.top);
    });
    assert.ok(glossBox > 8, "dictionary box stays visible");

    await page.setViewport({ width: 414, height: 896, deviceScaleFactor: 1 });
    await page.waitForFunction(() => window.innerWidth === 414);
    await page.waitForFunction(() => {
      const pane = document.getElementById("passage");
      const row = pane.querySelector('[data-line="15"]');
      const paneRect = pane.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return Math.min(rowRect.bottom, paneRect.bottom) - Math.max(rowRect.top, paneRect.top) > 8;
    });
    await assertPassage(page, 15, true);
    await assertCalmPlain(page);
    const narrowColumns = await page.$eval(
      ".ad-grid",
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length
    );
    assert.equal(narrowColumns, 1);
    const narrowLineNumbers = await page.$$eval("#passage .ln", (els) => els.map((el) => el.textContent.trim()));
    assert.deepEqual(narrowLineNumbers, Array.from({ length: 24 }, (_, index) => String(index + 1)));

    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.waitForFunction(() => window.innerWidth === 1280);
    const q03 = await packItem(page, "Q03");
    await page.click("input[name='Q03'][value='A']");
    await submit(page);
    const q03Hint = await page.$eval("[data-feedback-for='Q03']", (el) => el.textContent);
    assert.equal(q03Hint.includes(q03.hints.first_error), true);
    assert.doesNotMatch(q03Hint, /The answer is D|sense 4|source paper/);
    assert.equal(await page.$eval("[data-item-id='Q03']", (el) => el.dataset.outcome || ""), "");
    await page.click("input[name='Q03'][value='D']");
    await submit(page);
    await waitOutcome(page, "Q03", "hinted_success");
    assert.equal(await page.$$eval("[data-item-id='Q03'][data-outcome='first_correct']", (els) => els.length), 0);
    await assertCalmPlain(page);

    await clickNext(page, "Q04");
    assert.equal(await page.$("#glossary"), null);
    const q04 = await packItem(page, "Q04");
    await page.click("input[name='Q04'][value='A']");
    await submit(page);
    const q04Hint = await page.$eval("[data-feedback-for='Q04']", (el) => el.textContent);
    assert.equal(q04Hint.includes(q04.hints.first_error), true);
    assert.doesNotMatch(q04Hint, /The answer is/);
    await page.click("input[name='Q04'][value='C']");
    await submit(page);
    await waitOutcome(page, "Q04", "incorrect");
    const q04Explain = await page.$eval("[data-feedback-for='Q04']", (el) => el.textContent);
    assert.equal(q04Explain.includes(q04.feedback.incorrect_after_retry), true);
    assert.match(q04Explain, /The answer is B/);
    assert.match(q04Explain, /lines 15/);

    await clickNext(page, "Q05");
    const profile = await page.$eval("#profile", (el) => el.innerText);
    const q05 = await packItem(page, "Q05");
    assert.equal(profile.includes(q05.profile_text), true);
    assert.match(profile, /Tom/);
    assert.equal(await page.$$eval("#profile img, #questions img, #passage img", (els) => els.length), 0);
    assert.equal(await page.$("#glossary"), null);
    await page.click("input[name='Q05'][value='C']");
    await submit(page);
    await waitOutcome(page, "Q05", "first_correct");

    await clickNext(page, "Q06a");
    const email = await page.$eval("#email", (el) => el.innerText);
    assert.match(email, /Hi Grace/);
    assert.match(email, /cook’s assistant/i);
    assert.match(email, /yummy new dishes/);
    assert.match(email, /stay healthy/);
    assert.match(email, /Do you think I should apply for the job\?/);
    assert.match(email, /Write soon/);
    assert.match(email, /Peter/);
    assert.equal(await page.$$eval("select[data-gap]", (els) => els.length), 2);
    const bankText = await page.$eval("#word-bank", (el) => el.innerText);
    for (const word of ["patient", "creative", "outstanding", "interesting", "familiar"]) {
      assert.equal(bankText.includes(word), true, word);
    }
    await page.select("select[data-gap='Q06a']", "creative");
    const secondOptions = await page.$$eval("select[data-gap='Q06b'] option", (els) => els.map((el) => el.value));
    assert.equal(secondOptions.includes("creative"), false);
    assert.equal(secondOptions.includes("familiar"), true);
    await page.select("select[data-gap='Q06a']", "interesting");
    await page.select("select[data-gap='Q06b']", "patient");
    await submit(page);
    const q06a = await packItem(page, "Q06a");
    const q06b = await packItem(page, "Q06b");
    const firstGap = await page.$eval("[data-feedback-for='Q06a']", (el) => ({
      mode: el.dataset.feedbackMode,
      text: el.textContent,
    }));
    const secondGap = await page.$eval("[data-feedback-for='Q06b']", (el) => ({
      mode: el.dataset.feedbackMode,
      text: el.textContent.trim(),
    }));
    assert.equal(firstGap.mode, "hint");
    assert.equal(firstGap.text.includes(q06a.hints.first_error), true);
    assert.doesNotMatch(firstGap.text, /The word is creative|interesting and outstanding/i);
    assert.equal(secondGap.mode, "none");
    assert.equal(secondGap.text, "");
    assert.equal(secondGap.text.includes(q06b.hints.first_error), false);
    assert.equal(await page.$eval("[data-item-id='Q06a']", (el) => el.dataset.outcome || ""), "");
    assert.equal(await page.$eval("[data-item-id='Q06b']", (el) => el.dataset.outcome || ""), "");
    assert.equal(await page.$eval("select[data-gap='Q06a']", (el) => el.disabled), false);
    await dragWord(page, "creative", "Q06a");
    await dragWord(page, "familiar", "Q06b");
    await submit(page);
    await waitOutcome(page, "Q06a", "hinted_success");
    await waitOutcome(page, "Q06b", "hinted_success");
    assert.equal(
      await page.$$eval(
        "[data-item-id='Q06a'][data-outcome='first_correct'], [data-item-id='Q06b'][data-outcome='first_correct']",
        (els) => els.length
      ),
      0
    );
    assert.equal(await page.$("[data-item-id='Q06']"), null);
    const emailStill = await page.$eval("#email", (el) => el.innerText);
    assert.match(emailStill, /Hi Grace/);
    assert.match(emailStill, /stay healthy/);
    assert.equal(await page.$$eval("#word-bank [data-word]", (els) => els.length), 5);

    await clickNext(page, "review");
    const reviewIds = await page.$$eval("#review-list [data-review-id]", (els) => els.map((el) => el.dataset.reviewId));
    assert.deepEqual(reviewIds, SCORED_IDS);
    assert.equal(reviewIds.includes("Q06"), false);
    const score = await page.$eval("#score", (el) => ({
      earned: el.dataset.earned,
      total: el.dataset.total,
      done: el.dataset.done,
      count: el.dataset.scoredCount,
    }));
    assert.deepEqual(score, { earned: "6", total: "7", done: "7", count: "7" });
    await assertNoTeacherLeak(page);
    assert.equal(await page.$$eval("form", (els) => els.length), 0);

    await page.setViewport({ width: 414, height: 896, deviceScaleFactor: 1 });
    await page.waitForFunction(() => window.innerWidth === 414);
    await assertPassage(page, 1, true);
    const narrowNumbers = await page.$$eval("#passage .ln", (els) => els.map((el) => el.textContent.trim()));
    assert.deepEqual(narrowNumbers, Array.from({ length: 24 }, (_, index) => String(index + 1)));

    const writesBeforeReload = await page.evaluate(() => window.__storageWrites.slice());
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector("#passage [data-line='1']");
    const cleared = await page.$eval("#score", (el) => ({
      earned: el.dataset.earned,
      total: el.dataset.total,
      station: el.dataset.station,
    }));
    assert.deepEqual(cleared, { earned: "0", total: "7", station: "bright-days" });
    assert.equal(await page.$$eval("[data-outcome]", (els) => els.length), 0);
    await assertPassage(page, 1, true);
    assert.equal(await page.$eval("#questions", (el) => el.dataset.screen), "Q01");

    await page.click("input[name='Q01'][value='C']");
    await submit(page);
    await waitOutcome(page, "Q01", "first_correct");
    assert.equal(await page.$eval("#score", (el) => el.dataset.earned), "1");
    await page.click("#reset-btn");
    await page.waitForFunction(() => document.getElementById("score").dataset.earned === "0");
    assert.equal(await page.$eval("#questions", (el) => el.dataset.screen), "Q01");
    assert.equal(await page.$$eval("[data-outcome]", (els) => els.length), 0);
    assert.equal(await page.$eval("input[name='Q01'][value='C']", (el) => el.checked), false);
    assert.match(await page.$eval("#notice", (el) => el.textContent), /分數已清除/);

    const writesAfter = await page.evaluate(() => window.__storageWrites.slice());
    assert.deepEqual(writesBeforeReload.concat(writesAfter), []);
    const posted = requests.filter((entry) => !/^(GET|HEAD) /.test(entry));
    assert.deepEqual(posted, []);
    assert.ok(requests.some((entry) => entry.includes("/data/exercises.json")));
    assert.ok(requests.some((entry) => entry.includes("/data/passages.md")));
    const external = requests.filter((entry) => {
      const url = entry.split(" ").slice(1).join(" ");
      return url.startsWith("http") && !url.includes("127.0.0.1");
    });
    assert.deepEqual(external, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
});
