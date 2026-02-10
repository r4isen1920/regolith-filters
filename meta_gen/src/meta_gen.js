const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const settings = {
	outputFile: "Meta.ts",
	syncVersionFromTag: false,
};

if (process.argv[2]) {
	const parsedSettings = JSON.parse(process.argv[2]);
	Object.assign(settings, parsedSettings);
}

if (!settings.outputFile) {
	console.warn(
		"No output file specified. Please specify an output file in the settings.",
	);
	return;
}

// Initial configuration for running script from the project root directory
let packsPath = "./packs/";
let gametestsPath = "./packs/data/gametests/";
// If the script is run as a regolith filter
if (
	process.env.ROOT_DIR &&
	fs.existsSync(process.env.ROOT_DIR + "/config.json")
) {
	let config = JSON.parse(
		fs.readFileSync(process.env.ROOT_DIR + "/config.json", "utf8"),
	);
	packsPath = "./";
	gametestsPath = path.normalize(
		process.env.ROOT_DIR + "/" + config.regolith.dataPath + "/gametests/",
	);
}

if (!fs.existsSync(gametestsPath)) {
	console.warn(
		"Could not find gametests directory. Please make sure the gametests directory is present in the dataPath",
	);
	return;
}

// Helper function to load JSON file
function loadJsonFile(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch (error) {
		return null;
	}
}

// Helper function to parse and validate semver tag
function parseSemverTag(tag) {
	if (!tag) return null;

	// Remove 'v' prefix if present
	const version = tag.startsWith("v") ? tag.slice(1) : tag;

	// Validate semver format (major.minor.patch)
	const semverRegex = /^(\d+)\.(\d+)\.(\d+)$/;
	const match = version.match(semverRegex);

	if (!match) return null;

	return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

// Helper function to get git information
function getGitInfo() {
	const gitInfo = {
		commit: null,
		tag: null,
	};

	try {
		// Check if we're in a git repository
		const isGitRepo = execSync("git rev-parse --git-dir", {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		});

		if (isGitRepo) {
			// Get latest commit hash
			try {
				gitInfo.commit = execSync("git rev-parse HEAD", {
					encoding: "utf8",
				}).trim();
			} catch (e) {
				// No commits yet or git not available
			}

			// Get latest tag
			try {
				const rawTag = execSync("git describe --tags --abbrev=0", {
					encoding: "utf8",
				}).trim();

				// Validate and parse semver
				const parsedVersion = parseSemverTag(rawTag);
				if (parsedVersion) {
					gitInfo.tag = rawTag;
				}
			} catch (e) {
				// No tags available
			}
		}
	} catch (error) {
		// Not a git repository or git not available
	}

	return gitInfo;
}

// Get manifest data
const manifestData = {
	bp: {
		version: null,
		min_engine_version: null,
		manifest: null,
		path: null,
	},
	rp: {
		version: null,
		min_engine_version: null,
		manifest: null,
		path: null,
	},
};

// Load BP manifest
const bpManifestPath = path.join(packsPath, "BP/manifest.json");
if (fs.existsSync(bpManifestPath)) {
	const bpManifest = loadJsonFile(bpManifestPath);
	if (bpManifest && bpManifest.header) {
		manifestData.bp.version = bpManifest.header.version;
		manifestData.bp.min_engine_version = bpManifest.header.min_engine_version;
		manifestData.bp.manifest = bpManifest;
		manifestData.bp.path = bpManifestPath;
	}
}

// Load RP manifest
const rpManifestPath = path.join(packsPath, "RP/manifest.json");
if (fs.existsSync(rpManifestPath)) {
	const rpManifest = loadJsonFile(rpManifestPath);
	if (rpManifest && rpManifest.header) {
		manifestData.rp.version = rpManifest.header.version;
		manifestData.rp.min_engine_version = rpManifest.header.min_engine_version;
		manifestData.rp.manifest = rpManifest;
		manifestData.rp.path = rpManifestPath;
	}
}

// Get git information
const gitInfo = getGitInfo();

// Sync version from git tag if enabled and tag is valid
if (settings.syncVersionFromTag && gitInfo.tag) {
	const parsedVersion = parseSemverTag(gitInfo.tag);
	if (parsedVersion) {
		// Update in-memory version data
		manifestData.bp.version = parsedVersion;
		manifestData.rp.version = parsedVersion;

		// Resolve cross-pack UUIDs for dependency updates
		const bpUuid = manifestData.bp.manifest?.header?.uuid || null;
		const rpUuid = manifestData.rp.manifest?.header?.uuid || null;

		// Write back to BP manifest file
		if (manifestData.bp.manifest && manifestData.bp.path) {
			updateManifestVersions(manifestData.bp.manifest, parsedVersion, rpUuid);
			const bpContent = JSON.stringify(manifestData.bp.manifest, null, "\t");
			fs.writeFileSync(manifestData.bp.path, bpContent, "utf8");
			mirrorToTmp(manifestData.bp.path, bpContent);
			console.log(`Updated BP manifest version to ${parsedVersion.join(".")}`);
		}

		// Write back to RP manifest file
		if (manifestData.rp.manifest && manifestData.rp.path) {
			updateManifestVersions(manifestData.rp.manifest, parsedVersion, bpUuid);
			const rpContent = JSON.stringify(manifestData.rp.manifest, null, "\t");
			fs.writeFileSync(manifestData.rp.path, rpContent, "utf8");
			mirrorToTmp(manifestData.rp.path, rpContent);
			console.log(`Updated RP manifest version to ${parsedVersion.join(".")}`);
		}
	}
}

// Helper function to format value for export
function formatValue(value) {
	if (value === null || value === undefined) return "undefined";
	if (Array.isArray(value)) return `[${value.join(", ")}]`;
	if (typeof value === "string") return `"${value}"`;
	return String(value);
}

// Helper function to mirror a file write to .regolith/tmp/
function mirrorToTmp(filePath, fileContent) {
	if (!process.env.ROOT_DIR) return;
	const packsAbsolute = path.resolve(process.env.ROOT_DIR, "packs");
	const relativeFromPacks = path.relative(
		packsAbsolute,
		path.resolve(filePath),
	);
	if (relativeFromPacks.startsWith("..")) return;
	const tmpPath = path.join(
		process.env.ROOT_DIR,
		".regolith",
		"tmp",
		relativeFromPacks,
	);
	const tmpDir = path.dirname(tmpPath);
	if (!fs.existsSync(tmpDir)) {
		fs.mkdirSync(tmpDir, { recursive: true });
	}
	fs.writeFileSync(tmpPath, fileContent, "utf8");
	console.log(
		`Mirrored to temp folder: ${path.relative(process.env.ROOT_DIR, tmpPath)}`,
	);
}

// Helper function to update all versions in a manifest (header, modules, dependencies)
function updateManifestVersions(manifest, newVersion, crossPackUuid) {
	// Update header version
	manifest.header.version = newVersion;

	// Update modules versions
	if (Array.isArray(manifest.modules)) {
		for (const mod of manifest.modules) {
			mod.version = newVersion;
		}
	}

	// Update dependencies that reference the other pack (by UUID)
	if (Array.isArray(manifest.dependencies) && crossPackUuid) {
		for (const dep of manifest.dependencies) {
			if (dep.uuid === crossPackUuid) {
				dep.version = newVersion;
			}
		}
	}
}

// Generate the .ts content
let content = `/**
 *? Generated by meta_gen filter
 *! Edits will be discrded!
 */

/**
 * Contains meta information about the pack, such as version and git info.
 * This information is generated at build time and can be used in the code to display version info or for debugging purposes.
 */
const Meta = {
  manifest: {
    bp: {
      version: ${formatValue(manifestData.bp.version)},
      min_engine_version: ${formatValue(manifestData.bp.min_engine_version)},
    },
    rp: {
      version: ${formatValue(manifestData.rp.version)},
      min_engine_version: ${formatValue(manifestData.rp.min_engine_version)},
    },
  },
  github: {
    commit: ${formatValue(gitInfo.commit)},
    tag: ${formatValue(gitInfo.tag)},
  },
} as const;

export default Meta;
`;

// Write to .ts file
const outputFilePath = path.join(gametestsPath, "src", settings.outputFile);

let existingContent = "";
if (fs.existsSync(outputFilePath)) {
	existingContent = fs.readFileSync(outputFilePath, "utf8");
}

if (existingContent !== content) {
	// Ensure the directory exists
	const outputDir = path.dirname(outputFilePath);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	fs.writeFileSync(outputFilePath, content, "utf8");
	console.log(
		`Meta file written to ${path.relative(process.env.ROOT_DIR || ".", outputFilePath)}`,
	);

	// Also write to .regolith/tmp/ so regolith picks up the file on compilation
	mirrorToTmp(outputFilePath, content);
}
