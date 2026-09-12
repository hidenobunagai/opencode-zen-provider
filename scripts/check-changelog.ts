import * as fs from "fs";
import * as path from "path";

export type VersionSection = {
  version: string;
  date?: string;
};

export type SectionProblems = {
  duplicates: string[];
  outOfOrder: string[];
};

/**
 * Collect every "## [X.Y.Z] - YYYY-MM-DD" heading: the whole version history must stay
 * unique and newest-first, otherwise a rebase silently produces two sections with the
 * same version (as happened with 0.1.43) and later edits reorder the file unnoticed.
 */
export function parseHeadings(changelog: string): VersionSection[] {
  const headingRegex = /^##\s*\[\s*(\d+\.\d+\.\d+)\s*\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/gm;
  return [...changelog.matchAll(headingRegex)].map((match) => ({
    version: match[1],
    date: match[2],
  }));
}

export function findSectionProblems(headings: VersionSection[]): SectionProblems {
  const compareVersions = (a: string, b: string) => {
    const [aMajor, aMinor, aPatch] = a.split(".").map(Number);
    const [bMajor, bMinor, bPatch] = b.split(".").map(Number);
    return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
  };

  const seenVersions = new Set<string>();
  const duplicates = headings
    .map((heading) => heading.version)
    .filter((seen) => (seenVersions.has(seen) ? true : (seenVersions.add(seen), false)));
  const outOfOrder = headings.slice(1).flatMap((heading, index) => {
    const previous = headings[index];
    if (compareVersions(heading.version, previous.version) > 0) {
      return [`## [${heading.version}] appears after ## [${previous.version}]`];
    }
    if (previous.date && heading.date && heading.date > previous.date) {
      return [
        `## [${heading.version}] is dated ${heading.date}, after ## [${previous.version}] dated ${previous.date}`,
      ];
    }
    return [];
  });

  return { duplicates, outOfOrder };
}

function main() {
  const workspaceDir = path.resolve(__dirname, "..");
  const packageJsonPath = path.join(workspaceDir, "package.json");
  const changelogPath = path.join(workspaceDir, "CHANGELOG.md");

  if (!fs.existsSync(packageJsonPath)) {
    console.error(`Error: package.json not found at ${packageJsonPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(changelogPath)) {
    console.error(`Error: CHANGELOG.md not found at ${changelogPath}`);
    process.exit(1);
  }

  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (err) {
    console.error(
      `Error parsing package.json: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  const version = packageJson.version;
  if (!version) {
    console.error("Error: 'version' field not found in package.json");
    process.exit(1);
  }

  const changelog = fs.readFileSync(changelogPath, "utf8");
  const headings = parseHeadings(changelog);
  const { duplicates, outOfOrder } = findSectionProblems(headings);

  if (duplicates.length > 0 || outOfOrder.length > 0) {
    console.error(
      "================================================================================",
    );
    console.error(
      "❌ RELEASE CHECK FAILED: CHANGELOG.md version sections are duplicated or unsorted",
    );
    console.error(
      "================================================================================",
    );
    for (const duplicated of duplicates) {
      console.error(`Duplicate section: ## [${duplicated}] appears more than once.`);
    }
    for (const problem of outOfOrder) {
      console.error(`Not in descending order: ${problem}.`);
    }
    console.error("Each version must appear exactly once, in descending version and date order.");
    console.error(
      "================================================================================",
    );
    process.exit(1);
  }

  if (!headings.some((heading) => heading.version === version)) {
    console.error(
      "================================================================================",
    );
    console.error("❌ RELEASE CHECK FAILED: package.json version is ahead of CHANGELOG.md");
    console.error(
      "================================================================================",
    );
    console.error(`Current package.json version: ${version}`);
    console.error(`No entry found in CHANGELOG.md for version [${version}].`);
    console.error(`Please update CHANGELOG.md with release notes in the following format:`);
    console.error(`  ## [${version}] - YYYY-MM-DD`);
    console.error(
      "================================================================================",
    );
    process.exit(1);
  }

  console.log(`✅ Release check passed: CHANGELOG.md contains entry for version ${version}.`);
  process.exit(0);
}

if (require.main === module) {
  main();
}
