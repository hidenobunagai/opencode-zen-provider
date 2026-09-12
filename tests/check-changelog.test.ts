import { findSectionProblems, parseHeadings } from "../scripts/check-changelog";

const section = (version: string, date: string) =>
  `## [${version}] - ${date}\n\n### Fixed\n\n- something\n\n`;

describe("check-changelog", () => {
  it("parses version sections and ignores other headings", () => {
    const changelog = `# Changelog\n\n${section("0.1.49", "2025-09-12")}## [Unreleased]\n\n- wip\n`;
    expect(parseHeadings(changelog)).toEqual([{ version: "0.1.49", date: "2025-09-12" }]);
  });

  it("accepts unique sections in descending version and date order", () => {
    const changelog =
      section("0.1.49", "2025-09-12") +
      section("0.1.48", "2025-09-12") +
      section("0.1.47", "2025-09-11");
    expect(findSectionProblems(parseHeadings(changelog))).toEqual({
      duplicates: [],
      outOfOrder: [],
    });
  });

  it("detects a duplicated version section", () => {
    const changelog = section("0.1.43", "2025-08-30") + section("0.1.43", "2025-08-30");
    const problems = findSectionProblems(parseHeadings(changelog));
    expect(problems.duplicates).toEqual(["0.1.43"]);
    expect(problems.outOfOrder).toEqual([]);
  });

  it("detects a version that reappears below an older one", () => {
    const changelog = section("0.1.48", "2025-09-12") + section("0.1.49", "2025-09-13");
    const problems = findSectionProblems(parseHeadings(changelog));
    expect(problems.outOfOrder).toEqual(["## [0.1.49] appears after ## [0.1.48]"]);
  });

  it("detects a section dated after the newer section above it", () => {
    const changelog = section("0.1.49", "2025-09-10") + section("0.1.48", "2025-09-12");
    const problems = findSectionProblems(parseHeadings(changelog));
    expect(problems.outOfOrder).toEqual([
      "## [0.1.48] is dated 2025-09-12, after ## [0.1.49] dated 2025-09-10",
    ]);
  });
});
