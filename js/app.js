(function () {
  "use strict";

  const TITLE_LINES = { 3: true, 8: true, 12: true, 17: true };
  const QUESTION_LABEL = {
    Q01: "Question 1",
    Q02: "Question 2",
    Q03: "Question 3",
    Q04: "Question 4",
    Q05: "Question 5",
    Q06a: "Question 6 (i)",
    Q06b: "Question 6 (ii)",
  };
  const STATUS_LABEL = {
    first_correct: "首次答對",
    hinted_success: "提示後答對",
    incorrect: "未答對",
    unanswered: "尚未作答",
    retry: "請再試一次",
  };

  let pack = null;
  let passages = null;
  let state = initialState();
  let dragWord = "";

  function initialState() {
    return {
      stationId: "bright-days",
      screen: 0,
      choices: {},
      gaps: {},
      attempts: {},
      notice: "",
    };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[character];
    });
  }

  function ready() {
    return Boolean(pack && passages);
  }

  function currentStation() {
    return pack.stations.find(function (station) {
      return station.id === state.stationId;
    }) || pack.stations[0];
  }

  function itemById(id) {
    let found = null;
    pack.stations.forEach(function (station) {
      station.items.forEach(function (item) {
        if (item.id === id) found = item;
      });
    });
    return found;
  }

  function currentScreens() {
    return Marking.buildScreens(currentStation());
  }

  function currentScreen() {
    const screens = currentScreens();
    const index = Math.min(state.screen || 0, screens.length - 1);
    state.screen = index;
    return screens[index];
  }

  function attemptOf(id) {
    return state.attempts[id] || null;
  }

  function isLocked(id) {
    const attempt = attemptOf(id);
    return Boolean(attempt && attempt.outcome);
  }

  function statusOf(id) {
    const attempt = attemptOf(id);
    if (!attempt) return "unanswered";
    if (attempt.outcome) return attempt.outcome;
    if (attempt.hintShown) return "retry";
    return "unanswered";
  }

  function attemptCount(id) {
    const attempt = attemptOf(id);
    if (!attempt) return 0;
    if (!attempt.outcome && !attempt.hintShown) return attempt.attempts || 0;
    return attempt.attempts || 0;
  }

  function outcomeAttribute(id) {
    const attempt = attemptOf(id);
    if (!attempt || !attempt.outcome) return "";
    return ' data-outcome="' + attempt.outcome + '"';
  }

  function itemLabel(id) {
    return QUESTION_LABEL[id] || id;
  }

  function settle(item, result) {
    const prev = attemptOf(item.id);
    if (prev && prev.outcome) return;
    state.attempts[item.id] = Marking.applySubmission(prev, result.correct);
  }

  function readChoice(item) {
    const selected = document.querySelector('input[name="' + CSS.escape(item.id) + '"]:checked');
    if (selected) return selected.value;
    return state.choices[item.id] || "";
  }

  function readGap(id) {
    const select = document.querySelector('select[data-gap="' + id + '"]');
    if (select) return select.value;
    return state.gaps[id] || "";
  }

  function wordBank() {
    const group = itemById("Q06");
    return group && group.word_bank ? group.word_bank : [];
  }

  function assignGap(id, value) {
    if (isLocked(id)) return;
    const bank = wordBank();
    const text = String(value == null ? "" : value).trim();
    const canonical = text
      ? bank.find(function (word) {
          return word.toLowerCase() === text.toLowerCase();
        })
      : "";
    if (text && !canonical) {
      render({ preserveScroll: true });
      return;
    }
    if (canonical) {
      const holder = Object.keys(state.gaps).find(function (other) {
        return other !== id && String(state.gaps[other] || "").toLowerCase() === canonical.toLowerCase();
      });
      if (holder && isLocked(holder)) {
        render({ preserveScroll: true });
        return;
      }
      if (holder) state.gaps[holder] = "";
    }
    state.gaps[id] = canonical || "";
    render({ preserveScroll: true });
  }

  function submitScreen() {
    if (!ready()) return;
    const screen = currentScreen();
    if (!screen || screen.kind === "review") return;
    if (screen.kind === "gaps") {
      const items = screen.ids.map(itemById);
      const values = {};
      items.forEach(function (item) {
        values[item.id] = readGap(item.id);
        state.gaps[item.id] = values[item.id];
      });
      const marked = Marking.markGapGroup(items, values, wordBank());
      const open = marked.filter(function (row) {
        return !isLocked(row.id);
      });
      const updated = Marking.applyGapSubmission(state.attempts, open);
      open.forEach(function (row) {
        state.attempts[row.id] = updated[row.id];
      });
    } else {
      const item = itemById(screen.ids[0]);
      const value = readChoice(item);
      state.choices[item.id] = value;
      settle(item, Marking.markItem(item, value));
    }
    render({ preserveScroll: true });
  }

  function move(delta) {
    const screens = currentScreens();
    const next = state.screen + delta;
    if (next < 0 || next >= screens.length) return;
    state.screen = next;
    state.notice = "";
    render({ preserveScroll: false });
  }

  function jumpReview() {
    const screens = currentScreens();
    state.screen = screens.length - 1;
    state.notice = "";
    render({ preserveScroll: false });
  }

  function resetAll() {
    state = initialState();
    state.notice = "分數已清除。";
    render({ preserveScroll: false });
  }

  function lineRow(line) {
    const title = TITLE_LINES[line.line] ? " job-title" : "";
    return (
      '<div class="ln-row" data-line="' +
      line.line +
      '"><span class="ln">' +
      line.line +
      '</span><p class="line-text' +
      title +
      '" lang="en">' +
      escapeHtml(line.text) +
      "</p></div>"
    );
  }

  function linesBetween(from, to) {
    return passages.lines
      .filter(function (line) {
        return line.line >= from && line.line <= to;
      })
      .map(lineRow)
      .join("");
  }

  function renderPassage() {
    let html = '<div class="sheet fair">';
    let gridOpen = false;
    Passages.GROUPS.forEach(function (group) {
      const inner = linesBetween(group.from, group.to);
      if (group.id === "title") {
        html += '<div class="fair-title">' + inner + "</div>";
        return;
      }
      if (group.id === "footer") {
        if (gridOpen) {
          html += "</div>";
          gridOpen = false;
        }
        html += '<footer class="fair-foot">' + inner + "</footer>";
        return;
      }
      if (!gridOpen) {
        html += '<div class="ad-grid">';
        gridOpen = true;
      }
      html += '<article class="ad" data-ad="' + group.id + '">' + inner + "</article>";
    });
    if (gridOpen) html += "</div>";
    html += "</div>";
    return html;
  }

  function feedbackHtml(item) {
    const attempt = attemptOf(item.id);
    const mode = Marking.feedbackMode(attempt);
    if (mode === "none") {
      return '<div class="feedback" data-feedback-for="' + item.id + '" data-feedback-mode="none"></div>';
    }
    if (mode === "hint") {
      return (
        '<div class="feedback is-hint" data-feedback-for="' +
        item.id +
        '" data-feedback-mode="hint"><p class="status">' +
        STATUS_LABEL.retry +
        "</p><p>" +
        escapeHtml(Marking.hintText(item)) +
        "</p></div>"
      );
    }
    if (mode === "incorrect_after_retry") {
      const explanation = item.feedback && item.feedback.incorrect_after_retry ? item.feedback.incorrect_after_retry : "";
      return (
        '<div class="feedback is-incorrect" data-feedback-for="' +
        item.id +
        '" data-feedback-mode="incorrect_after_retry"><p class="status">' +
        STATUS_LABEL.incorrect +
        '</p><p lang="en">' +
        escapeHtml(explanation) +
        "</p></div>"
      );
    }
    const label = mode === "first_correct" ? "正確（首次答對）" : "正確（提示後答對）";
    const correct = item.feedback && item.feedback.correct ? item.feedback.correct : "";
    return (
      '<div class="feedback is-correct" data-feedback-for="' +
      item.id +
      '" data-feedback-mode="' +
      mode +
      '"><p class="status">' +
      label +
      '</p><p lang="en">' +
      escapeHtml(correct) +
      "</p></div>"
    );
  }

  function submitButton(items) {
    const open = items.some(function (item) {
      return !isLocked(item.id);
    });
    if (!open) return '<button type="button" data-action="submit" disabled>已提交</button>';
    return '<button type="button" data-action="submit">提交答案</button>';
  }

  function renderStatements(item) {
    const rows = item.statements
      .map(function (statement) {
        return "<li value=\"" + statement.id + "\">" + escapeHtml(statement.text) + "</li>";
      })
      .join("");
    return '<ol class="statements" lang="en">' + rows + "</ol>";
  }

  function renderOptions(item) {
    const chosen = state.choices[item.id] || "";
    const locked = isLocked(item.id);
    return item.options
      .map(function (option) {
        const checked = chosen === option.id ? " checked" : "";
        return (
          '<label class="option"><input type="radio" name="' +
          escapeHtml(item.id) +
          '" value="' +
          escapeHtml(option.id) +
          '"' +
          checked +
          (locked ? " disabled" : "") +
          '><span class="opt-key">' +
          escapeHtml(option.id) +
          '</span><span lang="en">' +
          escapeHtml(option.text) +
          "</span></label>"
        );
      })
      .join("");
  }

  function renderGlossary(item) {
    const rows = item.glossary
      .map(function (sense) {
        return (
          '<li value="' +
          sense.sense +
          '"><p class="def" lang="en"><span class="sense-no">' +
          sense.sense +
          '</span> <span class="pos">' +
          escapeHtml(sense.pos) +
          "</span> " +
          escapeHtml(sense.definition) +
          '</p><p class="example" lang="en"><span class="eg">例：</span>' +
          escapeHtml(sense.example) +
          "</p></li>"
        );
      })
      .join("");
    return (
      '<section id="glossary" aria-label="詞典"><h3>詞典</h3><p class="headword" lang="en">' +
      escapeHtml(item.target_word) +
      "</p><ol>" +
      rows +
      "</ol></section>"
    );
  }

  function renderProfile(item) {
    return (
      '<figure class="speech" id="profile"><figcaption>Tom</figcaption><blockquote lang="en">' +
      escapeHtml(item.profile_text) +
      "</blockquote></figure>"
    );
  }

  function renderItem(item) {
    let html =
      '<article class="item" data-item-id="' +
      item.id +
      '" data-attempts="' +
      attemptCount(item.id) +
      '"' +
      outcomeAttribute(item.id) +
      ' data-status="' +
      statusOf(item.id) +
      '">';
    html += '<h3 lang="en">' + escapeHtml(itemLabel(item.id)) + "</h3>";
    if (item.direction_zh) html += '<p class="direction">' + escapeHtml(item.direction_zh) + "</p>";
    if (item.stem) html += '<p class="stem" lang="en">' + escapeHtml(item.stem) + "</p>";
    if (item.type === "mcq_combination") {
      html += renderStatements(item);
      html += '<p class="combo-label">組合選項</p>';
    }
    if (item.type === "dictionary_sense") {
      if (item.target_context) {
        html += '<p class="target-context" lang="en">' + escapeHtml(item.target_context) + "</p>";
      }
      html += renderGlossary(item);
    }
    if (item.profile_text) html += renderProfile(item);
    if (item.options) html += '<div class="options">' + renderOptions(item) + "</div>";
    html += feedbackHtml(item);
    html += submitButton([item]);
    html += "</article>";
    return html;
  }

  function renderBlank(item, bank, items) {
    const locked = isLocked(item.id);
    const value = state.gaps[item.id] || "";
    let options = '<option value="">請選擇</option>';
    bank.forEach(function (word) {
      const usedElsewhere = items.some(function (other) {
        return other.id !== item.id && String(state.gaps[other.id] || "").toLowerCase() === word.toLowerCase();
      });
      if (usedElsewhere) return;
      const selected = value.toLowerCase() === word.toLowerCase() ? " selected" : "";
      options +=
        '<option value="' + escapeHtml(word) + '"' + selected + ">" + escapeHtml(word) + "</option>";
    });
    return (
      '<span class="gap" data-drop-gap="' +
      item.id +
      '"><span class="gap-mark">' +
      escapeHtml(item.label) +
      '</span> <select data-gap="' +
      item.id +
      '" lang="en" aria-label="空格 ' +
      escapeHtml(item.label) +
      '，從選字欄選擇一個單詞"' +
      (locked ? " disabled" : "") +
      ">" +
      options +
      "</select></span>"
    );
  }

  function renderLineWithBlanks(line, items, bank) {
    const pattern = /\((i{1,3})\)\s*_{2,}/g;
    let html = "";
    let last = 0;
    let match;
    while ((match = pattern.exec(line))) {
      html += escapeHtml(line.slice(last, match.index));
      const label = "(" + match[1] + ")";
      const item = items.find(function (candidate) {
        return candidate.label === label;
      });
      html += item ? renderBlank(item, bank, items) : escapeHtml(match[0]);
      last = match.index + match[0].length;
    }
    html += escapeHtml(line.slice(last));
    return html;
  }

  function renderWordBank(bank, items) {
    const chips = bank
      .map(function (word) {
        const holder = items.find(function (item) {
          return String(state.gaps[item.id] || "").toLowerCase() === word.toLowerCase();
        });
        const locked = Boolean(holder && isLocked(holder.id));
        return (
          '<li class="chip' +
          (holder ? " is-used" : "") +
          (locked ? " is-locked" : "") +
          '" data-word="' +
          escapeHtml(word) +
          '"' +
          (locked ? ' data-locked="true"' : "") +
          ' draggable="' +
          (locked ? "false" : "true") +
          '">' +
          escapeHtml(word) +
          (holder ? '<span class="chip-note">已選</span>' : "") +
          "</li>"
        );
      })
      .join("");
    return (
      '<div id="word-bank-wrap"><p class="bank-help">可用滑鼠將詞語拖到空格，亦可用每個空格的下拉清單選擇。使用鍵盤或觸控螢幕時，請用下拉清單。每個詞語只可使用一次。</p><ul id="word-bank" aria-label="選字欄">' +
      chips +
      "</ul></div>"
    );
  }

  function renderGaps(screen) {
    const items = screen.ids.map(itemById);
    const group = itemById(screen.noteId);
    const bank = group.word_bank || [];
    const noteHtml = (group.note_lines || [])
      .map(function (line) {
        return "<p>" + renderLineWithBlanks(line, items, bank) + "</p>";
      })
      .join("");
    const feedback = items
      .map(function (item) {
        return (
          '<li data-item-id="' +
          item.id +
          '" data-attempts="' +
          attemptCount(item.id) +
          '"' +
          outcomeAttribute(item.id) +
          ' data-status="' +
          statusOf(item.id) +
          '"><p class="gap-label">' +
          escapeHtml(item.label) +
          "</p>" +
          feedbackHtml(item) +
          "</li>"
        );
      })
      .join("");
    return (
      '<article class="item" data-screen="gaps"><h3 lang="en">Question 6</h3><p class="direction">' +
      escapeHtml(group.direction_zh || "") +
      '</p><p class="direction-en" lang="en">' +
      escapeHtml(group.direction_en || "") +
      '</p><h4 class="note-title" lang="en">' +
      escapeHtml(group.note_title || "") +
      '</h4><div class="note" id="email" lang="en">' +
      noteHtml +
      "</div>" +
      renderWordBank(bank, items) +
      '<ul class="gap-results">' +
      feedback +
      "</ul>" +
      submitButton(items) +
      "</article>"
    );
  }

  function renderReview(screen) {
    const station = currentStation();
    const score = Marking.scoreStation(station.items, state.attempts);
    const unfinished = screen.ids.some(function (id) {
      return !isLocked(id);
    });
    const rows = screen.ids
      .map(function (id) {
        const status = statusOf(id);
        return (
          '<li data-review-id="' +
          id +
          '" data-outcome="' +
          (status === "retry" ? "unanswered" : status) +
          '"><span lang="en">' +
          escapeHtml(itemLabel(id)) +
          "</span>：" +
          STATUS_LABEL[status] +
          "</li>"
        );
      })
      .join("");
    const lead = unfinished ? "尚有題目未完成。你可以返回題目繼續作答。" : "你已完成全部題目。";
    return (
      '<article class="item review"><h3>檢視結果</h3><p>' +
      lead +
      '</p><p class="quiet">以下只列出各題結果，不設總評等級。</p><p class="score-line">得分 ' +
      score.earned +
      " / " +
      score.total +
      '</p><ol id="review-list">' +
      rows +
      "</ol></article>"
    );
  }

  function renderNav(screens, index) {
    const onReview = screens[index].kind === "review";
    const prevLabel = onReview ? "返回題目" : "上一題";
    const prevDisabled = index === 0 ? " disabled" : "";
    const review = onReview
      ? ""
      : '<button type="button" class="secondary" data-action="review">檢視結果</button>';
    const next = onReview ? "" : '<button type="button" class="secondary" data-action="next">下一題</button>';
    return (
      '<div class="nav"><button type="button" class="secondary" data-action="prev"' +
      prevDisabled +
      ">" +
      prevLabel +
      "</button>" +
      review +
      next +
      "</div>"
    );
  }

  function renderQuestions() {
    const station = currentStation();
    const screens = currentScreens();
    const index = Math.min(state.screen || 0, screens.length - 1);
    state.screen = index;
    const screen = screens[index];
    const score = Marking.scoreStation(station.items, state.attempts);
    let html = '<p id="notice"' + (state.notice ? "" : " hidden") + ">" + escapeHtml(state.notice) + "</p>";
    html += '<p class="station-kicker">閱讀練習</p>';
    html += '<h2 class="station-title" lang="en">' + escapeHtml(station.title) + "</h2>";
    html += '<p class="station-zh">' + escapeHtml(station.title_zh) + "</p>";
    html += '<p class="exam-stem" lang="en">' + escapeHtml(station.student_stem_en) + "</p>";
    html += '<p class="direction">' + escapeHtml(station.student_stem_zh) + "</p>";
    html += '<p class="progress">已完成 ' + score.done + " / " + score.count + " 題</p>";
    if (screen.kind === "review") html += renderReview(screen);
    else if (screen.kind === "gaps") html += renderGaps(screen);
    else html += renderItem(itemById(screen.ids[0]));
    html += renderNav(screens, index);
    return { html: html, screen: screen };
  }

  function revealPassageLine(lineNo) {
    const pane = document.getElementById("passage");
    const row = pane && pane.querySelector('[data-line="' + lineNo + '"]');
    if (!row) return;
    const paneRect = pane.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    pane.scrollTop += rowRect.top - paneRect.top - pane.clientHeight / 2 + rowRect.height / 2;
  }

  function revealInPane(paneId, selector) {
    const pane = document.getElementById(paneId);
    const el = pane && pane.querySelector(selector);
    if (!pane || !el) return;
    const paneRect = pane.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const visible = Math.min(rect.bottom, paneRect.bottom) - Math.max(rect.top, paneRect.top);
    if (visible > 8 && rect.top >= paneRect.top - 1 && rect.top < paneRect.bottom - 8) return;
    pane.scrollTop += rect.top - paneRect.top - 8;
  }

  function revealCurrentSupports() {
    const screen = currentScreen();
    if (!screen || (screen.kind !== "item" && screen.kind !== "gaps")) return;
    if (screen.kind === "item" && screen.ids.indexOf("Q03") !== -1) {
      revealPassageLine(15);
      revealInPane("questions", "#glossary");
    } else if (screen.kind === "item" && screen.ids.indexOf("Q05") !== -1) {
      revealInPane("questions", "#profile");
    } else if (screen.kind === "gaps") {
      revealInPane("questions", "#email");
    }
  }

  function updateScore(station) {
    const score = Marking.scoreStation(station.items, state.attempts);
    const el = document.getElementById("score");
    el.dataset.earned = String(score.earned);
    el.dataset.total = String(score.total);
    el.dataset.done = String(score.done);
    el.dataset.station = station.id;
    el.dataset.scoredCount = String(score.count);
    el.textContent = "得分 " + score.earned + " / " + score.total;
    document.getElementById("workspace").dataset.station = station.id;
  }

  function render(options) {
    if (!ready()) return;
    const opts = options || {};
    const station = currentStation();
    const passage = document.getElementById("passage");
    const questions = document.getElementById("questions");
    const passageScroll = opts.preserveScroll ? passage.scrollTop : 0;
    const questionScroll = opts.preserveScroll ? questions.scrollTop : 0;
    const built = renderQuestions();
    passage.innerHTML = renderPassage();
    questions.innerHTML = built.html;
    questions.dataset.kind = built.screen.kind;
    questions.dataset.screen = (built.screen.ids || []).join(" ");
    passage.scrollTop = opts.preserveScroll ? passageScroll : 0;
    questions.scrollTop = opts.preserveScroll ? questionScroll : 0;
    revealCurrentSupports();
    updateScore(station);
    const live = document.getElementById("live");
    if (live) live.textContent = state.notice || "";
    document.getElementById("pack-title").textContent = pack.title;
    document.getElementById("pack-title-zh").textContent = pack.title_zh;
    document.title = pack.title;
  }

  document.addEventListener("click", function (event) {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === "submit") submitScreen();
    else if (action === "next") move(1);
    else if (action === "prev") move(-1);
    else if (action === "review") jumpReview();
    else if (action === "reset") resetAll();
  });

  document.addEventListener("change", function (event) {
    const target = event.target;
    if (target.matches('input[type="radio"]')) {
      state.choices[target.name] = target.value;
    } else if (target.matches("select[data-gap]")) {
      assignGap(target.dataset.gap, target.value);
    }
  });

  document.addEventListener("dragstart", function (event) {
    const chip = event.target.closest("[data-word]");
    if (!chip || chip.dataset.locked === "true") {
      event.preventDefault();
      return;
    }
    dragWord = chip.dataset.word || "";
    if (event.dataTransfer) {
      try {
        event.dataTransfer.setData("text/plain", dragWord);
        event.dataTransfer.effectAllowed = "copy";
      } catch (error) {
        dragWord = chip.dataset.word || "";
      }
    }
  });

  document.addEventListener("dragover", function (event) {
    if (event.target.closest("[data-drop-gap]")) event.preventDefault();
  });

  document.addEventListener("drop", function (event) {
    const box = event.target.closest("[data-drop-gap]");
    if (!box) return;
    event.preventDefault();
    let word = "";
    if (event.dataTransfer) {
      try {
        word = event.dataTransfer.getData("text/plain");
      } catch (error) {
        word = "";
      }
    }
    if (!word) word = dragWord;
    dragWord = "";
    if (!word) return;
    assignGap(box.dataset.dropGap, word);
  });

  window.addEventListener("resize", function () {
    if (!ready()) return;
    window.requestAnimationFrame(revealCurrentSupports);
  });

  function showLoadError() {
    const questions = document.getElementById("questions");
    if (questions) {
      questions.innerHTML = '<p class="feedback is-incorrect">未能載入練習內容。請以網站方式開啟本頁。</p>';
    }
  }

  fetch("data/exercises.json")
    .then(function (response) {
      if (!response.ok) throw new Error("exercises");
      return response.json();
    })
    .then(function (loadedPack) {
      pack = loadedPack;
      return fetch("data/passages.md");
    })
    .then(function (response) {
      if (!response.ok) throw new Error("passages");
      return response.text();
    })
    .then(function (markdown) {
      passages = Passages.parsePassages(markdown);
      render({ preserveScroll: false });
    })
    .catch(showLoadError);
})();
