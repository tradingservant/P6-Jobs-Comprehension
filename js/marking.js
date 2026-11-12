(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.Marking = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function isScoredItem(item) {
    if (!item || typeof item !== "object") return false;
    if (item.scored === false) return false;
    if (item.teacher_review === true) return false;
    if (item.type === "note_display_group" || item.type === "gap_note_group") return false;
    if (typeof item.marks !== "number" || !(item.marks > 0)) return false;
    return true;
  }

  function scoredItems(pack) {
    const items = [];
    (pack.stations || []).forEach(function (station) {
      (station.items || []).forEach(function (item) {
        if (isScoredItem(item)) items.push(item);
      });
    });
    return items;
  }

  function normaliseWord(raw) {
    return String(raw == null ? "" : raw).trim();
  }

  function markGap(item, raw, bank) {
    const text = normaliseWord(raw);
    const single = text.length > 0 && !/\s/.test(text);
    if (!single) return { correct: false, word: "" };
    const word = text.toLowerCase();
    if (Array.isArray(bank) && bank.length) {
      const inBank = bank.some(function (entry) {
        return String(entry).trim().toLowerCase() === word;
      });
      if (!inBank) return { correct: false, word: "" };
    }
    const accepted = Array.isArray(item.accepted) ? item.accepted : [];
    const correct = accepted.some(function (answer) {
      return String(answer).trim().toLowerCase() === word;
    });
    return { correct: correct, word: word };
  }

  function markGapGroup(items, values, bank) {
    const seen = Object.create(null);
    return (items || []).map(function (item) {
      const marked = markGap(item, values ? values[item.id] : "", bank);
      let correct = marked.correct;
      if (marked.word) {
        if (seen[marked.word]) correct = false;
        else seen[marked.word] = true;
      }
      return { id: item.id, correct: correct, word: marked.word };
    });
  }

  function markChoice(item, raw) {
    const value = String(raw == null ? "" : raw).trim();
    const accepted = Array.isArray(item.accepted) ? item.accepted : [];
    return {
      correct: accepted.some(function (answer) {
        return String(answer) === value;
      }),
    };
  }

  function markItem(item, answer, context) {
    if (!item) return { correct: false };
    if (item.type === "one_word_gap") {
      const bank = context && context.bank;
      return markGap(item, answer, bank);
    }
    if (item.type === "mcq_single" || item.type === "mcq_combination" || item.type === "dictionary_sense") {
      return markChoice(item, answer);
    }
    return { correct: false };
  }

  function applySubmission(prev, correct) {
    const state = {
      attempts: prev && prev.attempts ? prev.attempts : 0,
      outcome: prev && prev.outcome ? prev.outcome : null,
      hintShown: Boolean(prev && prev.hintShown),
      wasWrong: Boolean(prev && prev.wasWrong),
    };
    if (state.outcome) return state;
    if (!correct) {
      if (state.hintShown || state.attempts >= 1) {
        return { attempts: state.attempts + 1, outcome: "incorrect", hintShown: true, wasWrong: true };
      }
      return { attempts: 1, outcome: null, hintShown: true, wasWrong: true };
    }
    const hadHint = state.hintShown || state.wasWrong || state.attempts > 0;
    if (!hadHint) {
      return { attempts: 1, outcome: "first_correct", hintShown: false, wasWrong: false };
    }
    return { attempts: state.attempts + 1, outcome: "hinted_success", hintShown: true, wasWrong: true };
  }

  function applyGapSubmission(prevMap, markedResults) {
    const next = {};
    const entries = (markedResults || []).map(function (row) {
      const prev = (prevMap && prevMap[row.id]) || {
        attempts: 0,
        outcome: null,
        hintShown: false,
        wasWrong: false,
      };
      return { row: row, prev: prev };
    });
    let hintTarget = null;
    entries.forEach(function (entry) {
      if (hintTarget || entry.prev.outcome) return;
      if (!entry.row.correct) hintTarget = entry.row.id;
    });
    entries.forEach(function (entry) {
      const prev = entry.prev;
      const id = entry.row.id;
      if (prev.outcome) {
        next[id] = {
          attempts: prev.attempts,
          outcome: prev.outcome,
          hintShown: Boolean(prev.hintShown),
          wasWrong: Boolean(prev.wasWrong),
        };
        return;
      }
      if (entry.row.correct) {
        const hadProblem = prev.hintShown || prev.wasWrong || prev.attempts > 0;
        next[id] = hadProblem
          ? { attempts: prev.attempts + 1, outcome: "hinted_success", hintShown: true, wasWrong: true }
          : { attempts: 1, outcome: "first_correct", hintShown: false, wasWrong: false };
        return;
      }
      if (id !== hintTarget) {
        next[id] = {
          attempts: Math.max(prev.attempts, 1),
          outcome: null,
          hintShown: Boolean(prev.hintShown),
          wasWrong: true,
        };
        return;
      }
      if (prev.hintShown) {
        next[id] = {
          attempts: prev.attempts + 1,
          outcome: "incorrect",
          hintShown: true,
          wasWrong: true,
        };
        return;
      }
      next[id] = {
        attempts: prev.attempts + 1,
        outcome: null,
        hintShown: true,
        wasWrong: true,
      };
    });
    return next;
  }

  function hintText(item) {
    return item && item.hints && item.hints.first_error ? item.hints.first_error : "";
  }

  function feedbackMode(attempt) {
    if (!attempt) return "none";
    if (attempt.outcome === "first_correct") return "first_correct";
    if (attempt.outcome === "hinted_success") return "hinted_success";
    if (attempt.outcome === "incorrect") return "incorrect_after_retry";
    if (attempt.hintShown) return "hint";
    return "none";
  }

  function buildScreens(station) {
    const items = ((station && station.items) || []).filter(isScoredItem);
    const screens = [];
    let index = 0;
    while (index < items.length) {
      const item = items[index];
      if (item.type === "one_word_gap") {
        const ids = [];
        const noteId = item.part_of_note;
        while (
          index < items.length &&
          items[index].type === "one_word_gap" &&
          items[index].part_of_note === noteId
        ) {
          ids.push(items[index].id);
          index += 1;
        }
        screens.push({ kind: "gaps", ids: ids, noteId: noteId });
      } else {
        screens.push({ kind: "item", ids: [item.id] });
        index += 1;
      }
    }
    screens.push({
      kind: "review",
      ids: items.map(function (entry) {
        return entry.id;
      }),
    });
    return screens;
  }

  function scoreStation(items, attempts) {
    const scored = (items || []).filter(isScoredItem);
    let earned = 0;
    let done = 0;
    scored.forEach(function (item) {
      const record = attempts && attempts[item.id];
      const outcome = record && record.outcome;
      if (outcome === "first_correct" || outcome === "hinted_success") earned += item.marks;
      if (outcome) done += 1;
    });
    const total = scored.reduce(function (sum, item) {
      return sum + item.marks;
    }, 0);
    return {
      earned: earned,
      total: total,
      done: done,
      count: scored.length,
      ids: scored.map(function (item) {
        return item.id;
      }),
    };
  }

  return {
    isScoredItem: isScoredItem,
    scoredItems: scoredItems,
    markItem: markItem,
    markGap: markGap,
    markGapGroup: markGapGroup,
    applySubmission: applySubmission,
    applyGapSubmission: applyGapSubmission,
    hintText: hintText,
    feedbackMode: feedbackMode,
    buildScreens: buildScreens,
    scoreStation: scoreStation,
  };
});
