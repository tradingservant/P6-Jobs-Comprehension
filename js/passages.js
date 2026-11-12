(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.Passages = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const GROUPS = [
    { id: "title", from: 1, to: 2 },
    { id: "writer", from: 3, to: 7 },
    { id: "photographer", from: 8, to: 11 },
    { id: "vet", from: 12, to: 16 },
    { id: "cook", from: 17, to: 21 },
    { id: "footer", from: 22, to: 24 },
  ];

  function parsePassages(markdown) {
    const lines = [];
    const pattern = /^\*\*\(line (\d+)\)\*\*\s*(.*)$/gm;
    let match;
    while ((match = pattern.exec(markdown))) {
      lines.push({
        line: Number(match[1]),
        text: match[2].replace(/\s+$/g, "").replace(/^\s+/g, ""),
      });
    }
    if (lines.length !== 24) {
      throw new Error("Passage file is missing the numbered lines.");
    }
    return {
      title: "Bright Days Job Fair",
      lines: lines,
    };
  }

  return {
    GROUPS: GROUPS,
    parsePassages: parsePassages,
  };
});
