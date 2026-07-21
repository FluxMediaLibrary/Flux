import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rokuRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.resolve(rokuRoot, "../../node_modules/@rokucommunity/brs/bin/cli.js");
const files = [
  "source/Utils.brs",
  "source/FeatureFlagManager.brs",
  "source/Logger.brs",
  "source/NavigationController.brs",
  "source/PlaybackManager.brs",
  "source/RegistryManager.brs",
  "tests/unit.brs",
].map((file) => path.resolve(rokuRoot, file));

const result = spawnSync(process.execPath, [cli, ...files], {
  cwd: path.resolve(rokuRoot, "tests"),
  encoding: "utf8",
});

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");

if (result.error) {
  console.error(`Unable to run the BrightScript test interpreter: ${result.error.message}`);
  process.exit(1);
}

const match = (result.stdout ?? "").match(/FLUX_TEST_FAILURES=\s*(\d+)/);
if (result.status !== 0 || !match || Number(match[1]) !== 0) {
  console.error("Roku unit tests failed or did not report a result.");
  process.exit(1);
}

console.log("Roku unit tests passed.");

const navigationContracts = {
  HomeScreen: ["mediaSelected", "heroActionSelected", "destinationSelected", "rowRetryRequested"],
  LibraryScreen: ["mediaSelected", "pageChangeRequested", "sortRequested", "watchedRequested", "genreRequested", "backRequested"],
  SearchScreen: ["queryChanged", "mediaSelected", "recentSelected", "voiceQuery"],
  DetailsScreen: ["playSelected", "mediaSelected", "seasonSelected", "backRequested", "trailerRequested"],
  SeasonScreen: ["episodeSelected", "backRequested", "focusIndex"],
  EpisodeScreen: ["playSelected", "backRequested"],
  PlayerScreen: ["progressEvent", "stopped", "nextRequested", "audioTrackSelected", "subtitleTrackSelected", "qualitySelected"],
  SettingsScreen: ["actionSelected"],
  ProfileSelectionScreen: ["profileSelected"],
  DeviceLinkScreen: ["retryRequested"],
  ServerSetupScreen: ["serverSubmitted"],
  RequestsScreen: ["backRequested"],
  MessageScreen: ["actionSelected"],
};

let navigationFailures = 0;
for (const [name, fields] of Object.entries(navigationContracts)) {
  const xmlPath = path.join(rokuRoot, "components", "screens", `${name}.xml`);
  const brsPath = path.join(rokuRoot, "components", "screens", `${name}.brs`);
  const xml = fs.readFileSync(xmlPath, "utf8");
  const focusId = xml.match(/initialFocus="([^"]+)"/)?.[1];
  if (!focusId || !new RegExp(`\\bid="${focusId}"`).test(xml)) {
    console.error(`FAIL: ${name} does not declare a resolvable initialFocus node`);
    navigationFailures += 1;
  }
  if (!fs.existsSync(brsPath)) {
    console.error(`FAIL: ${name} has no paired BrightScript controller`);
    navigationFailures += 1;
  } else {
    const brs = fs.readFileSync(brsPath, "utf8");
    const nodeIds = [...xml.matchAll(/\bid="([A-Za-z][A-Za-z0-9_]*)"/g)].map((match) => match[1]);
    for (const nodeId of nodeIds) {
      if (new RegExp(`\\bm\\.${nodeId}\\s*\\.`).test(brs)
        && !new RegExp(`\\bm\\.${nodeId}\\s*=\\s*m\\.top\\.findNode\\(["']${nodeId}["']\\)`, "i").test(brs)) {
        console.error(`FAIL: ${name} uses m.${nodeId} without caching the ${nodeId} node`);
        navigationFailures += 1;
      }
    }
  }
  for (const field of fields) {
    if (!new RegExp(`<field\\s+id="${field}"`).test(xml)) {
      console.error(`FAIL: ${name} is missing navigation contract field ${field}`);
      navigationFailures += 1;
    }
  }
}

if (navigationFailures > 0) {
  console.error(`Roku navigation contracts failed: ${navigationFailures} issue(s).`);
  process.exit(1);
}
console.log(`Roku navigation contracts passed: ${Object.keys(navigationContracts).length} interactive screens.`);
