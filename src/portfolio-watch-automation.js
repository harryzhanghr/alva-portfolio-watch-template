// @ts-nocheck
const http = require("net/http");
const alfs = require("alfs");
const secret = require("secret-manager");
const { ask } = require("@alva/alvaask");
const { Feed, feedPath, makeDoc, str, num } = require("@alva/feed");
const env = require("env");

const ARGS = (env && env.args) || {};
const TECHNICAL_EVENT_ARGS = ARGS.technicalEvents && typeof ARGS.technicalEvents === "object" ? ARGS.technicalEvents : {};
const RATE_REPRICING_EVENT_ARGS = ARGS.rateRepricingEvents && typeof ARGS.rateRepricingEvents === "object" ? ARGS.rateRepricingEvents : {};
const BREAKING_NEWS_ARGS = ARGS.breakingNews && typeof ARGS.breakingNews === "object" ? ARGS.breakingNews : {};
const DEFAULT_TECHNICAL_EVENT_DETECTORS = ["breakout", "support_resistance", "rsi", "ma_cross", "volume_price"];
const TECHNICAL_SEVERITY_RANK = { low: 1, medium: 2, high: 3 };
const FEED_NAME = ARGS.feedName || "portfolio-watch-automation";
const ACCOUNT_ID = ARGS.accountId || ARGS.connectedAccountId || "";
const ACCOUNT_IDS = normalizeAccountIds(ARGS.accountIds || ARGS.connectedAccountIds || ARGS.portfolioAccountIds || ACCOUNT_ID);
const OWNER_USERNAME = ARGS.ownerUsername || ARGS.username || "";
const ALFS_USERNAME = (env && env.username) || OWNER_USERNAME || "";
const PORTFOLIO_MODE = normalizePortfolioMode(ARGS.portfolioMode || (ARGS.staticPortfolioPath ? "static" : "dynamic"));
const STATIC_PORTFOLIO_PATH = ARGS.staticPortfolioPath || "";
const CONFIGURED_POSITION_COMPLETENESS = normalizePositionCompleteness(ARGS.positionCompleteness || "");
const RUN_SOURCE = ARGS.runSource || "manual_or_unspecified";
const ALVA_API_BASE = ARGS.alvaApiBase || "https://api-llm.prd.alva.ai";
const ARRAYS_BASE = "https://data-tools.prd.space.id";
const SKIP = "<|SKIP_NOTIFICATION|>";

const CONFIG = {
  timezone: "Asia/Hong_Kong",
  snapshotMarkVersion: "arrays_current_value_v2_latest_1min",
  priceSignalVersion: "asset_anomaly_v5_latest_1min_z2_no_5d_trigger",
  volumeSignalVersion: "hourly_cumulative_volume_v3_us_equity_rth",
  anomalyAttributionVersion: "per_asset_alva_ask_why_the_move_v1",
  themeExtractionVersion: "portfolio_theme_extraction_v2_pi",
  latestPriceInterval: "1min",
  latestPriceLookbackHours: 36,
  latestPriceLimit: 2400,
  breakingNewsEnabled: true,
  breakingNewsSourceMode: String(ARGS.breakingNewsSourceMode || BREAKING_NEWS_ARGS.sourceMode || "external_feed").toLowerCase(),
  externalBreakingNewsFeedPath: String(ARGS.externalBreakingNewsFeedPath || BREAKING_NEWS_ARGS.feedPath || "~/feeds/breaking-news/v1/data/events/current"),
  externalBreakingNewsLookbackMinutes: numericArg(ARGS.externalBreakingNewsLookbackMinutes || BREAKING_NEWS_ARGS.lookbackMinutes, 180),
  externalBreakingNewsMaxRows: numericArg(ARGS.externalBreakingNewsMaxRows || BREAKING_NEWS_ARGS.maxRows, 160),
  externalBreakingNewsMaxMappedEvents: numericArg(ARGS.externalBreakingNewsMaxMappedEvents || BREAKING_NEWS_ARGS.maxMappedEvents, 40),
  externalBreakingNewsPiReviewEnabled: parseBoolArg(ARGS.externalBreakingNewsPiReviewEnabled !== undefined ? ARGS.externalBreakingNewsPiReviewEnabled : BREAKING_NEWS_ARGS.piReviewEnabled, true),
  externalBreakingNewsPiMaxEvents: numericArg(ARGS.externalBreakingNewsPiMaxEvents || BREAKING_NEWS_ARGS.piMaxEvents, 40),
  externalBreakingNewsPiChunkSize: numericArg(ARGS.externalBreakingNewsPiChunkSize || BREAKING_NEWS_ARGS.piChunkSize, 20),
  externalBreakingNewsPiRetryCount: numericArg(ARGS.externalBreakingNewsPiRetryCount || BREAKING_NEWS_ARGS.piRetryCount, 1),
  externalBreakingNewsIncludeHidden: parseBoolArg(ARGS.externalBreakingNewsIncludeHidden !== undefined ? ARGS.externalBreakingNewsIncludeHidden : BREAKING_NEWS_ARGS.includeHidden, false),
  maxBreakingNewsRecords: 30,
  maxBreakingNewsBraveCalls: 2,
  indexedXLookbackMinutes: 90,
  maxIndexedXTweetsFetch: 200,
  maxIndexedXTweetFetchPages: 5,
  maxIndexedXTweetsForPi: 50,
  maxTopicNewsToolCalls: 24,
  maxTopicNewsRowsPerTopic: 100,
  maxTopicNewsToolResultChars: 80000,
  maxThemeNewsRowsPerQuery: 5,
  maxThemeNewsSearchAttemptsPerTheme: 2,
  portfolioSnapshotStaleWarningHours: 12,
  eventOverlapMinutes: 30,
  defaultWindowMinutes: 90,
  firstRunWindowHours: 24,
  earningsCandidateLookaheadDays: 10,
  maxPromptEvents: 100,
  maxPromptCandidates: 100,
  maxAnalystPromptChars: 1000000,
  maxAnomalyAttributionPromptChars: 1000000,
  maxPiPromptContextChars: 1000000,
  portfolioWatchPreferencesEnabled: parseBoolArg(ARGS.portfolioWatchPreferencesEnabled, true),
  portfolioWatchPreferencesPath: String(ARGS.portfolioWatchPreferencesPath || "~/portfolio-watch/portfolio_watch_preferences.md"),
  portfolioWatchPreferencesMaxChars: numericArg(ARGS.portfolioWatchPreferencesMaxChars, 30000),
  timeouts: {
    runBudgetMs: numericArg(ARGS.runBudgetMs || (ARGS.timeouts && ARGS.timeouts.runBudgetMs), 45 * 60 * 1000),
    themeExtractionMs: numericArg(ARGS.themeExtractionTimeoutMs || (ARGS.timeouts && ARGS.timeouts.themeExtractionMs), 12 * 60 * 1000),
    externalBreakingMappingMs: numericArg(ARGS.externalBreakingMappingTimeoutMs || (ARGS.timeouts && ARGS.timeouts.externalBreakingMappingMs), 20 * 60 * 1000),
    internalBreakingNewsMs: numericArg(ARGS.internalBreakingNewsTimeoutMs || (ARGS.timeouts && ARGS.timeouts.internalBreakingNewsMs), 20 * 60 * 1000),
    anomalyAttributionMs: numericArg(ARGS.anomalyAttributionTimeoutMs || (ARGS.timeouts && ARGS.timeouts.anomalyAttributionMs), 15 * 60 * 1000),
    analystMs: numericArg(ARGS.analystTimeoutMs || (ARGS.timeouts && ARGS.timeouts.analystMs), 20 * 60 * 1000),
    analystRepairMs: numericArg(ARGS.analystRepairTimeoutMs || (ARGS.timeouts && ARGS.timeouts.analystRepairMs), 6 * 60 * 1000),
  },
  priorAlertTimelineDays: 7,
  maxPriorAlertTimelineRows: 200,
  maxAlertHistoryRows: 240,
  eventSourceLimits: {
    marketNewsFetch: 50,
    priceTargetFetch: 50,
  },
  technicalEvents: {
    enabled: parseBoolArg(ARGS.technicalEventsEnabled !== undefined ? ARGS.technicalEventsEnabled : TECHNICAL_EVENT_ARGS.enabled, true),
    minSeverity: String((ARGS.technicalEventMinSeverity !== undefined ? ARGS.technicalEventMinSeverity : TECHNICAL_EVENT_ARGS.minSeverity) || "medium").toLowerCase(),
    detectors: parseTechnicalDetectors(ARGS.technicalEventDetectors !== undefined ? ARGS.technicalEventDetectors : TECHNICAL_EVENT_ARGS.detectors),
    lookbackDailyBars: numericArg(ARGS.technicalEventLookbackDailyBars !== undefined ? ARGS.technicalEventLookbackDailyBars : TECHNICAL_EVENT_ARGS.lookbackDailyBars, 260),
    breakoutLookbackDays: numericArg(TECHNICAL_EVENT_ARGS.breakoutLookbackDays, 20),
    longBreakoutLookbackDays: numericArg(TECHNICAL_EVENT_ARGS.longBreakoutLookbackDays, 55),
    supportResistanceLookbackDays: numericArg(TECHNICAL_EVENT_ARGS.supportResistanceLookbackDays, 60),
    supportResistanceTouches: numericArg(TECHNICAL_EVENT_ARGS.supportResistanceTouches, 2),
    levelBufferPct: numericArg(TECHNICAL_EVENT_ARGS.levelBufferPct, 0.005),
    atrPeriod: numericArg(TECHNICAL_EVENT_ARGS.atrPeriod, 14),
    atrBufferMultiple: numericArg(TECHNICAL_EVENT_ARGS.atrBufferMultiple, 0.25),
    rsiPeriod: numericArg(TECHNICAL_EVENT_ARGS.rsiPeriod, 14),
    rsiOverbought: numericArg(TECHNICAL_EVENT_ARGS.rsiOverbought, 70),
    rsiOversold: numericArg(TECHNICAL_EVENT_ARGS.rsiOversold, 30),
    maFastPeriod: numericArg(TECHNICAL_EVENT_ARGS.maFastPeriod, 50),
    maSlowPeriod: numericArg(TECHNICAL_EVENT_ARGS.maSlowPeriod, 200),
    shortMaFastPeriod: numericArg(TECHNICAL_EVENT_ARGS.shortMaFastPeriod, 20),
    shortMaSlowPeriod: numericArg(TECHNICAL_EVENT_ARGS.shortMaSlowPeriod, 50),
    volumeLookbackDays: numericArg(TECHNICAL_EVENT_ARGS.volumeLookbackDays, 20),
    volumeMultiple: numericArg(TECHNICAL_EVENT_ARGS.volumeMultiple, 1.5),
    volumePriceMovePct: numericArg(TECHNICAL_EVENT_ARGS.volumePriceMovePct, 3),
    maxEventsPerHolding: numericArg(TECHNICAL_EVENT_ARGS.maxEventsPerHolding, 6),
  },
  rateRepricingEvents: {
    enabled: parseBoolArg(ARGS.rateRepricingEventsEnabled !== undefined ? ARGS.rateRepricingEventsEnabled : RATE_REPRICING_EVENT_ARGS.enabled, true),
    probabilityChangeThresholdPct: numericArg(ARGS.rateRepricingProbabilityChangeThresholdPct !== undefined ? ARGS.rateRepricingProbabilityChangeThresholdPct : RATE_REPRICING_EVENT_ARGS.probabilityChangeThresholdPct, 10),
  },
  decisionLens: {
    enabled: parseBoolArg(ARGS.decisionLensEnabled !== undefined ? ARGS.decisionLensEnabled : true, true),
    mode: String(ARGS.decisionLensMode || "framed_insight").toLowerCase(),
  },
  portfolioMode: PORTFOLIO_MODE,
  positionCompleteness: CONFIGURED_POSITION_COMPLETENESS,
  staticPortfolioPath: STATIC_PORTFOLIO_PATH,
  materiality: {
    quantityEpsilon: 0.00001,
    positionMvMovePct: 0.03,
    positionMvMoveUsd: 25000,
    allocationMovePts: 0.015,
    portfolioValueMovePct: 0.015,
    portfolioValueMoveUsd: 50000,
    cashMoveUsd: 25000,
    cashMovePts: 0.03,
    priceOneDayPct: 5,
    priceZScore: 2,
    cumulativeVolumeMultiple: 2,
    volumeMinBaselineSamples: 3,
    volumeLookbackSamples: 24,
    minAllocationForEvent: 0.02,
    minAllocationForNews: 0.03,
    portfolioMoveContributionPts: 0.0025,
    themeExposureHigh: 0.35,
    themeExposureChangePts: 0.02,
  },
  fallbackThemeMap: ARGS.fallbackThemeMap || {},
  aliases: ARGS.aliases || {},
};

const RATE_REPRICING_LOOKBACK_HOURS = 24;
const RATE_REPRICING_NEWS_LIMIT = 3;
const RATE_REPRICING_DECISION_COUNT = 3;
const POLYMARKET_GAMMA_BASE = "https://gamma-api.polymarket.com";
const POLYMARKET_CLOB_BASE = "https://clob.polymarket.com";

const SUPPORTED_MARKET_NEWS_TOPICS = [
  "BLOCKCHAIN",
  "EARNINGS",
  "ECONOMY_FISCAL",
  "ECONOMY_MACRO",
  "ECONOMY_MONETARY",
  "ENERGY_TRANSPORTATION",
  "FINANCE",
  "FINANCIAL_MARKETS",
  "IPO",
  "LIFE_SCIENCES",
  "MANUFACTURING",
  "MERGERS_AND_ACQUISITIONS",
  "REAL_ESTATE",
  "RETAIL_WHOLESALE",
  "TECHNOLOGY",
];

const feed = new Feed({
  path: feedPath(FEED_NAME),
  name: "Portfolio Watch Automation",
  description:
    "Hourly portfolio analyst that supports dynamic connected snapshots or static portfolios, persists portfolio state, event records, event/anomaly assessments, and quiet-run notification decisions.",
});

feed.def("portfolio", {
	  snapshot: makeDoc("Portfolio Snapshot", "Run-level normalized portfolio state, deltas, and exposure context", [
	    str("accountId"),
	    str("portfolioMode"),
	    str("positionCompleteness"),
	    str("ingestSource"),
	    num("totalValue"),
    num("cash"),
    num("cashAllocation"),
    num("holdingCount"),
    str("topHoldings"),
    str("portfolioDeltaJson"),
    str("themeExposureJson"),
    str("coverageWarningsJson"),
    str("rawJson"),
    num("asOfMs"),
    num("runAtMs"),
  ]),
	  positions: makeDoc("Portfolio Positions", "Per-position normalized state for the current run", [
	    str("accountId"),
	    str("portfolioMode"),
	    str("positionCompleteness"),
	    str("instrumentId"),
    str("symbol"),
    str("assetClass"),
    str("side"),
    num("quantity"),
    num("currentPrice"),
    num("marketValue"),
    num("weight"),
    str("currency"),
    str("instrumentDetailsJson"),
	    str("themesJson"),
	    str("positionSizeAvailable"),
	    num("runAtMs"),
	  ]),
});

feed.def("event", {
  items: makeDoc("Event Items", "Normalized source records used by the automation", [
    str("eventKey"),
    str("sourceType"),
    str("symbol"),
    str("title"),
    str("summary"),
    str("url"),
    str("source"),
    str("dedupeStatus"),
    str("metadataJson"),
    num("publishedAtMs"),
    num("firstSeenAtMs"),
    num("lastSeenAtMs"),
    num("runAtMs"),
  ]),
});

feed.def("finding", {
  records: makeDoc("Analyst Assessments", "Event-impact assessments and anomaly attributions with selected/suppressed outcomes", [
    str("findingId"),
    str("findingType"),
    str("primaryAsset"),
    str("summary"),
    str("dedupeKey"),
    str("selected"),
    str("suppressionReason"),
    str("payloadJson"),
    num("runAtMs"),
  ]),
});

feed.def("analysis", {
	  decision: makeDoc("Alert Decision", "Final low-noise notification decision and run context", [
	    str("accountId"),
	    str("portfolioMode"),
	    str("positionCompleteness"),
	    str("runSource"),
    str("alertDecision"),
    str("urgency"),
    str("reason"),
    str("skipReason"),
    str("notificationMessage"),
    str("selectedFindingIdsJson"),
    str("suppressedFindingIdsJson"),
    str("messageSectionsJson"),
    str("currentPortfolioDeltaJson"),
    str("priorAlertHistoryJson"),
    str("rawEventsJson"),
    str("eventCandidatesJson"),
    str("qualifiedEventsJson"),
    str("selectedEventsJson"),
    str("anomaliesJson"),
    str("anomalyAttributionPacketsJson"),
    str("anomalyAttributionsJson"),
    str("finalStatusesJson"),
    str("searchExpansionTraceJson"),
    str("candidateSummaryJson"),
    str("candidateAuditJson"),
    str("anomalySignalsJson"),
    str("rawAnalystJson"),
    str("analystDecisionJson"),
    str("analystPromptCoverageJson"),
    str("portfolioWatchPreferencesJson"),
    num("runAtMs"),
  ]),
});

feed.def("notify", {
  message: makeDoc("Notification Message", "Push sidecar; quiet runs emit the skip sentinel", [
    str("title"),
    str("body"),
  ]),
});

feed.def("audit", {
	  run_log: makeDoc("Run Audit Log", "One row per automation run with replayable step-by-step processing details", [
	    str("accountId"),
	    str("portfolioMode"),
	    str("positionCompleteness"),
	    str("runSource"),
    str("status"),
    str("alertDecision"),
    str("shouldPush"),
    str("skipReason"),
    str("stepLogJson"),
    str("dataFetchSummaryJson"),
    str("llmDecisionJson"),
    str("outputSummaryJson"),
    str("persistSummaryJson"),
    str("rawEventsJson"),
    str("eventCandidatesJson"),
    str("qualifiedEventsJson"),
    str("selectedEventsJson"),
    str("anomaliesJson"),
    str("anomalyAttributionPacketsJson"),
    str("anomalyAttributionsJson"),
    str("finalStatusesJson"),
    str("searchExpansionTraceJson"),
    str("candidateAuditJson"),
    str("anomalySignalsJson"),
    str("analystDecisionJson"),
    str("analystPromptCoverageJson"),
    str("portfolioWatchPreferencesJson"),
    str("notificationPreview"),
    str("warningsJson"),
    num("runStartedAtMs"),
    num("runCompletedAtMs"),
    num("durationMs"),
    num("runAtMs"),
  ]),
	  persist_delta: makeDoc("Persist Delta", "Per-run append/update summary for each persisted feed output or KV state key", [
	    str("accountId"),
	    str("portfolioMode"),
	    str("positionCompleteness"),
	    str("runSource"),
    str("fileKey"),
    str("fileLabel"),
    str("storageType"),
    str("operation"),
    num("recordsAdded"),
    str("deltaSummary"),
    str("deltaJson"),
    str("latestPointerJson"),
    num("runAtMs"),
  ]),
});

function amount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && typeof value.amount === "number") return value.amount;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clean(value, maxLen) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!maxLen || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trim() + "...";
}

function cleanMultiline(value, maxLen) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!maxLen || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3).trim() + "...";
}

function parseBoolArg(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).toLowerCase().trim();
  if (text === "false" || text === "0" || text === "no" || text === "off") return false;
  if (text === "true" || text === "1" || text === "yes" || text === "on") return true;
  return fallback;
}

function numericArg(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizePortfolioMode(value) {
  const text = String(value || "").toLowerCase().trim();
  return text === "static" ? "static" : "dynamic";
}

function normalizePositionCompleteness(value) {
  const text = String(value || "").toLowerCase().trim().replace(/-/g, "_");
  if (text === "ticker_only" || text === "tickers_only" || text === "ticker") return "ticker_only";
  if (text === "full_quantity" || text === "quantity" || text === "full") return "full_quantity";
  return "";
}

function normalizeAccountIds(value) {
  const seen = {};
  const out = [];
  function add(item) {
    if (Array.isArray(item)) {
      item.forEach(add);
      return;
    }
    if (item === undefined || item === null) return;
    String(item).split(",").forEach((part) => {
      const text = String(part || "").trim();
      if (!text || seen[text]) return;
      seen[text] = true;
      out.push(text);
    });
  }
  add(value);
  return out;
}

function accountIdLabel(accountIds) {
  const ids = normalizeAccountIds(accountIds);
  if (!ids.length) return "";
  if (ids.length === 1) return ids[0];
  return "aggregate:" + ids.join(",");
}

function snapshotAccountId(snapshot) {
  return (snapshot && snapshot.accountId) || accountIdLabel(ACCOUNT_IDS) || ACCOUNT_ID || "";
}

function portfolioCapabilities(positionCompleteness) {
  const fullQuantity = positionCompleteness === "full_quantity";
  return {
    positionCompleteness,
    canComputeExposurePct: fullQuantity,
    canComputeNavDelta: fullQuantity,
    canComputePositionWeights: fullQuantity,
    canComputePortfolioMoveContribution: fullQuantity,
    canComputeThemeExposurePct: fullQuantity,
  };
}

function canComputePortfolioSizing(snapshot) {
  return !!(snapshot && snapshot.positionCompleteness === "full_quantity");
}

function resolveAlfsPath(path) {
  const raw = String(path || "").trim();
  if (!raw) return "";
  if (raw.indexOf("/alva/home/") === 0) return raw;
  if (raw.indexOf("~/") === 0) {
    if (!ALFS_USERNAME) throw new Error("Cannot resolve ~/ path without env.username or ownerUsername");
    return "/alva/home/" + ALFS_USERNAME + raw.slice(1);
  }
  return raw;
}

function simpleTextHash(text) {
  const raw = String(text || "");
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function compactPortfolioWatchPreferencesForAudit(preferences) {
  const row = preferences || {};
  return {
    enabled: !!row.enabled,
    loaded: !!row.loaded,
    path: row.path || "",
    chars: Number(row.chars) || 0,
    truncated: !!row.truncated,
    hash: row.hash || "",
    error: row.error || "",
  };
}

async function readPortfolioWatchPreferences(warnings) {
  const enabled = !!CONFIG.portfolioWatchPreferencesEnabled;
  const path = resolveAlfsPath(CONFIG.portfolioWatchPreferencesPath);
  const base = { enabled, loaded: false, path, chars: 0, truncated: false, hash: "", error: "", text: "" };
  if (!enabled || !path) return base;
  try {
    const rawText = String(await alfs.readFile(path) || "");
    let text = cleanMultiline(rawText);
    const originalChars = text.length;
    const truncated = CONFIG.portfolioWatchPreferencesMaxChars > 0 && text.length > CONFIG.portfolioWatchPreferencesMaxChars;
    if (truncated) text = text.slice(0, CONFIG.portfolioWatchPreferencesMaxChars - 3).trim() + "...";
    if (truncated && Array.isArray(warnings)) {
      warnings.push({
        source: "portfolio-watch-preferences",
        error: "preferences file truncated from " + originalChars + " to " + text.length + " chars for analyst input",
      });
    }
    return {
      enabled,
      loaded: !!text,
      path,
      chars: text.length,
      truncated,
      hash: text ? simpleTextHash(text) : "",
      error: "",
      text,
    };
  } catch (err) {
    const error = String(err && err.message ? err.message : err).slice(0, 260);
    if (!/not found|no such file|404/i.test(error) && Array.isArray(warnings)) {
      warnings.push({ source: "portfolio-watch-preferences", error: "optional preferences file not loaded: " + error });
    }
    return { ...base, error };
  }
}

function parseTechnicalDetectors(value) {
  const raw = Array.isArray(value)
    ? value
    : (value ? String(value).split(",") : DEFAULT_TECHNICAL_EVENT_DETECTORS);
  const allowed = {
    breakout: true,
    support_resistance: true,
    rsi: true,
    ma_cross: true,
    volume_price: true,
  };
  const out = [];
  raw.forEach((item) => {
    const key = String(item || "").trim().toLowerCase();
    if (allowed[key] && out.indexOf(key) < 0) out.push(key);
  });
  return out.length ? out : DEFAULT_TECHNICAL_EVENT_DETECTORS.slice();
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const m = Math.pow(10, digits);
  return Math.round(value * m) / m;
}

function fmtPct(value) {
  if (!Number.isFinite(value)) return "n/a";
  return (value * 100).toFixed(1) + "%";
}

function fmtMove(value) {
  if (!Number.isFinite(value)) return "n/a";
  return (value >= 0 ? "+" : "") + value.toFixed(1) + "%";
}

function fmtMoney(value) {
  if (!Number.isFinite(value)) return "n/a";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(2) + "m";
  if (abs >= 1e3) return sign + "$" + Math.round(abs / 1e3) + "k";
  return sign + "$" + abs.toFixed(0);
}

function hkt(ms) {
  if (!Number.isFinite(ms)) return "n/a";
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() + "-" +
    pad(d.getUTCMonth() + 1) + "-" +
    pad(d.getUTCDate()) + " " +
    pad(d.getUTCHours()) + ":" +
    pad(d.getUTCMinutes()) + " HKT"
  );
}

function sanitizeAlertTimelineRow(row) {
  row = row || {};
  const runAtMs = Number(row.runAtMs || row.date || row.timestamp || 0);
  if (!Number.isFinite(runAtMs) || runAtMs <= 0) return null;
  const explicitPush = row.userReceivedPush === true || row.user_received_push === true || row.alertDecision === "push";
  const rawMessage = cleanMultiline(row.notificationMessage || row.notification_message || row.messagePreview || row.message || "", 900);
  const userReceivedPush = !!(explicitPush && rawMessage);
  return {
    runAtMs,
    runAtHkt: row.runAtHkt || row.run_at_hkt || hkt(runAtMs),
    userReceivedPush,
    notificationMessage: userReceivedPush ? rawMessage : "",
    selectedFindingIds: userReceivedPush ? uniqueCompactStrings(row.selectedFindingIds || row.selected_finding_ids || [], 140) : [],
    selectedDedupeKeys: userReceivedPush ? uniqueCompactStrings(row.selectedDedupeKeys || row.selected_dedupe_keys || [], 180) : [],
    tickers: userReceivedPush ? uniqueSymbols(row.tickers || row.symbols || row.assets || []) : [],
    summary: userReceivedPush ? clean(row.summary || row.reason || "", 300) : "",
  };
}

function sanitizeAlertTimeline(history, runAtMs) {
  const cutoffMs = runAtMs - (CONFIG.priorAlertTimelineDays + 1) * 24 * 60 * 60 * 1000;
  const rows = (history || [])
    .map(sanitizeAlertTimelineRow)
    .filter((row) => row && row.runAtMs >= cutoffMs && row.runAtMs <= runAtMs + 5 * 60 * 1000)
    .sort((a, b) => a.runAtMs - b.runAtMs);
  return rows.slice(-CONFIG.maxAlertHistoryRows);
}

function priorAlertTimelineForAnalyst(history, runAtMs) {
  const cutoffMs = runAtMs - CONFIG.priorAlertTimelineDays * 24 * 60 * 60 * 1000;
  return sanitizeAlertTimeline(history, runAtMs)
    .filter((row) => row.runAtMs >= cutoffMs && row.runAtMs < runAtMs)
    .slice(-CONFIG.maxPriorAlertTimelineRows)
    .map((row) => ({
      runAtMs: row.runAtMs,
      runAtHkt: row.runAtHkt,
      userReceivedPush: row.userReceivedPush,
      notificationMessage: row.userReceivedPush ? row.notificationMessage : "",
      selectedFindingIds: row.userReceivedPush ? row.selectedFindingIds : [],
      selectedDedupeKeys: row.userReceivedPush ? row.selectedDedupeKeys : [],
      tickers: row.userReceivedPush ? row.tickers : [],
      summary: row.userReceivedPush ? row.summary : "",
    }));
}

function compactJson(value, maxLen) {
  let text = "{}";
  try {
    text = JSON.stringify(value);
  } catch (_) {
    text = "{}";
  }
  if (!maxLen || text.length <= maxLen) return text;
  const truncationNote = {
    truncated: true,
    originalType: Array.isArray(value) ? "array" : typeof value,
  };
  if (Array.isArray(value)) {
    const kept = [];
    for (const item of value) {
      const marker = {
        ...truncationNote,
        originalCount: value.length,
        omittedCount: Math.max(0, value.length - kept.length - 1),
      };
      const candidate = JSON.stringify([...kept, item, marker]);
      if (candidate.length > maxLen) break;
      kept.push(item);
    }
    const marker = {
      ...truncationNote,
      originalCount: value.length,
      omittedCount: Math.max(0, value.length - kept.length),
    };
    let result = JSON.stringify([...kept, marker]);
    while (result.length > maxLen && kept.length > 0) {
      kept.pop();
      marker.omittedCount = Math.max(0, value.length - kept.length);
      result = JSON.stringify([...kept, marker]);
    }
    if (result.length <= maxLen) return result;
    const markerOnly = JSON.stringify([marker]);
    return markerOnly.length <= maxLen ? markerOnly : "[]";
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    const out = {
      _truncated: true,
      _originalKeyCount: entries.length,
      _omittedKeyCount: entries.length,
    };
    for (const [key, val] of entries) {
      const candidate = { ...out, [key]: val };
      candidate._omittedKeyCount = Math.max(0, entries.length - Object.keys(candidate).length + 3);
      const candidateText = JSON.stringify(candidate);
      if (candidateText.length > maxLen) break;
      Object.assign(out, candidate);
    }
    const result = JSON.stringify(out);
    return result.length <= maxLen ? result : "{}";
  }
  return text;
}

function queryString(params) {
  return Object.keys(params || {})
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .reduce((pairs, key) => {
      const value = params[key];
      const values = Array.isArray(value) ? value : [value];
      values
        .filter((item) => item !== undefined && item !== null && item !== "")
        .forEach((item) => pairs.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(item))));
      return pairs;
    }, [])
    .join("&");
}

function safeParseJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (_) {}
  }
  return null;
}

function parseJsonLenient(text) {
  const parsed = safeParseJson(text);
  if (parsed) return parsed;
  const raw = String(text || "").trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
  if (normalized !== raw) return safeParseJson(normalized);
  return null;
}

function chunkArray(items, chunkSize) {
  const rows = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number.isFinite(chunkSize) ? Math.floor(chunkSize) : rows.length || 1);
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

function warningItemsForAnalystInput(warnings) {
  const rows = Array.isArray(warnings) ? warnings : [];
  const priority = [];
  const other = [];
  rows.forEach((warning) => {
    const text = String((warning && warning.source) || "") + " " + String((warning && warning.error) || "");
    if (/external-breaking|mapping|analyst|parse|timeout|deadline|context|agent/i.test(text)) priority.push(warning);
    else other.push(warning);
  });
  const out = priority.concat(other).slice(0, 30);
  const omitted = Math.max(0, rows.length - out.length);
  if (omitted > 0) out.push({ source: "warnings-summary", error: omitted + " lower-priority warnings omitted from analyst input." });
  return out;
}

function candidateSeenBefore(candidate) {
  const status = String((candidate && candidate.dedupeStatus) || "").toLowerCase();
  if (status === "seen_before" || status === "duplicate") return true;
  const reason = String((candidate && candidate.reason) || "").toLowerCase();
  return reason.indexOf("dedupestatus=seen_before") >= 0 || reason.indexOf("seen_before") >= 0 || reason.indexOf("seen before") >= 0;
}

function orderEventCandidatesForAnalystPrompt(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate, idx) => ({ candidate, idx, seenBefore: candidateSeenBefore(candidate) }))
    .sort((a, b) => {
      if (a.seenBefore !== b.seenBefore) return a.seenBefore ? 1 : -1;
      return a.idx - b.idx;
    })
    .map((row) => row.candidate);
}

function compactAnomalySignalForAudit(signal) {
  const row = signal || {};
  return {
    symbol: row.symbol || "",
    marketDataSymbol: row.marketDataSymbol || row.symbol || "",
    underlyingSymbol: row.underlyingSymbol || "",
    marketDataBasis: row.marketDataBasis || "",
    triggerKinds: row.triggerKinds || [],
    reasons: row.reasons || [],
    oneDayPct: round(row.oneDayPct, 2),
    fiveDayPct: round(row.fiveDayPct, 2),
    currentMovePct: round(row.currentMovePct, 2),
    intradayPct: round(row.intradayPct, 2),
    zScore: round(row.zScore, 2),
    latestPrice: round(row.latestPrice || row.close, 4),
    latestPriceAsOfHkt: row.latestPriceAsOfHkt || row.latestDateHkt || row.liveAsOfHkt || "",
    latestPriceSource: row.latestPriceSource || "",
    latestPriceInterval: row.latestPriceInterval || "",
    oneDayBasis: row.oneDayBasis || "",
    lastCompletedClose: round(row.lastCompletedClose, 4),
    lastCompletedCloseHkt: row.lastCompletedCloseHkt || "",
    cumulativeVolumeMultiple: round(row.cumulativeVolumeMultiple || row.sessionCumulativeRvol || row.volumeMultiple, 2),
    currentCumulativeVolume: row.currentCumulativeVolume || row.sessionCumulativeVolume || null,
    cumulativeVolumeMedian: row.cumulativeVolumeMedian || row.sessionCumulativeMedian || null,
    volumeBasis: row.volumeBasis || "",
    volumeInterval: row.volumeInterval || "",
    volumeAvailable: row.volumeAvailable,
    portfolioMoveContribution: round(row.portfolioMoveContribution, 5),
  };
}

function sourceOriginForType(sourceType) {
  const type = String(sourceType || "").toLowerCase();
  if (type === "news" || type === "analyst" || type === "corporate_event" || type === "x_post") return "per_ticker_search";
  if (type === "breaking_news") return "pi_market_breaking_search";
  if (type === "external_breaking_news") return "external_breaking_news_feed";
  if (type === "theme_news") return "pi_theme_search";
  if (type === "topic_news") return "arrays_topic_news";
  if (type === "asset_anomaly") return "asset_anomaly_signal";
  if (type === "technical_event") return "computed_technical_analysis";
  if (type === "rate_repricing_event" || type === "rate_repricing_news") return "rate_repricing_lane";
  return "unknown";
}

function sourceOriginLabel(sourceOrigin) {
  const origin = String(sourceOrigin || "").toLowerCase();
  if (origin === "per_ticker_search") return "Per-ticker source loop";
  if (origin === "pi_market_breaking_search") return "Pi market-breaking search";
  if (origin === "external_breaking_news_feed") return "External Breaking News feed";
  if (origin === "pi_theme_search") return "Pi theme search";
  if (origin === "arrays_topic_news") return "Arrays topic news";
  if (origin === "asset_anomaly_signal") return "Asset anomaly signal";
  if (origin === "computed_technical_analysis") return "Technical analysis";
  if (origin === "rate_repricing_lane") return "Rate repricing lane";
  return "Unknown source";
}

function sourceOriginFromEvent(item) {
  const metadata = item && item.metadata ? item.metadata : {};
  return metadata.sourceOrigin || sourceOriginForType(item && item.sourceType);
}

function uniqueCompactStrings(values, maxLen) {
  const seen = {};
  const out = [];
  (values || []).forEach((value) => {
    const text = clean(value, maxLen || 160);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    out.push(text);
  });
  return out;
}

function uniqueSymbols(values) {
  const seen = {};
  const out = [];
  (values || []).forEach((value) => {
    const symbol = String(value || "").toUpperCase().trim();
    if (!symbol || seen[symbol]) return;
    seen[symbol] = true;
    out.push(symbol);
  });
  return out;
}

function rawAffectedSymbols(item) {
  const metadata = item && item.metadata ? item.metadata : {};
  const direct = []
    .concat(item && Array.isArray(item.affectedSymbols) ? item.affectedSymbols : [])
    .concat(Array.isArray(metadata.affectedSymbols) ? metadata.affectedSymbols : []);
  if (direct.length) return uniqueSymbols(direct);
  const symbol = String((item && item.symbol) || "").toUpperCase();
  if (symbol && symbol !== "PORTFOLIO") return [symbol];
  return [];
}

function rawAffectedThemes(item) {
  const metadata = item && item.metadata ? item.metadata : {};
  return uniqueCompactStrings(
    []
      .concat(item && Array.isArray(item.affectedThemes) ? item.affectedThemes : [])
      .concat(Array.isArray(metadata.affectedThemes) ? metadata.affectedThemes : [])
      .concat(Array.isArray(metadata.themes) ? metadata.themes : [])
      .concat(Array.isArray(metadata.riskFactors) ? metadata.riskFactors : [])
      .concat(metadata.matchedTheme ? [metadata.matchedTheme] : []),
    80
  ).map(normalizeThemeName).filter(Boolean);
}

function compactSourceEvidenceRows(rows, limit) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, limit || 6)
    .map((source) => ({
      kind: clean(source && source.kind || "", 40),
      publisher: clean(source && source.publisher || "", 80),
      handle: clean(source && source.handle || "", 80),
      title: clean(source && source.title || "", 140),
      url: source && source.url || "",
      published_at: source && source.published_at || "",
      source_role: clean(source && source.source_role || "", 60),
      official_source: !!(source && source.official_source),
      supports_event: !(source && source.supports_event === false),
      credibility: clean(source && source.credibility || "", 40),
      engagement_score: amount(source && source.engagement_score) || 0,
      evidence_summary: clean(source && source.evidence_summary || "", 220),
      text_excerpt: clean(source && source.text_excerpt || "", 220),
    }));
}

function compactEventCandidateForAudit(candidate) {
  const row = candidate || {};
  const sourceOrigin = row.sourceOrigin || sourceOriginForType(row.candidateType);
  return {
    candidateId: row.candidateId || "",
    lane: row.lane || "event_impact",
    candidateType: row.candidateType || "",
    symbol: row.symbol || row.primaryAsset || "",
    title: clean(row.title || row.summary || "", 180),
    summary: clean(row.summary || "", 360),
    reason: clean(row.reason || "", 360),
    eventRefs: row.eventRefs || [],
    affectedSymbols: row.affectedSymbols || [],
    affectedThemes: row.affectedThemes || [],
    portfolioExposurePct: row.portfolioExposurePct == null ? null : round(row.portfolioExposurePct, 4),
    portfolioExposureText: row.portfolioExposureText || "",
    sourceLinks: row.sourceLinks || [],
    sourceEvidence: compactSourceEvidenceRows(row.sourceEvidence, 10),
    mappingReason: clean(row.mappingReason || "", 360),
    portfolioLevelEvent: !!row.portfolioLevelEvent,
    riskFactors: row.riskFactors || [],
    portfolioRelevanceBasis: clean(row.portfolioRelevanceBasis || "", 360),
    sourceRelatedTickers: row.sourceRelatedTickers || [],
    sourceOrigin,
    sourceOriginLabel: row.sourceOriginLabel || sourceOriginLabel(sourceOrigin),
    sourceLane: row.sourceLane || "",
    sourceSearchMode: row.sourceSearchMode || "",
    sourceTweetUrl: row.sourceTweetUrl || "",
    sourceTweetRank: row.sourceTweetRank || null,
    sourceTweetEngagementScore: row.sourceTweetEngagementScore || null,
    source: row.source || "",
    url: row.url || "",
    dedupeStatus: row.dedupeStatus || "",
    publishedAtMs: row.publishedAtMs || null,
    sourceTimeLabel: row.sourceTimeLabel || "",
    sourceEventTime: row.sourceEventTime === undefined ? "" : row.sourceEventTime,
    sourceEventAtMs: row.sourceEventAtMs || null,
    firstSeenAtMs: row.firstSeenAtMs || null,
    lastSeenAtMs: row.lastSeenAtMs || null,
  };
}

function compactEventCandidateForAnalyst(candidate) {
  const row = candidate || {};
  const sourceOrigin = row.sourceOrigin || sourceOriginForType(row.candidateType);
  return {
    candidateId: row.candidateId || "",
    candidateType: row.candidateType || "",
    symbol: row.symbol || row.primaryAsset || "",
    title: clean(row.title || row.summary || "", 140),
    summary: clean(row.summary || "", 220),
    eventRefs: row.eventRefs || [],
    affectedSymbols: row.affectedSymbols || [],
    affectedThemes: row.affectedThemes || [],
    portfolioExposurePct: row.portfolioExposurePct == null ? null : round(row.portfolioExposurePct, 4),
    sourceOrigin,
    dedupeStatus: row.dedupeStatus || "",
    publishedAtMs: row.publishedAtMs || null,
    sourceTimeLabel: row.sourceTimeLabel || "",
    sourceEventTime: row.sourceEventTime === undefined ? "" : row.sourceEventTime,
    firstSeenAtMs: row.firstSeenAtMs || null,
    lastSeenAtMs: row.lastSeenAtMs || null,
	    sourceLinks: (row.sourceLinks || (row.url ? [row.url] : [])).slice(0, 6),
	    sourceEvidence: compactSourceEvidenceRows(row.sourceEvidence, 6),
	    mappingReason: clean(row.mappingReason || row.reason || "", 180),
	    portfolioLevelEvent: !!row.portfolioLevelEvent,
	    riskFactors: row.riskFactors || [],
	    portfolioRelevanceBasis: clean(row.portfolioRelevanceBasis || "", 220),
	    relatedHoldings: row.relatedHoldings || [],
	    sourceRelatedTickers: row.sourceRelatedTickers || [],
	    sourceTweetUrl: row.sourceTweetUrl || "",
	    sourceTweetRank: row.sourceTweetRank || null,
	    sourceTweetEngagementScore: row.sourceTweetEngagementScore || null,
	    sourceText: clean(row.sourceText || "", 500),
	  };
	}

function compactRawEventForAudit(item) {
  const row = item || {};
  const metadata = row.metadata || {};
  const sourceOrigin = sourceOriginFromEvent(row);
  const sourceEvidence = metadata.sourceEvidence || metadata.evidenceSources || row.sourceEvidence || [];
  return {
    eventKey: row.eventKey || "",
    sourceType: row.sourceType || "",
    symbol: row.symbol || "",
    title: clean(row.title || "", 220),
    summary: clean(row.summary || "", 520),
    url: row.url || "",
    source: row.source || "",
    dedupeStatus: row.dedupeStatus || "",
    affectedSymbols: rawAffectedSymbols(row),
    affectedThemes: rawAffectedThemes(row),
    sourceLinks: row.sourceLinks || metadata.sourceLinks || [],
    sourceEvidence: compactSourceEvidenceRows(sourceEvidence, 10),
    mappingReason: clean(row.mappingReason || metadata.mappingReason || metadata.whyRelevant || "", 360),
    portfolioLevelEvent: !!metadata.portfolioLevelEvent,
    riskFactors: metadata.riskFactors || [],
    portfolioRelevanceBasis: clean(metadata.portfolioRelevanceBasis || "", 360),
    sourceRelatedTickers: metadata.sourceRelatedTickers || [],
    sourceOrigin,
    sourceOriginLabel: sourceOriginLabel(sourceOrigin),
    sourceLane: metadata.sourceLane || "",
    sourceSearchMode: metadata.sourceSearchMode || "",
    sourceTweetId: metadata.sourceTweetId || "",
    sourceTweetUrl: metadata.sourceTweetUrl || "",
    sourceTweetRank: metadata.sourceTweetRank || null,
    sourceTweetEngagementScore: metadata.sourceTweetEngagementScore || null,
    sourceTimeLabel: metadata.sourceTimeLabel || row.sourceTimeLabel || "",
    sourceEventTime: metadata.sourceEventTime === undefined ? "" : metadata.sourceEventTime,
    sourceEventAtMs: metadata.sourceEventAtMs || null,
    publishedAtMs: row.publishedAtMs || null,
    firstSeenAtMs: row.firstSeenAtMs || null,
    lastSeenAtMs: row.lastSeenAtMs || null,
    metadata,
  };
}

function compactRawEventForAnalyst(item) {
  const row = item || {};
  const metadata = row.metadata || {};
  const sourceOrigin = sourceOriginFromEvent(row);
  const sourceEvidence = metadata.sourceEvidence || metadata.evidenceSources || row.sourceEvidence || [];
  return {
    eventKey: row.eventKey || "",
    sourceType: row.sourceType || "",
    symbol: row.symbol || "",
    title: clean(row.title || row.summary || "", 140),
    summary: clean(row.summary || "", 220),
    dedupeStatus: row.dedupeStatus || "",
    affectedSymbols: rawAffectedSymbols(row),
    affectedThemes: rawAffectedThemes(row),
    sourceOrigin,
    url: row.url || "",
    sourceLinks: (row.sourceLinks || metadata.sourceLinks || (row.url ? [row.url] : [])).slice(0, 6),
    sourceEvidence: compactSourceEvidenceRows(sourceEvidence, 6),
    publishedAtMs: row.publishedAtMs || null,
    sourceTimeLabel: metadata.sourceTimeLabel || "",
    sourceEventTime: metadata.sourceEventTime === undefined ? "" : metadata.sourceEventTime,
	    sourceEventAtMs: metadata.sourceEventAtMs || null,
	    firstSeenAtMs: row.firstSeenAtMs || null,
	    lastSeenAtMs: row.lastSeenAtMs || null,
	    mappingReason: clean(row.mappingReason || metadata.mappingReason || metadata.whyRelevant || "", 180),
	    portfolioLevelEvent: !!metadata.portfolioLevelEvent,
	    riskFactors: metadata.riskFactors || [],
	    portfolioRelevanceBasis: clean(metadata.portfolioRelevanceBasis || "", 220),
	    relatedHoldings: metadata.relatedHoldings || [],
	    sourceRelatedTickers: metadata.sourceRelatedTickers || [],
	    sourceTweetId: metadata.sourceTweetId || "",
	    sourceTweetUrl: metadata.sourceTweetUrl || "",
	    sourceTweetRank: metadata.sourceTweetRank || null,
	    sourceTweetEngagementScore: metadata.sourceTweetEngagementScore || null,
	    sourceText: clean(metadata.sourceText || "", 500),
	  };
	}

function compactPriceSignalForAnalyst(signal) {
  const row = signal || {};
  const volume = row.volume || {};
  return {
    symbol: row.symbol || "",
    marketDataSymbol: row.marketDataSymbol || row.symbol || "",
    underlyingSymbol: row.underlyingSymbol || "",
    marketDataBasis: row.marketDataBasis || "",
    abnormal: !!row.abnormal,
    triggerKinds: row.triggerKinds || [],
    oneDayPct: row.oneDayPct,
    oneDayBasis: row.oneDayBasis || "",
    currentPrice: row.currentPrice,
    currentPriceAsOfHkt: row.currentPriceAsOfHkt || "",
    previousClose: row.previousClose,
    fiveDayPct: row.fiveDayPct,
    cumulativeVolume: volume.cumulativeVolume,
    historicalSameTimeAverage: volume.historicalSameTimeAverage,
    cumulativeVolumeMultiple: volume.cumulativeVolumeMultiple,
    volumeAsOfHkt: volume.asOfHkt || row.volumeAsOfHkt || "",
  };
}

function compactAnomalyForAudit(anomaly) {
  const row = anomaly || {};
  return {
    anomalyId: row.anomalyId || "",
    lane: row.lane || "anomaly_attribution",
    symbol: row.symbol || row.primaryAsset || "",
    title: clean(row.title || row.summary || "", 180),
    summary: clean(row.summary || "", 360),
    reason: clean(row.reason || "", 360),
    sourceOrigin: "asset_anomaly_signal",
    sourceOriginLabel: sourceOriginLabel("asset_anomaly_signal"),
    sourceLane: "price_volume_anomaly",
    sourceSearchMode: row.sourceSearchMode || "computed_from_market_data",
    anomalyMetrics: compactAnomalySignalForAudit(row.anomalyMetrics || row),
  };
}

function buildAuditArtifacts(eventCandidates, abnormalSignals, anomalies) {
  const compactCandidates = (eventCandidates || []).map(compactEventCandidateForAudit);
  const signalByKey = {};
  (abnormalSignals || []).forEach((signal) => {
    const compact = compactAnomalySignalForAudit(signal);
    const key = compact.symbol + ":" + (compact.triggerKinds || []).join(",");
    signalByKey[key] = compact;
  });
  (anomalies || [])
    .map(compactAnomalyForAudit)
    .forEach((anomaly) => {
      const signal = anomaly.anomalyMetrics || {};
      const key = signal.symbol + ":" + (signal.triggerKinds || []).join(",");
      if (!signalByKey[key]) signalByKey[key] = signal;
    });
  const compactSignals = Object.keys(signalByKey)
    .map((key) => signalByKey[key])
    .sort((a, b) => String(a.symbol || "").localeCompare(String(b.symbol || "")));
  return {
    candidateAudit: {
      candidateCount: compactCandidates.length,
      candidateLaneCounts: countBy(compactCandidates, "lane"),
      candidateTypeCounts: countBy(compactCandidates, "candidateType"),
      candidateSourceOriginCounts: countBy(compactCandidates, "sourceOrigin"),
      candidates: compactCandidates,
    },
    anomalySignals: {
      signalCount: compactSignals.length,
      signals: compactSignals,
    },
    anomalies: {
      anomalyCount: (anomalies || []).length,
      anomalies: (anomalies || []).map(compactAnomalyForAudit),
    },
  };
}

function buildSearchExpansionTrace(summary) {
  summary = summary || {};
  const toolCalls = (summary.toolCalls || []).map((call, idx) => ({
    order: idx + 1,
    tool: call.tool || "",
    purpose: call.purpose || "",
    lane: call.purpose === "theme_news" ? "theme_news" : "market_breaking",
    query: clean(call.query || "", 260),
    theme: call.theme || "",
    topic: call.topic || "",
    resultFilter: call.resultFilter || "",
    freshness: call.freshness || "",
    resultCount: Number(call.resultCount) || 0,
    limit: call.limit || null,
    startHkt: call.startHkt || "",
    endHkt: call.endHkt || "",
    limitReached: !!call.limitReached,
    error: call.error || "",
  }));
  const externalMode = summary.sourceMode === "external_feed";
  return {
    agentCalled: !!summary.agentCalled,
    queryPlanning: summary.queryPlanning || "",
    sourceExpansionPolicy: externalMode
      ? "Portfolio Watch reads already source-expanded events from the external Breaking News feed, then Pi reviews only portfolio-specific related-holding/theme mapping. No Portfolio Watch X discovery or Brave source expansion runs in this mode."
      : "Code fetches recent Arrays indexed X top-engagement tweets; Pi decides whether supplied tweets are investment-related breaking news. Brave source_expansion with result_filter=web is allowed only after a supplied indexed-X tweet qualifies, to find original/official source first, then earliest credible media/source link.",
    toolCallCount: toolCalls.length,
    sourceMode: summary.sourceMode || "internal_pi",
    externalFeedPath: summary.feedReadPath || "",
    externalRowsRead: summary.externalRowsRead || 0,
    deterministicMappedEventCount: summary.deterministicMappedEventCount || 0,
    piReviewedEventCount: summary.piReviewedEventCount || 0,
    indexedXDiscovery: summary.indexedXDiscovery || null,
    indexedXDiscoveryCalls: toolCalls.filter((call) => call.tool === "searchArraysIndexedX"),
    xDiscoveryCalls: toolCalls.filter((call) => call.tool === "searchArraysIndexedX" || call.tool === "searchGrokX"),
    grokDiscoveryCalls: toolCalls.filter((call) => call.tool === "searchGrokX"),
    sourceExpansionCalls: toolCalls.filter((call) => call.tool === "searchBrave" && call.purpose === "source_expansion"),
    themeNewsCalls: toolCalls.filter((call) => call.tool === "searchBrave" && call.purpose === "theme_news"),
    arraysTopicNewsCalls: toolCalls.filter((call) => call.tool === "searchArraysMarketNewsTopic"),
    allToolCalls: toolCalls,
    searchAudit: Array.isArray(summary.searchAudit) ? summary.searchAudit : [],
    themeTopicMappings: Array.isArray(summary.themeTopicMappings) ? summary.themeTopicMappings : [],
    parsedEventCount: summary.parsedEventCount || 0,
    rawEventRecords: summary.rawEventRecords || 0,
    error: summary.error || "",
  };
}

function normalizeKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/(www\.)?/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function isNewsLikeEvent(item) {
  const type = String(item && item.sourceType || "").toLowerCase();
  return {
    news: true,
    x_post: true,
    breaking_news: true,
    external_breaking_news: true,
    theme_news: true,
    topic_news: true,
    rate_repricing_news: true,
  }[type] === true;
}

function canonicalEventUrl(item) {
  const metadata = item && item.metadata ? item.metadata : {};
  const links = []
    .concat(item && item.url ? [item.url] : [])
    .concat(Array.isArray(item && item.sourceLinks) ? item.sourceLinks : [])
    .concat(Array.isArray(metadata.sourceLinks) ? metadata.sourceLinks : []);
  for (const link of links) {
    const text = String(link || "").trim();
    if (!text) continue;
    const cleaned = text
      .replace(/#.*$/, "")
      .replace(/\?.*$/, "")
      .replace(/\/+$/, "");
    const key = normalizeKey(cleaned);
    if (key) return key;
  }
  return "";
}

function eventDayBucket(item, runAtMs) {
  const metadata = item && item.metadata ? item.metadata : {};
  const ms = Number.isFinite(item && item.publishedAtMs)
    ? item.publishedAtMs
    : parseSourceMs(metadata.sourceEventTime || metadata.sourceDate || metadata.publishedAt || "");
  return String(Math.floor((Number.isFinite(ms) ? ms : (runAtMs || Date.now())) / 86400000));
}

function mergeUniqueStrings(a, b, maxLen) {
  return uniqueCompactStrings([].concat(a || []).concat(b || []), maxLen || 240);
}

function mergeSourceEvidenceRows(a, b, limit) {
  const seen = {};
  const out = [];
  [].concat(a || []).concat(b || []).forEach((source) => {
    if (!source) return;
    const key = clean(source.url || source.platform_id || source.candidate_id || source.title || source.text_excerpt || "", 500).toLowerCase();
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(source);
  });
  return compactSourceEvidenceRows(out, limit || 12);
}

function mergeEventMetadata(existing, raw) {
  const metadata = { ...((existing && existing.metadata) || {}) };
  const incoming = (raw && raw.metadata) || {};
  const rawOrigin = incoming.sourceOrigin || sourceOriginForType(raw && raw.sourceType);
  metadata.sourceOrigins = mergeUniqueStrings(
    []
      .concat(metadata.sourceOrigins || [])
      .concat(metadata.sourceOrigin ? [metadata.sourceOrigin] : []),
    []
      .concat(incoming.sourceOrigins || [])
      .concat(rawOrigin ? [rawOrigin] : []),
    120
  );
  metadata.sourceLanes = mergeUniqueStrings(
    []
      .concat(metadata.sourceLanes || [])
      .concat(metadata.sourceLane ? [metadata.sourceLane] : []),
    []
      .concat(incoming.sourceLanes || [])
      .concat(incoming.sourceLane ? [incoming.sourceLane] : []),
    120
  );
  metadata.riskFactors = mergeUniqueStrings(metadata.riskFactors || [], incoming.riskFactors || [], 80);
  metadata.themes = mergeUniqueStrings(metadata.themes || [], incoming.themes || [], 80);
  metadata.affectedThemes = mergeUniqueStrings(metadata.affectedThemes || [], incoming.affectedThemes || [], 80);
	  metadata.sourceLinks = mergeUniqueStrings(
    []
      .concat(metadata.sourceLinks || [])
      .concat(existing && existing.url ? [existing.url] : []),
    []
      .concat(incoming.sourceLinks || [])
      .concat(raw && raw.sourceLinks ? raw.sourceLinks : [])
      .concat(raw && raw.url ? [raw.url] : []),
	    500
	  );
  metadata.sourceEvidence = mergeSourceEvidenceRows(
    metadata.sourceEvidence || metadata.evidenceSources || [],
    incoming.sourceEvidence || incoming.evidenceSources || raw && raw.sourceEvidence || [],
    12
  );
  metadata.evidenceSources = metadata.sourceEvidence;
	  if (incoming.rateRepricingSupport || String(raw && raw.sourceType || "").toLowerCase() === "rate_repricing_news") {
    metadata.rateRepricingSupport = true;
  }
  if (incoming.supportingRateMoveEventIds || metadata.supportingRateMoveEventIds) {
    metadata.supportingRateMoveEventIds = mergeUniqueStrings(metadata.supportingRateMoveEventIds || [], incoming.supportingRateMoveEventIds || [], 140);
  }
  if (!metadata.sourceOrigin && metadata.sourceOrigins.length) metadata.sourceOrigin = metadata.sourceOrigins[0];
  return metadata;
}

function eventTerminologyText(value) {
  return String(value || "")
    .replace(new RegExp("\\bevid" + "ences\\b", "gi"), "event records")
    .replace(new RegExp("\\bevid" + "ence\\b", "gi"), "event records");
}

function normalizeEventTerminology(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return eventTerminologyText(value);
  if (Array.isArray(value)) return value.map(normalizeEventTerminology);
  if (typeof value !== "object") return value;
  const out = {};
  Object.keys(value).forEach((key) => {
    let nextKey = key;
    if (key === ["evid", "ence_refs"].join("")) nextKey = "event_refs";
    else if (key === ["supporting_evid", "ence"].join("")) nextKey = "supporting_events";
    else if (key === ["evid", "enceKey"].join("")) nextKey = "eventKey";
    out[nextKey] = normalizeEventTerminology(value[key]);
  });
  return out;
}

async function alvaApiJson(path, params) {
  const apiKey = secret.loadPlaintext("ALVA_API_KEY");
  if (!apiKey) throw new Error("Missing ALVA_API_KEY for connected-account portfolio API");
  const query = Object.keys(params || {})
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(String(params[key])))
    .join("&");
  const url = ALVA_API_BASE + path + (query ? "?" + query : "");
  const resp = await http.fetch(url, { headers: { "X-Alva-Api-Key": apiKey } });
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error("Alva portfolio API request failed: " + path + " " + resp.status + " " + JSON.stringify(body).slice(0, 240));
  }
  return body;
}

async function fetchPortfolioSummary(accountId) {
  return alvaApiJson("/api/v1/portfolio/summary", { accountId });
}

function normalizeAssetClass(rawHolding, symbol) {
  if (String(symbol || "").indexOf("O:") === 0) return "option";
  const raw = String(
    (rawHolding && (rawHolding.assetClass || rawHolding.asset_class || rawHolding.instrumentType || rawHolding.securityType || rawHolding.type)) || ""
  ).toLowerCase();
  if (raw.indexOf("option") >= 0) return "option";
  if (raw.indexOf("crypto") >= 0 || raw.indexOf("digital") >= 0 || raw.indexOf("token") >= 0) return "crypto";
  return "equity";
}

function normalizeRawHolding(h, positionCompleteness, sourceAccountId) {
  const symbol = String((h && (h.symbol || h.ticker)) || "").trim().toUpperCase();
  if (!symbol) return null;
  const assetClass = normalizeAssetClass(h, symbol);
  const quantity = positionCompleteness === "full_quantity" ? amount(h && h.quantity) : null;
  const currency = String((h && h.currency) || "USD");
  const side = String((h && h.side) || "");
  const sourceAccounts = sourceAccountId
    ? [{ accountId: sourceAccountId, side, quantity, currency }]
    : [];
  return {
    instrumentId: assetClass + ":" + symbol,
    symbol,
    assetClass,
    side,
    quantity,
    quantityKnown: Number.isFinite(quantity),
    currentPrice: null,
    marketValue: null,
    allocation: null,
    currency,
    instrumentDetails: {
      ...(assetClass === "option" ? parseOptionSymbol(symbol) : {}),
      sourceAccounts,
    },
  };
}

function finalizePortfolioSnapshot(normalizedHoldings, params) {
  const positionCompleteness = normalizePositionCompleteness(params.positionCompleteness) || "full_quantity";
  const accountIds = normalizeAccountIds(params.accountIds || params.accountId);
  normalizedHoldings.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
  return {
    accountId: params.accountId || accountIdLabel(accountIds),
    accountIds,
    sourceAccounts: params.sourceAccounts || [],
    portfolioMode: params.portfolioMode,
    ingestSource: params.ingestSource,
    staticPortfolioPath: params.staticPortfolioPath || "",
    positionCompleteness,
    portfolioCapabilities: portfolioCapabilities(positionCompleteness),
    markVersion: "unpriced_portfolio_positions",
    priceBasis: "unpriced_portfolio_positions",
    totalValue: null,
    cash: params.cash,
    cashAllocation: null,
    holdings: normalizedHoldings,
    holdingCount: normalizedHoldings.length,
    asOfMs: params.asOfMs || params.runAtMs,
    asOfMsEstimated: !!params.asOfMsEstimated,
    runAtMs: params.runAtMs,
  };
}

function signedHoldingQuantity(holding) {
  const q = amount(holding && holding.quantity);
  if (!Number.isFinite(q)) return null;
  return String(holding && holding.side || "").toUpperCase() === "SHORT" ? -Math.abs(q) : q;
}

function normalizeConnectedPortfolio(parsed, runAtMs, accountId) {
  const holdings = Array.isArray(parsed.holdings) ? parsed.holdings : [];
  const cash = amount(parsed.cash);
  const parsedAsOfMs = amount(parsed.asOfMs);
  const normalizedHoldings = holdings
    .map((h) => normalizeRawHolding(h, "full_quantity", accountId))
    .filter((h) => h && h.symbol && Number.isFinite(h.quantity));
  return finalizePortfolioSnapshot(normalizedHoldings, {
    accountId,
    accountIds: [accountId],
    sourceAccounts: [{
      accountId,
      holdingCount: normalizedHoldings.length,
      cash,
      asOfMs: parsedAsOfMs || null,
      asOfMsEstimated: !parsedAsOfMs,
    }],
    portfolioMode: "dynamic",
    ingestSource: "connected_snapshot",
    positionCompleteness: "full_quantity",
    cash,
    asOfMs: parsedAsOfMs,
    asOfMsEstimated: !parsedAsOfMs,
    runAtMs,
  });
}

function aggregateConnectedSnapshots(snapshots, runAtMs, warnings) {
  const rows = (snapshots || []).filter(Boolean);
  if (!rows.length) throw new Error("Dynamic portfolio ingest returned no connected snapshots");
  if (rows.length === 1) return rows[0];

  const accountIds = [];
  let cash = null;
  let cashMissing = 0;
  const asOfValues = [];
  let asOfMsEstimated = false;
  const holdingsByInstrument = {};
  const sourceAccounts = [];

  rows.forEach((snapshot) => {
    const ids = normalizeAccountIds(snapshot.accountIds || snapshot.accountId);
    ids.forEach((id) => {
      if (accountIds.indexOf(id) < 0) accountIds.push(id);
    });
    sourceAccounts.push.apply(sourceAccounts, snapshot.sourceAccounts || ids.map((id) => ({ accountId: id })));
    if (Number.isFinite(snapshot.cash)) {
      cash = (cash || 0) + snapshot.cash;
    } else {
      cashMissing += 1;
    }
    if (Number.isFinite(snapshot.asOfMs)) asOfValues.push(snapshot.asOfMs);
    if (snapshot.asOfMsEstimated) asOfMsEstimated = true;

    (snapshot.holdings || []).forEach((holding) => {
      const signedQty = signedHoldingQuantity(holding);
      if (!Number.isFinite(signedQty)) return;
      const key = holding.instrumentId || ((holding.assetClass || "equity") + ":" + holding.symbol);
      if (!holdingsByInstrument[key]) {
        holdingsByInstrument[key] = {
          instrumentId: key,
          symbol: holding.symbol,
          assetClass: holding.assetClass,
          side: signedQty < 0 ? "SHORT" : "LONG",
          quantity: 0,
          quantityKnown: true,
          currentPrice: null,
          marketValue: null,
          allocation: null,
          currency: holding.currency || "USD",
          instrumentDetails: {
            ...(holding.instrumentDetails || {}),
            sourceAccounts: [],
          },
          _signedQuantity: 0,
        };
      }
      const target = holdingsByInstrument[key];
      target._signedQuantity += signedQty;
      const details = holding.instrumentDetails || {};
      const sourceRows = Array.isArray(details.sourceAccounts) && details.sourceAccounts.length
        ? details.sourceAccounts
        : [{ accountId: snapshot.accountId, side: holding.side, quantity: holding.quantity, currency: holding.currency }];
      target.instrumentDetails.sourceAccounts = (target.instrumentDetails.sourceAccounts || []).concat(sourceRows);
      if (target.currency !== holding.currency && holding.currency) {
        warnings.push({ source: "portfolio:aggregate:" + holding.symbol, error: "same holding appeared with mixed currencies across connected portfolios; kept first currency for display" });
      }
    });
  });

  if (cashMissing) {
    warnings.push({ source: "portfolio:aggregate", error: cashMissing + " connected portfolio snapshot(s) did not provide cash; aggregate cash may be understated" });
  }

  const normalizedHoldings = Object.keys(holdingsByInstrument)
    .map((key) => {
      const holding = holdingsByInstrument[key];
      const signedQty = holding._signedQuantity;
      if (!Number.isFinite(signedQty) || Math.abs(signedQty) <= CONFIG.materiality.quantityEpsilon) return null;
      const out = { ...holding };
      delete out._signedQuantity;
      out.side = signedQty < 0 ? "SHORT" : "LONG";
      out.quantity = Math.abs(signedQty);
      out.quantityKnown = true;
      return out;
    })
    .filter(Boolean);

  return finalizePortfolioSnapshot(normalizedHoldings, {
    accountId: accountIdLabel(accountIds),
    accountIds,
    sourceAccounts,
    portfolioMode: "dynamic",
    ingestSource: "connected_snapshot_aggregate",
    positionCompleteness: "full_quantity",
    cash,
    asOfMs: asOfValues.length ? Math.min.apply(null, asOfValues) : runAtMs,
    asOfMsEstimated: asOfMsEstimated || !asOfValues.length,
    runAtMs,
  });
}

function normalizeSummary(parsed, runAtMs, accountId) {
  return normalizeConnectedPortfolio(parsed, runAtMs, accountId);
}

function staticPortfolioRows(parsed) {
  const holdings = Array.isArray(parsed && parsed.holdings) ? parsed.holdings : [];
  const tickers = Array.isArray(parsed && parsed.tickers) ? parsed.tickers : [];
  return holdings.concat(tickers.map((symbol) => ({ symbol })));
}

function normalizeStaticPortfolio(parsed, runAtMs, warnings) {
  const rows = staticPortfolioRows(parsed);
  const requested = normalizePositionCompleteness((parsed && parsed.positionCompleteness) || CONFIG.positionCompleteness);
  const hasAnyQuantity = rows.some((row) => Number.isFinite(amount(row && row.quantity)));
  const positionCompleteness = requested || (hasAnyQuantity ? "full_quantity" : "ticker_only");
  const normalizedHoldings = rows
    .map((h) => normalizeRawHolding(h, positionCompleteness))
    .filter((h) => h && h.symbol && (positionCompleteness === "ticker_only" || Number.isFinite(h.quantity)));
  if (positionCompleteness === "full_quantity" && normalizedHoldings.length < rows.length) {
    warnings.push({ source: "portfolio:static", error: "static full_quantity portfolio ignored row(s) without usable quantity" });
  }
  if (!normalizedHoldings.length) {
    throw new Error("Static portfolio file had no usable holdings");
  }
  warnings.push({ source: "portfolio:static", error: "static portfolio mode reads the configured snapshot file; holdings stay unchanged until setup/update writes a new file" });
  return finalizePortfolioSnapshot(normalizedHoldings, {
    accountId: "",
    portfolioMode: "static",
    ingestSource: "static_file",
    staticPortfolioPath: resolveAlfsPath(CONFIG.staticPortfolioPath),
    positionCompleteness,
    cash: positionCompleteness === "full_quantity" ? amount(parsed && parsed.cash) : null,
    asOfMs: amount(parsed && parsed.asOfMs) || runAtMs,
    asOfMsEstimated: !(parsed && amount(parsed.asOfMs)),
    runAtMs,
  });
}

async function readStaticPortfolio(runAtMs, warnings) {
  const path = resolveAlfsPath(CONFIG.staticPortfolioPath);
  if (!path) throw new Error("portfolioMode=static requires env.args.staticPortfolioPath");
  let parsed = null;
  try {
    parsed = JSON.parse(await alfs.readFile(path));
  } catch (err) {
    throw new Error("Failed to read static portfolio file " + path + ": " + String((err && err.message) || err).slice(0, 240));
  }
  return normalizeStaticPortfolio(parsed, runAtMs, warnings);
}

async function ingestPortfolio(runAtMs, warnings) {
  if (CONFIG.portfolioMode === "static") return readStaticPortfolio(runAtMs, warnings);
  if (!ACCOUNT_IDS.length) {
    throw new Error("portfolioMode=dynamic requires env.args.accountIds, env.args.accountId, or env.args.connectedAccountId");
  }
  const snapshots = [];
  for (const accountId of ACCOUNT_IDS) {
    const parsedPortfolio = await fetchPortfolioSummary(accountId);
    if (!parsedPortfolio || !Array.isArray(parsedPortfolio.holdings)) {
      throw new Error("Connected portfolio API did not return usable holdings[] for " + accountId);
    }
    const connectedSnapshot = normalizeConnectedPortfolio(parsedPortfolio, runAtMs, accountId);
    if (connectedSnapshot.holdingCount <= 0) {
      warnings.push({
        source: "portfolio:connected:" + accountId,
        error: "connected portfolio returned zero usable holdings; continuing with other configured accounts and marking aggregate coverage degraded",
      });
    }
    snapshots.push(connectedSnapshot);
  }
  const aggregate = aggregateConnectedSnapshots(snapshots, runAtMs, warnings);
  if (aggregate.holdingCount <= 0) {
    throw new Error("Dynamic portfolio ingest returned zero usable holdings across all configured accounts: " + ACCOUNT_IDS.join(", "));
  }
  return aggregate;
}

function markSnapshotToLatest(snapshot, priceSignals, warnings) {
  const signalBySymbol = priceSignalMap(priceSignals);
  const canValuePositions = canComputePortfolioSizing(snapshot);
  let latestAsOfMs = 0;
  let pricedHoldingCount = 0;
  let unpricedHoldingCount = 0;
  let priceObservedHoldingCount = 0;
  let holdingsMarketValue = 0;
  const markedHoldings = (snapshot.holdings || []).map((holding) => {
    const signal = signalBySymbol[holding.symbol];
    const latestPrice = signal && Number.isFinite(signal.latestPrice) ? signal.latestPrice : null;
    const latestPriceAsOfMs = signal && Number.isFinite(signal.latestPriceAsOfMs) ? signal.latestPriceAsOfMs : null;
    const quantity = Number.isFinite(holding.quantity) ? holding.quantity : null;
    const isShort = String(holding.side || "").toUpperCase() === "SHORT";
    const signedQuantity = quantity === null ? null : (isShort ? -Math.abs(quantity) : quantity);
    let marketValue = null;
    let currentPrice = null;
    let valuationStatus = "unpriced";
    if (Number.isFinite(latestPrice) && Number.isFinite(latestPriceAsOfMs)) {
      currentPrice = latestPrice;
      priceObservedHoldingCount += 1;
      latestAsOfMs = Math.max(latestAsOfMs, latestPriceAsOfMs);
    }
    if (
      holding.assetClass === "equity" &&
      Number.isFinite(latestPrice) &&
      Number.isFinite(latestPriceAsOfMs) &&
      canValuePositions &&
      Number.isFinite(signedQuantity)
    ) {
      marketValue = signedQuantity * latestPrice;
      valuationStatus = "priced";
      holdingsMarketValue += marketValue;
      pricedHoldingCount += 1;
    } else if (!canValuePositions && currentPrice !== null) {
      valuationStatus = "price_only_no_quantity";
    } else if (holding.assetClass !== "equity") {
      unpricedHoldingCount += 1;
      warnings.push({ source: "portfolio-mark:" + holding.symbol, error: "non-equity valuation excluded until Arrays/current-price coverage exists" });
    } else {
      unpricedHoldingCount += 1;
      warnings.push({ source: "portfolio-mark:" + holding.symbol, error: "latest Arrays price unavailable; position value excluded from marked total value" });
    }
    return {
      ...holding,
      currentPrice,
      marketValue,
      instrumentDetails: {
        ...(holding.instrumentDetails || {}),
        currentPriceSource: signal ? signal.latestPriceSource || "" : "",
        latestPriceSource: signal ? signal.latestPriceSource || "" : "",
        latestPriceInterval: signal ? signal.latestPriceInterval || "" : "",
        latestPriceAsOfHkt: signal ? signal.latestPriceAsOfHkt || "" : "",
        valuationBasis: valuationStatus === "priced"
          ? "arrays_latest_price_x_signed_quantity"
          : (valuationStatus === "price_only_no_quantity" ? "latest_price_only_position_size_unavailable" : "not_valued_without_arrays_price"),
        valuationStatus,
      },
    };
  });
  const hasValueComponent = canValuePositions && (pricedHoldingCount > 0 || Number.isFinite(snapshot.cash));
  const markedTotalValue = hasValueComponent ? holdingsMarketValue + (Number.isFinite(snapshot.cash) ? snapshot.cash : 0) : null;
  const holdingsWithWeights = markedHoldings.map((holding) => ({
    ...holding,
    allocation: canValuePositions && Number.isFinite(markedTotalValue) && markedTotalValue !== 0 && Number.isFinite(holding.marketValue)
      ? holding.marketValue / markedTotalValue
      : null,
  })).sort((a, b) => ((b.allocation || 0) - (a.allocation || 0)) || String(a.symbol).localeCompare(String(b.symbol)));
  return {
    ...snapshot,
    markVersion: CONFIG.snapshotMarkVersion,
    priceBasis: canValuePositions ? "arrays_latest_price_x_position_quantity_plus_cash" : "latest_price_only_position_size_unavailable",
    valuationPolicy: "cost_and_pnl_fields_omitted",
    pricedHoldingCount,
    unpricedHoldingCount,
    priceObservedHoldingCount,
    totalValue: Number.isFinite(markedTotalValue) ? round(markedTotalValue, 2) : markedTotalValue,
    cashAllocation: canValuePositions && Number.isFinite(markedTotalValue) && markedTotalValue !== 0 && Number.isFinite(snapshot.cash)
      ? snapshot.cash / markedTotalValue
      : null,
    holdings: holdingsWithWeights,
    holdingCount: holdingsWithWeights.length,
    priceAsOfMs: latestAsOfMs || snapshot.asOfMs,
  };
}

function refreshSignalContributions(priceSignals, snapshot) {
  const holdings = bySymbol(snapshot);
  const canComputeContribution = canComputePortfolioSizing(snapshot);
  return (priceSignals || []).map((signal) => {
    if (!signal || !signal.available) return signal;
    const holding = holdings[signal.symbol];
    if (!canComputeContribution) {
      return {
        ...signal,
        portfolioMoveContribution: null,
        impactFlags: [],
      };
    }
    const allocation = holding && Number.isFinite(holding.allocation) ? holding.allocation : 0;
    const portfolioMoveContribution = allocation * Math.abs((signal.oneDayPct || 0) / 100);
    return {
      ...signal,
      portfolioMoveContribution: round(portfolioMoveContribution, 5),
      impactFlags: portfolioMoveContribution >= CONFIG.materiality.portfolioMoveContributionPts
        ? ["portfolio_move_contribution"]
        : [],
    };
  });
}

function parseOptionSymbol(symbol) {
  const match = String(symbol || "").match(/^O:([A-Z]+)(\d{6})([CP])(\d{8})$/);
  if (!match) return {};
  const yy = Number(match[2].slice(0, 2));
  const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
  return {
    underlying: match[1],
    expiry: yyyy + "-" + match[2].slice(2, 4) + "-" + match[2].slice(4, 6),
    optionType: match[3] === "C" ? "call" : "put",
    strike: Number(match[4]) / 1000,
  };
}

function marketDataSymbolForHolding(holding) {
  const symbol = String(holding && holding.symbol || "").toUpperCase();
  if (!symbol) return "";
  if (String(holding && holding.assetClass || "").toLowerCase() !== "option") return symbol;
  const details = (holding && holding.instrumentDetails) || {};
  const underlying = String(details.underlying || parseOptionSymbol(symbol).underlying || "").toUpperCase();
  return underlying || symbol;
}

function holdingReferenceSymbols(holding) {
  return uniqueSymbols([holding && holding.symbol, marketDataSymbolForHolding(holding)]);
}

function bySymbol(snapshot) {
  const out = {};
  (snapshot.holdings || []).forEach((h) => {
    out[h.symbol] = h;
  });
  return out;
}

function normalizeThemeName(theme) {
  return String(theme || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeThemeList(themes) {
  const seen = {};
  const out = [];
  (Array.isArray(themes) ? themes : []).forEach((theme) => {
    const key = normalizeThemeName(theme);
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(key);
  });
  return out.length ? out : ["uncategorized"];
}

function fallbackThemesForSymbol(symbol) {
  return normalizeThemeList((CONFIG.fallbackThemeMap || {})[symbol] || ["uncategorized"]);
}

function themeMapFromSnapshot(snapshot) {
  const map = {};
  if (snapshot && snapshot.themeMap && typeof snapshot.themeMap === "object") {
    Object.keys(snapshot.themeMap).forEach((symbol) => {
      const key = String(symbol || "").toUpperCase();
      if (!key) return;
      map[key] = normalizeThemeList(snapshot.themeMap[symbol]);
    });
  }
  return map;
}

function themesForHolding(snapshot, holding) {
  if (holding && Array.isArray(holding.themes) && holding.themes.length) {
    return normalizeThemeList(holding.themes);
  }
  const symbol = String(holding && holding.symbol || "").toUpperCase();
  const snapshotMap = themeMapFromSnapshot(snapshot);
  return snapshotMap[symbol] || fallbackThemesForSymbol(symbol);
}

function themesForSymbol(snapshot, symbol) {
  const holding = bySymbol(snapshot || {})[String(symbol || "").toUpperCase()];
  return themesForHolding(snapshot, holding || { symbol });
}

function themeExposure(snapshot) {
  const canComputeExposure = canComputePortfolioSizing(snapshot);
  const exposure = {};
  (snapshot.holdings || []).forEach((h) => {
    const themes = themesForHolding(snapshot, h);
    themes.forEach((theme) => {
      exposure[theme] = (exposure[theme] || 0) + (canComputeExposure ? (h.allocation || 0) : 0);
    });
  });
  return Object.keys(exposure)
    .map((theme) => ({
      theme,
      allocation: canComputeExposure ? round(exposure[theme], 4) : null,
      exposureAvailable: canComputeExposure,
      searchPhrase: (snapshot.themeSearchPhrases && snapshot.themeSearchPhrases[theme]) || themeSearchPhrase(theme),
      linkedSymbols: (snapshot.holdings || [])
        .filter((holding) => themesForHolding(snapshot, holding).indexOf(theme) >= 0)
        .map((holding) => holding.symbol)
        .join(","),
    }))
	    .sort((a, b) => ((b.allocation || 0) - (a.allocation || 0)) || String(a.theme).localeCompare(String(b.theme)));
}

function topHoldingsSummary(snapshot, limit) {
  const canSize = canComputePortfolioSizing(snapshot);
  return (snapshot.holdings || []).slice(0, limit || 8).map((h) => {
    if (!canSize) return h.symbol;
    return h.symbol + ":" + fmtPct(h.allocation || 0);
  }).join(",");
}

function compactHoldingForAnalystInput(snapshot, h) {
  const canSize = canComputePortfolioSizing(snapshot);
  const sourceAccounts = h && h.instrumentDetails && Array.isArray(h.instrumentDetails.sourceAccounts)
    ? h.instrumentDetails.sourceAccounts
    : [];
  return {
    symbol: h.symbol,
    assetClass: h.assetClass,
    side: h.side,
    quantity: canSize ? h.quantity : null,
    currentPrice: round(h.currentPrice, 4),
    marketValue: canSize ? round(h.marketValue, 2) : null,
    weight: canSize ? round(h.allocation, 4) : null,
    positionSizeAvailable: canSize,
    sourceAccountCount: sourceAccounts.length || null,
    themes: themesForHolding(snapshot, h),
  };
}

function buildThemeExtractionPrompt(snapshot, previous) {
  const previousThemeMap = previous && previous.themeMap ? themeMapFromSnapshot(previous) : {};
  const canComputeSizing = canComputePortfolioSizing(snapshot);
  const holdings = (snapshot.holdings || []).map((h) => ({
    symbol: h.symbol,
    assetClass: h.assetClass,
    side: h.side,
    quantity: canComputeSizing ? h.quantity : null,
    weight: canComputeSizing ? round(h.allocation || 0, 4) : null,
    marketValue: canComputeSizing ? round(h.marketValue || 0, 2) : null,
    instrumentDetails: {
      underlying: h.instrumentDetails && h.instrumentDetails.underlying || "",
      optionType: h.instrumentDetails && h.instrumentDetails.optionType || "",
      expiry: h.instrumentDetails && h.instrumentDetails.expiry || "",
      strike: h.instrumentDetails && h.instrumentDetails.strike || null,
      sourceAccountCount: h.instrumentDetails && Array.isArray(h.instrumentDetails.sourceAccounts) ? h.instrumentDetails.sourceAccounts.length : null,
    },
    priorThemes: previousThemeMap[h.symbol] || fallbackThemesForSymbol(h.symbol),
  }));
  return [
    "You are the theme extraction step inside a portfolio watch automation for a discretionary investor.",
    "Your job is to classify the current portfolio holdings into investable exposure themes used for event monitoring and exposure sizing.",
    "Use ONLY the supplied JSON. Do not browse. Do not infer current news, catalysts, prices, or recommendations.",
    "Return JSON only. It MUST begin with { and end with }.",
    "",
    "Rules:",
    "- Produce themes for every current holding exactly once.",
    "- Themes should describe business exposure, risk bucket, asset class, supply chain, end-market, or macro sensitivity.",
    "- Use stable lowercase kebab-case labels, e.g. ai-infrastructure, memory, semiconductors, enterprise-software, optical-interconnect, crypto, defi, energy, rates.",
    "- Prefer 2-5 useful themes per holding. Include more only when the position genuinely spans more exposure buckets.",
	    "- Use priorThemes only as weak continuity hints. Do not copy them for stability; keep a prior theme only when the current holding context still supports it.",
    "- Do not create theme labels from today's price action or unsourced news.",
    "- If a holding is unclear, use uncategorized plus the broadest defensible asset-class theme.",
    "",
    "Input:",
    compactJson({
      run_at_hkt: hkt(snapshot.runAtMs),
      theme_extraction_version: CONFIG.themeExtractionVersion,
      holdings,
    }, 20000),
    "",
    "Output schema:",
    "{",
    '  "holdings": [',
    '    {"symbol":"TICKER", "themes":["theme-a","industry-b","risk-factor-c"], "primary_theme":"theme-a", "reason":"short phrase"}',
    "  ],",
    '  "theme_universe": [',
    '    {"theme":"theme-a", "label":"Readable Theme Label", "search_phrase":"theme-specific market news query"}',
    "  ]",
    "}",
  ].join("\n");
}

function normalizeThemeExtraction(parsed, snapshot, previous, runAtMs, rawText, errorText, meta) {
  meta = meta || {};
  const byHolding = {};
  const themeSearchPhrases = {};
  if (parsed && Array.isArray(parsed.theme_universe)) {
    parsed.theme_universe.forEach((row) => {
      const theme = normalizeThemeName(row && (row.theme || row.id || row.label));
      if (!theme) return;
      const phrase = clean(row.search_phrase || row.searchPhrase || row.query || "", 220);
      if (phrase) themeSearchPhrases[theme] = phrase;
    });
  }
  if (parsed && Array.isArray(parsed.holdings)) {
    parsed.holdings.forEach((row) => {
      const symbol = String(row && row.symbol || "").toUpperCase();
      if (!symbol) return;
      const themes = normalizeThemeList(row.themes || (row.primary_theme ? [row.primary_theme] : []));
      byHolding[symbol] = {
        themes,
        primaryTheme: normalizeThemeName(row.primary_theme || row.primaryTheme || themes[0]),
        reason: clean(row.reason || row.why || "", 240),
      };
    });
  }
  const previousThemeMap = previous && previous.themeMap ? themeMapFromSnapshot(previous) : {};
  const themeMap = {};
  const holdings = (snapshot.holdings || []).map((holding) => {
    const extracted = byHolding[holding.symbol];
    const themes = extracted && extracted.themes && extracted.themes.length
      ? extracted.themes
      : (previousThemeMap[holding.symbol] || fallbackThemesForSymbol(holding.symbol));
    themeMap[holding.symbol] = themes;
    return {
      ...holding,
      themes,
      primaryTheme: extracted && extracted.primaryTheme ? extracted.primaryTheme : themes[0],
      themeReason: extracted && extracted.reason ? extracted.reason : (errorText ? "fallback after theme extraction error" : "fallback theme mapping"),
    };
  });
  const themeCount = {};
  Object.keys(themeMap).forEach((symbol) => {
    (themeMap[symbol] || []).forEach((theme) => {
      themeCount[theme] = true;
      if (!themeSearchPhrases[theme]) themeSearchPhrases[theme] = themeSearchPhrase(theme);
    });
  });
  return {
    ...snapshot,
    holdings,
    themeMap,
    themeSearchPhrases,
    themeExtractionSummary: {
      environment: "Pi Agent",
      call: "agent.ask(buildThemeExtractionPrompt(snapshot, previous))",
      version: CONFIG.themeExtractionVersion,
      toolLoop: false,
      browsing: false,
      suppliedJsonOnly: true,
      agentCalled: !errorText,
      fallbackUsed: !!errorText || Object.keys(byHolding).length < (snapshot.holdings || []).length,
      holdingCount: (snapshot.holdings || []).length,
      themeCount: Object.keys(themeCount).length,
      model: meta.model || "",
      stopReason: meta.stopReason || "",
      rawTextPreview: clean(rawText || "", 900),
      error: errorText || "",
    },
  };
}

async function extractPortfolioThemes(snapshot, previous, warnings, runAtMs) {
  try {
    const { Agent, getModel } = require("@alva/pi");
    const agent = new Agent({
      initialState: {
        systemPrompt: "You classify supplied portfolio holdings into stable investable exposure themes. Use only supplied JSON and return JSON only.",
        model: getModel("openai", "gpt-5.5"),
        tools: [],
        thinkingLevel: "off",
      },
    });
    const { message } = await agent.ask(buildThemeExtractionPrompt(snapshot, previous), { timeoutMs: CONFIG.timeouts.themeExtractionMs });
    if (message && message.errorMessage) throw new Error("Theme extraction Pi agent error: " + message.errorMessage);
    const text = piMessageText(message);
    const parsed = safeParseJson(text);
    if (!parsed) throw new Error("Theme extraction Pi agent did not return parseable JSON");
    return normalizeThemeExtraction(parsed, snapshot, previous, runAtMs, text, "", {
      model: message && message.model ? String(message.model) : "gpt-5.5",
      stopReason: message && message.stopReason ? String(message.stopReason) : "",
    });
  } catch (err) {
    const error = String(err && err.message ? err.message : err).slice(0, 260);
    warnings.push({ source: "theme-extraction", error });
    return normalizeThemeExtraction(null, snapshot, previous, runAtMs, "", error);
  }
}

function computePortfolioDelta(snapshot, previous) {
  const result = {
    firstRun: !previous,
    material: false,
    actionMaterial: false,
    navChangePct: null,
    navChangeUsd: null,
    cashChangeUsd: null,
    cashChangePts: null,
    positionChanges: [],
    exposureChanges: [],
    summary: "baseline_created",
  };
  if (!previous) return result;

  const canComputeSizing = canComputePortfolioSizing(snapshot) && canComputePortfolioSizing(previous);
  const prevBy = bySymbol(previous);
  const currBy = bySymbol(snapshot);
  const changes = [];

  if (!canComputeSizing) {
    (snapshot.holdings || []).forEach((h) => {
      if (!prevBy[h.symbol]) {
        changes.push({
          symbol: h.symbol,
          changeType: "new_ticker",
          oldQuantity: null,
          newQuantity: null,
          oldWeight: null,
          newWeight: null,
          marketValueChangeUsd: null,
          markToMarketOnly: false,
          material: true,
        });
      }
    });
    Object.keys(prevBy).forEach((symbol) => {
      if (!currBy[symbol]) {
        changes.push({
          symbol,
          changeType: "removed_ticker",
          oldQuantity: null,
          newQuantity: null,
          oldWeight: null,
          newWeight: null,
          marketValueChangeUsd: null,
          markToMarketOnly: false,
          material: true,
        });
      }
    });
    result.positionChanges = changes;
    result.material = changes.length > 0;
    result.actionMaterial = changes.length > 0;
    result.summary = "ticker_changes=" + changes.length + ", sizing=unavailable";
    return result;
  }

  (snapshot.holdings || []).forEach((h) => {
    const prev = prevBy[h.symbol];
    if (!prev) {
      changes.push({
        symbol: h.symbol,
        changeType: "new_position",
        oldQuantity: null,
        newQuantity: h.quantity,
        oldWeight: 0,
        newWeight: round(h.allocation || 0, 4),
        marketValueChangeUsd: round(h.marketValue || 0, 2),
        markToMarketOnly: false,
        material: (h.allocation || 0) >= 0.01,
      });
      return;
    }
    const quantityChange = (h.quantity || 0) - (prev.quantity || 0);
    const weightChange = (h.allocation || 0) - (prev.allocation || 0);
    const marketValueChangeUsd = (h.marketValue || 0) - (prev.marketValue || 0);
    const mvChangePct = prev.marketValue ? marketValueChangeUsd / Math.abs(prev.marketValue) : null;
    const quantityChanged = Math.abs(quantityChange) > CONFIG.materiality.quantityEpsilon;
    const valueOrWeightChanged =
      (Math.abs(weightChange) >= CONFIG.materiality.allocationMovePts &&
        Math.abs(marketValueChangeUsd) >= CONFIG.materiality.positionMvMoveUsd) ||
      (Number.isFinite(mvChangePct) &&
        Math.abs(mvChangePct) >= CONFIG.materiality.positionMvMovePct &&
        Math.abs(marketValueChangeUsd) >= CONFIG.materiality.positionMvMoveUsd);
    const material =
      quantityChanged ||
      valueOrWeightChanged;
    if (material) {
      changes.push({
        symbol: h.symbol,
        changeType: quantityChanged ? "quantity_change" : "mark_to_market_change",
        oldQuantity: prev.quantity,
        newQuantity: h.quantity,
        oldWeight: round(prev.allocation || 0, 4),
        newWeight: round(h.allocation || 0, 4),
        quantityChange: round(quantityChange, 6),
        weightChangePts: round(weightChange * 100, 2),
        marketValueChangeUsd: round(marketValueChangeUsd, 2),
        marketValueChangePct: round(mvChangePct, 4),
        markToMarketOnly: !quantityChanged,
        material,
      });
    }
  });

  Object.keys(prevBy).forEach((symbol) => {
    if (!currBy[symbol]) {
      changes.push({
        symbol,
        changeType: "removed_position",
        oldQuantity: prevBy[symbol].quantity,
        newQuantity: null,
        oldWeight: round(prevBy[symbol].allocation || 0, 4),
        newWeight: 0,
        marketValueChangeUsd: round(-(prevBy[symbol].marketValue || 0), 2),
        markToMarketOnly: false,
        material: (prevBy[symbol].allocation || 0) >= 0.01,
      });
    }
  });

  const navChangeUsd = (snapshot.totalValue || 0) - (previous.totalValue || 0);
  const navChangePct = previous.totalValue ? navChangeUsd / Math.abs(previous.totalValue) : null;
  const cashChangeUsd = (snapshot.cash || 0) - (previous.cash || 0);
  const cashChangePts = ((snapshot.cashAllocation || 0) - (previous.cashAllocation || 0)) * 100;
  const currentThemes = themeExposure(snapshot);
  const previousThemes = themeExposure(previous);
  const prevThemeBy = {};
  previousThemes.forEach((t) => {
    prevThemeBy[t.theme] = t.allocation || 0;
  });
  const exposureChanges = currentThemes
    .map((t) => {
      const oldAllocation = prevThemeBy[t.theme] || 0;
      return {
        bucket: t.theme,
        oldAllocation: round(oldAllocation, 4),
        newAllocation: round(t.allocation || 0, 4),
        changePts: round(((t.allocation || 0) - oldAllocation) * 100, 2),
      };
    })
    .filter((t) => Math.abs(t.changePts || 0) >= CONFIG.materiality.themeExposureChangePts * 100);

  result.navChangeUsd = round(navChangeUsd, 2);
  result.navChangePct = round(navChangePct, 4);
  result.cashChangeUsd = round(cashChangeUsd, 2);
  result.cashChangePts = round(cashChangePts, 2);
  result.positionChanges = changes;
  result.exposureChanges = exposureChanges;
  result.actionMaterial =
    changes.some((c) => c.material && !c.markToMarketOnly) ||
    Math.abs(cashChangeUsd || 0) >= CONFIG.materiality.cashMoveUsd;
  result.material =
    changes.some((c) => c.material) ||
    exposureChanges.length > 0 ||
    (Number.isFinite(navChangePct) &&
      Math.abs(navChangePct) >= CONFIG.materiality.portfolioValueMovePct &&
      Math.abs(navChangeUsd) >= CONFIG.materiality.portfolioValueMoveUsd) ||
    Math.abs(cashChangeUsd || 0) >= CONFIG.materiality.cashMoveUsd ||
    Math.abs(cashChangePts || 0) >= CONFIG.materiality.cashMovePts * 100;
  result.summary = [
    "positions=" + changes.length,
    "theme_changes=" + exposureChanges.length,
    "nav=" + fmtMove((navChangePct || 0) * 100),
    "cash=" + fmtMove(cashChangePts || 0) + " pts / " + fmtMoney(cashChangeUsd || 0),
  ].join(", ");
  return result;
}

function mean(values) {
  return values.reduce((acc, x) => acc + x, 0) / values.length;
}

function median(values) {
  const cleanValues = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!cleanValues.length) return null;
  const mid = Math.floor(cleanValues.length / 2);
  return cleanValues.length % 2 ? cleanValues[mid] : (cleanValues[mid - 1] + cleanValues[mid]) / 2;
}

function stdev(values) {
  if (!values.length) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, x) => acc + Math.pow(x - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function pct(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return ((a / b) - 1) * 100;
}

function timestampSec(value) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 100000000000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function barTimeSec(bar) {
  if (!bar) return 0;
  return timestampSec(
    bar.time_close ||
    bar.time_period_end ||
    bar.time_open ||
    bar.time_period_start ||
    bar.date
  );
}

function barClose(bar) {
  const n = Number(bar && (bar.price_close !== undefined ? bar.price_close : bar.close));
  return Number.isFinite(n) ? n : null;
}

function barOpen(bar) {
  const n = Number(bar && (bar.price_open !== undefined ? bar.price_open : bar.open));
  return Number.isFinite(n) ? n : barClose(bar);
}

function barHigh(bar) {
  const n = Number(bar && (bar.price_high !== undefined ? bar.price_high : bar.high));
  if (Number.isFinite(n)) return n;
  const open = barOpen(bar);
  const close = barClose(bar);
  const values = [open, close].filter(Number.isFinite);
  return values.length ? Math.max.apply(null, values) : null;
}

function barLow(bar) {
  const n = Number(bar && (bar.price_low !== undefined ? bar.price_low : bar.low));
  if (Number.isFinite(n)) return n;
  const open = barOpen(bar);
  const close = barClose(bar);
  const values = [open, close].filter(Number.isFinite);
  return values.length ? Math.min.apply(null, values) : null;
}

function barVolume(bar) {
  const n = Number(bar && (bar.volume_traded !== undefined ? bar.volume_traded : bar.volume));
  return Number.isFinite(n) ? n : 0;
}

function assetVolumeClass(symbol, holding) {
  const assetClass = String(holding && holding.assetClass || "").toLowerCase();
  if (assetClass === "option") return "us_option_underlying";
  if (assetClass === "crypto" || assetClass === "cryptocurrency" || assetClass === "digital_asset" || assetClass === "token") return "crypto_24_7";
  return "us_equity";
}

function utcDateKey(d) {
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function nyParts(ms) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(ms));
    const out = {};
    parts.forEach((part) => {
      if (part.type !== "literal") out[part.type] = part.value;
    });
    const hour = Number(out.hour) % 24;
    const minute = Number(out.minute);
    return {
      dateKey: out.year + "-" + out.month + "-" + out.day,
      weekday: out.weekday || "",
      minuteOfDay: hour * 60 + minute,
    };
  } catch (_) {
    const d = new Date(ms);
    return {
      dateKey: utcDateKey(d),
      weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()],
      minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
    };
  }
}

function volumeMeta(sec, volumeClass) {
  const ms = sec * 1000;
  if (volumeClass === "crypto_24_7") {
    const d = new Date(ms);
    const minute = d.getUTCHours() * 60 + d.getUTCMinutes();
    return {
      sessionName: "crypto_utc_day",
      volumeRegime: "crypto_24_7",
      sessionKey: utcDateKey(d) + ":crypto",
      sessionMinute: minute,
      cumulativeBaselineKey: "crypto_utc_day",
      volumeBasis: "crypto_utc_day_hourly_cumulative_to_same_time",
      includeInCumulative: true,
      tradable: true,
    };
  }

  const p = nyParts(ms);
  const regularStart = 9 * 60 + 30;
  const regularEnd = 16 * 60;
  let sessionName = "closed";
  let sessionMinute = p.minuteOfDay;
  let includeInCumulative = false;
  let tradable = false;
  if (p.minuteOfDay < regularStart) {
    sessionName = "premarket";
    sessionMinute = -1;
  } else if (p.minuteOfDay <= regularEnd) {
    sessionName = "regular";
    includeInCumulative = true;
    tradable = true;
  } else {
    sessionName = "afterhours_close_frozen";
    sessionMinute = regularEnd;
    tradable = true;
  }
  return {
    sessionName,
    volumeRegime: sessionName,
    sessionKey: p.dateKey + ":rth_day",
    sessionMinute,
    cumulativeBaselineKey: "us_equity:rth_day",
    volumeBasis: "us_equity_regular_session_hourly_cumulative_to_current_or_market_close",
    includeInCumulative,
    tradable,
  };
}

function volumeProfile(symbol, holding, volumeBars) {
  const volumeClass = assetVolumeClass(symbol, holding);
  const bars = Array.isArray(volumeBars)
    ? volumeBars.slice().sort((a, b) => barTimeSec(a) - barTimeSec(b))
    : [];
  if (!bars.length) {
    return {
      volumeSignalVersion: CONFIG.volumeSignalVersion,
      assetVolumeClass: volumeClass,
      volumeAvailable: false,
      reason: "not_enough_intraday_volume_bars",
    };
  }

  const latest = bars[bars.length - 1];
  const latestSec = barTimeSec(latest);
  const currentMeta = volumeMeta(latestSec, volumeClass);
  const rows = bars
    .map((bar) => ({
      bar,
      sec: barTimeSec(bar),
      volume: barVolume(bar),
      meta: volumeMeta(barTimeSec(bar), volumeClass),
    }))
    .filter((row) => row.sec > 0);
  const history = rows.filter((row) => row.sec < latestSec);

  const currentCumulativeVolume = rows
    .filter((row) =>
      row.meta.sessionKey === currentMeta.sessionKey &&
      row.meta.includeInCumulative !== false &&
      row.meta.sessionMinute <= currentMeta.sessionMinute)
    .reduce((acc, row) => acc + row.volume, 0);
  const sessionTotals = {};
  history.forEach((row) => {
    if (row.meta.includeInCumulative === false) return;
    if (row.meta.sessionKey === currentMeta.sessionKey) return;
    if (row.meta.cumulativeBaselineKey !== currentMeta.cumulativeBaselineKey) return;
    if (row.meta.sessionMinute > currentMeta.sessionMinute) return;
    sessionTotals[row.meta.sessionKey] = (sessionTotals[row.meta.sessionKey] || 0) + row.volume;
  });
  const cumulativeSamples = Object.keys(sessionTotals)
    .map((key) => sessionTotals[key])
    .filter(Number.isFinite)
    .slice(-CONFIG.materiality.volumeLookbackSamples);
  const cumulativeMedian = cumulativeSamples.length >= CONFIG.materiality.volumeMinBaselineSamples
    ? median(cumulativeSamples)
    : null;

  const cumulativeVolumeMultiple = cumulativeMedian && cumulativeMedian > 0 ? currentCumulativeVolume / cumulativeMedian : null;
  return {
    volumeSignalVersion: CONFIG.volumeSignalVersion,
    assetVolumeClass: volumeClass,
    volumeAvailable: true,
    volumeRegime: currentMeta.volumeRegime,
    volumeBasis: currentMeta.volumeBasis,
    volumeInterval: "1h",
    latestVolumeBarVolume: round(barVolume(latest), 0),
    currentCumulativeVolume: round(currentCumulativeVolume, 0),
    cumulativeVolumeMedian: round(cumulativeMedian, 0),
    cumulativeVolumeMultiple: round(cumulativeVolumeMultiple, 2),
    cumulativeVolumeBaselineSamples: cumulativeSamples.length,
    sessionCumulativeVolume: round(currentCumulativeVolume, 0),
    sessionCumulativeMedian: round(cumulativeMedian, 0),
    sessionCumulativeRvol: round(cumulativeVolumeMultiple, 2),
    sessionCumulativeBaselineSamples: cumulativeSamples.length,
    volumeTradable: currentMeta.tradable,
  };
}

function analyzePrice(symbol, holding, dailyBars, hourlyBars, minuteBars, volumeBars, marketDataSymbolInput) {
  const holdingSymbol = String(symbol || "").toUpperCase();
  const marketDataSymbol = String(marketDataSymbolInput || marketDataSymbolForHolding(holding) || holdingSymbol).toUpperCase();
  const underlyingSymbol = String(holding && holding.assetClass || "").toLowerCase() === "option" && marketDataSymbol !== holdingSymbol
    ? marketDataSymbol
    : "";
  const marketDataBasis = underlyingSymbol ? "underlying_equity" : "holding_symbol";
  if (!Array.isArray(dailyBars) || dailyBars.length < 10) {
    return { symbol: holdingSymbol, marketDataSymbol, underlyingSymbol, marketDataBasis, available: false, reason: "not_enough_daily_bars" };
  }
  const bars = dailyBars.slice().sort((a, b) => barTimeSec(a) - barTimeSec(b));
  const hourly = Array.isArray(hourlyBars)
    ? hourlyBars.slice().sort((a, b) => barTimeSec(a) - barTimeSec(b))
    : [];
  const minute = Array.isArray(minuteBars)
    ? minuteBars.slice().sort((a, b) => barTimeSec(a) - barTimeSec(b))
    : [];
  let intradayPct = null;
  let liveClose = null;
  let liveAsOfMs = null;
  let liveAsOfHkt = "";
  let liveVsLastClosePct = null;
  let latestPriceInterval = "";
  const liveSeries = minute.length ? minute : hourly;
  if (liveSeries.length >= 1) {
    const lastLiveBar = liveSeries[liveSeries.length - 1];
    liveClose = barClose(lastLiveBar);
    liveAsOfMs = barTimeSec(lastLiveBar) * 1000;
    liveAsOfHkt = hkt(liveAsOfMs);
    latestPriceInterval = minute.length ? "1min" : "1h_fallback";
    const target = barTimeSec(lastLiveBar) - 24 * 3600;
    let back = liveSeries[0];
    liveSeries.forEach((bar) => {
      if (barTimeSec(bar) <= target) back = bar;
    });
    intradayPct = pct(liveClose, barClose(back));
  }
  const referenceSec = Number.isFinite(liveAsOfMs) ? Math.floor(liveAsOfMs / 1000) : Math.floor(Date.now() / 1000);
  const completedBars = bars.filter((bar) => barTimeSec(bar) <= referenceSec);
  if (completedBars.length < 2) {
    return { symbol: holdingSymbol, marketDataSymbol, underlyingSymbol, marketDataBasis, available: false, reason: "not_enough_completed_daily_bars" };
  }
  const latest = completedBars[completedBars.length - 1];
  const prev = completedBars[completedBars.length - 2];
  const fiveBack = completedBars.length >= 6 ? completedBars[completedBars.length - 6] : null;
  const returns = [];
  for (let i = Math.max(1, completedBars.length - 31); i < completedBars.length - 1; i += 1) {
    const r = pct(barClose(completedBars[i]), barClose(completedBars[i - 1]));
    if (Number.isFinite(r)) returns.push(r);
  }
  const avgVolBars = completedBars.slice(Math.max(0, completedBars.length - 22), completedBars.length - 1);
  const avgVol = avgVolBars.length ? mean(avgVolBars.map(barVolume)) : null;
  const lastCompletedClose = barClose(latest);
  const priorCompletedClose = barClose(prev);
  const lastCompletedCloseSec = barTimeSec(latest);
  const lastClosedOneDayPct = pct(lastCompletedClose, priorCompletedClose);
  const lastClosedFiveDayPct = fiveBack ? pct(lastCompletedClose, barClose(fiveBack)) : null;
  const returnStd = stdev(returns);
  const dailyVolumeMultiple = avgVol && avgVol > 0 ? barVolume(latest) / avgVol : null;
  if (Number.isFinite(liveClose)) {
    liveVsLastClosePct = pct(liveClose, lastCompletedClose);
  }
  const liveIsNewer = Number.isFinite(liveClose) && Number.isFinite(liveAsOfMs) && liveAsOfMs / 1000 > lastCompletedCloseSec;
  const latestPrice = liveIsNewer ? liveClose : lastCompletedClose;
  const latestPriceAsOfMs = liveIsNewer ? liveAsOfMs : lastCompletedCloseSec * 1000;
  const latestPriceSource = liveIsNewer
    ? (latestPriceInterval === "1min" ? "latest_1min_extended_hours" : "latest_1h_extended_hours_fallback")
    : "last_completed_daily_close_fallback_no_newer_intraday";
  const oneDayPct = liveIsNewer ? pct(latestPrice, lastCompletedClose) : lastClosedOneDayPct;
  const fiveDayPct = fiveBack ? pct(latestPrice, barClose(fiveBack)) : null;
  const zScore = returnStd > 0 && Number.isFinite(oneDayPct) ? oneDayPct / returnStd : null;
  const volumeInput = Array.isArray(volumeBars) && volumeBars.length ? volumeBars : hourly;
  const volume = volumeProfile(marketDataSymbol, holding, volumeInput);
  const allocation = holding && Number.isFinite(holding.allocation) ? holding.allocation : 0;
  const portfolioMoveContribution = allocation * Math.abs((oneDayPct || 0) / 100);
  const reasons = [];
  if (Math.abs(oneDayPct || 0) >= CONFIG.materiality.priceOneDayPct) reasons.push("1d_price_move");
  if (Math.abs(zScore || 0) >= CONFIG.materiality.priceZScore) reasons.push("return_zscore");
  if (volume.volumeTradable !== false && (volume.cumulativeVolumeMultiple || 0) >= CONFIG.materiality.cumulativeVolumeMultiple) reasons.push("cumulative_volume_rvol");
  return {
    symbol: holdingSymbol,
    marketDataSymbol,
    underlyingSymbol,
    marketDataBasis,
    priceSignalVersion: CONFIG.priceSignalVersion,
    volumeSignalVersion: CONFIG.volumeSignalVersion,
    available: true,
    close: round(latestPrice, 4),
    latestDateHkt: hkt(latestPriceAsOfMs),
    latestPrice: round(latestPrice, 4),
    latestPriceAsOfMs,
    latestPriceAsOfHkt: hkt(latestPriceAsOfMs),
    latestPriceSource,
    latestPriceInterval: liveIsNewer ? latestPriceInterval : "1d_fallback",
    lastCompletedClose: round(lastCompletedClose, 4),
    lastCompletedCloseHkt: hkt(lastCompletedCloseSec * 1000),
    lastClosedOneDayPct: round(lastClosedOneDayPct, 2),
    lastClosedFiveDayPct: round(lastClosedFiveDayPct, 2),
    oneDayPct: round(oneDayPct, 2),
    fiveDayPct: round(fiveDayPct, 2),
    currentMovePct: round(oneDayPct, 2),
    intradayPct: round(intradayPct, 2),
    liveClose: round(liveClose, 4),
    liveAsOfHkt,
    liveVsLastClosePct: round(liveVsLastClosePct, 2),
    oneDayBasis: liveIsNewer
      ? (latestPriceInterval === "1min"
        ? "latest_1min_price_vs_previous_regular_session_close"
        : "latest_intraday_fallback_price_vs_previous_regular_session_close")
      : "last_completed_daily_close_vs_prior_completed_daily_close",
    zScore: round(zScore, 2),
    dailyVolumeMultiple: round(dailyVolumeMultiple, 2),
    volumeMultiple: volume.cumulativeVolumeMultiple,
    assetVolumeClass: volume.assetVolumeClass,
    volumeRegime: volume.volumeRegime,
    volumeBasis: volume.volumeBasis,
    volumeInterval: volume.volumeInterval,
    latestVolumeBarVolume: volume.latestVolumeBarVolume,
    currentCumulativeVolume: volume.currentCumulativeVolume,
    cumulativeVolumeMedian: volume.cumulativeVolumeMedian,
    cumulativeVolumeMultiple: volume.cumulativeVolumeMultiple,
    cumulativeVolumeBaselineSamples: volume.cumulativeVolumeBaselineSamples,
    sessionCumulativeVolume: volume.sessionCumulativeVolume,
    sessionCumulativeMedian: volume.sessionCumulativeMedian,
    sessionCumulativeRvol: volume.sessionCumulativeRvol,
    sessionCumulativeBaselineSamples: volume.sessionCumulativeBaselineSamples,
    volumeAvailable: volume.volumeAvailable,
    volumeTradable: volume.volumeTradable,
    portfolioMoveContribution: round(portfolioMoveContribution, 5),
    triggerKinds: [
      Math.abs(oneDayPct || 0) >= CONFIG.materiality.priceOneDayPct ||
      Math.abs(zScore || 0) >= CONFIG.materiality.priceZScore
        ? "price"
        : "",
      (volume.volumeTradable !== false && (
        (volume.cumulativeVolumeMultiple || 0) >= CONFIG.materiality.cumulativeVolumeMultiple
      ))
        ? "volume"
        : "",
    ].filter(Boolean),
    abnormal: reasons.length > 0,
    reasons,
  };
}

async function arraysJson(path, params) {
  const jwt = secret.loadPlaintext("ARRAYS_JWT");
  if (!jwt) throw new Error("Missing ARRAYS_JWT");
  const query = Object.keys(params || {})
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .reduce((pairs, key) => {
      const value = params[key];
      const values = Array.isArray(value) ? value : [value];
      values
        .filter((item) => item !== undefined && item !== null && item !== "")
        .forEach((item) => pairs.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(item))));
      return pairs;
    }, [])
    .join("&");
  const url = ARRAYS_BASE + path + (query ? "?" + query : "");
  const resp = await http.fetch(url, { headers: { Authorization: "Bearer " + jwt } });
  const body = await resp.json();
  if (!resp.ok || body.success === false) {
    throw new Error("Arrays request failed: " + path + " " + resp.status + " " + JSON.stringify(body).slice(0, 240));
  }
  return body;
}

async function optionalArrays(path, params, warnings, label) {
  try {
    return await arraysJson(path, params);
  } catch (err) {
    warnings.push({ source: label || path, error: String(err && err.message ? err.message : err).slice(0, 260) });
    return { data: [] };
  }
}

async function externalJson(baseUrl, path, params, warnings, label) {
  const query = queryString(params);
  const url = baseUrl + path + (query ? "?" + query : "");
  try {
    const resp = await http.fetch(url, {
      headers: {
        "User-Agent": "AlvaPortfolioWatch/1.0",
        Accept: "application/json",
      },
    });
    const body = await resp.json();
    if (!resp.ok) {
      throw new Error("HTTP " + resp.status + " " + JSON.stringify(body).slice(0, 180));
    }
    return body;
  } catch (err) {
    warnings.push({ source: label || url, error: String(err && err.message ? err.message : err).slice(0, 260) });
    return null;
  }
}

function parseJsonObjectField(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function parseJsonArrayField(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function tweetMetric(row, key) {
  const direct = amount(row && row[key]);
  if (Number.isFinite(direct)) return direct;
  const meta = parseJsonObjectField(row && row.meta_json);
  const publicMetrics = meta.public_metrics || {};
  const mapped = {
    like_count: publicMetrics.like_count,
    retweet_count: publicMetrics.retweet_count,
    reply_count: publicMetrics.reply_count,
    quote_count: publicMetrics.quote_count,
    view_count: publicMetrics.impression_count || publicMetrics.view_count,
    bookmark_count: publicMetrics.bookmark_count,
  };
  const n = amount(mapped[key]);
  return Number.isFinite(n) ? n : 0;
}

function indexedXTweetScore(row) {
  const likes = tweetMetric(row, "like_count");
  const reposts = tweetMetric(row, "retweet_count");
  const replies = tweetMetric(row, "reply_count");
  const quotes = tweetMetric(row, "quote_count");
  const bookmarks = tweetMetric(row, "bookmark_count");
  const views = tweetMetric(row, "view_count");
  return likes + 2 * reposts + replies + 2 * quotes + 0.5 * bookmarks + 0.001 * views;
}

function compactIndexedXTweet(row, rank) {
  const publishedAtMs = Date.parse(row && row.published_at || "") || null;
  const score = indexedXTweetScore(row || {});
  const source = row && row.source && typeof row.source === "object" ? row.source : null;
  return {
    rank,
    platform_id: String(row && (row.platform_id || row.id) || ""),
    url: row && row.url || "",
    published_at_iso: row && row.published_at || "",
    published_at_hkt: Number.isFinite(publishedAtMs) ? hkt(publishedAtMs) : "",
    first_observed_at: row && row.first_observed_at || "",
    last_observed_at: row && row.last_observed_at || "",
    handle: row && row.twitter_handle || "",
    display_name: row && row.display_name || "",
    content_type: row && row.content_type || "",
    text: clean(row && row.full_text || "", 900),
    source_text: clean(row && row.full_text || "", 1400),
    metrics: {
      likes: tweetMetric(row, "like_count"),
      reposts: tweetMetric(row, "retweet_count"),
      replies: tweetMetric(row, "reply_count"),
      quotes: tweetMetric(row, "quote_count"),
      bookmarks: tweetMetric(row, "bookmark_count"),
      views: tweetMetric(row, "view_count"),
      engagement_score: round(score, 3),
    },
    mentions: row && row.mentions || [],
    entity_mentions: row && row.entity_mentions || {},
    referenced_tweets: row && row.referenced_tweets || [],
    quoted_or_source_tweet: source ? {
      handle: source.twitter_handle || "",
      display_name: source.display_name || "",
      text: clean(source.full_text || "", 700),
      url: source.url || "",
      published_at_iso: source.published_at || "",
    } : null,
  };
}

async function fetchIndexedXTopTweets(fetchStartMs, runAtMs, warnings) {
  const startMs = Math.max(fetchStartMs, runAtMs - CONFIG.indexedXLookbackMinutes * 60 * 1000);
  const sinceSec = Math.floor(startMs / 1000);
  let untilSec = Math.floor(runAtMs / 1000);
  const rawRows = [];
  const pages = [];
  const seen = {};
  for (let page = 0; page < CONFIG.maxIndexedXTweetFetchPages && untilSec >= sinceSec; page += 1) {
    const body = await optionalArrays("/api/v1/social-feeds/x/search", {
      since: sinceSec,
      until: untilSec,
      limit: CONFIG.maxIndexedXTweetsFetch,
      content_type: ["original", "quote"],
    }, warnings, "social-feeds/x/search:indexed-top-engagement:page-" + (page + 1));
    const pageRows = body.data || [];
    let oldestMs = null;
    pageRows.forEach((row) => {
      const key = String((row && (row.platform_id || row.id || row.url)) || "");
      if (!key || seen[key]) return;
      seen[key] = true;
      rawRows.push(row);
      const publishedAtMs = Date.parse(row && row.published_at || "") || null;
      if (Number.isFinite(publishedAtMs)) oldestMs = oldestMs === null ? publishedAtMs : Math.min(oldestMs, publishedAtMs);
    });
    pages.push({
      page: page + 1,
      untilSec,
      fetchedRows: pageRows.length,
      uniqueRowsAfterPage: rawRows.length,
      oldestPublishedAtMs: oldestMs,
      oldestPublishedAtHkt: Number.isFinite(oldestMs) ? hkt(oldestMs) : "",
    });
    if (pageRows.length < CONFIG.maxIndexedXTweetsFetch || !Number.isFinite(oldestMs) || oldestMs <= startMs + 1000) break;
    untilSec = Math.floor((oldestMs - 1000) / 1000);
  }
  const rows = rawRows
    .filter((row) => {
      const publishedAtMs = Date.parse(row && row.published_at || "") || 0;
      if (!publishedAtMs || publishedAtMs < startMs || publishedAtMs > runAtMs + 60000) return false;
      const text = clean(row && row.full_text || "", 200);
      if (!text || /^https?:\/\/\S+$/i.test(text)) return false;
      return true;
    })
    .sort((a, b) => indexedXTweetScore(b) - indexedXTweetScore(a));
  const topTweets = rows
    .slice(0, CONFIG.maxIndexedXTweetsForPi)
    .map((row, idx) => compactIndexedXTweet(row, idx + 1));
  return {
    source: "Arrays /api/v1/social-feeds/x/search",
    discovery_mode: "q_omitted_reverse_chronological_paginated_then_code_ranked_by_engagement",
    ranking_formula: "likes + 2*reposts + replies + 2*quotes + 0.5*bookmarks + 0.001*views",
    startMs,
    endMs: runAtMs,
    startHkt: hkt(startMs),
    endHkt: hkt(runAtMs),
    pages,
    fetchedPages: pages.length,
    fetchedRows: rawRows.length,
    eligibleRows: rows.length,
    keptRows: topTweets.length,
    topTweets,
  };
}

async function fetchDailyBars(symbol, warnings) {
  const end = Math.floor(Date.now() / 1000) + 2 * 86400;
  const limit = technicalEventsEnabled() ? Math.max(90, Math.floor(CONFIG.technicalEvents.lookbackDailyBars || 260)) : 90;
  const start = end - Math.max(100, Math.ceil(limit * 1.6)) * 86400;
  const body = await optionalArrays("/api/v1/stocks/kline", {
    symbol,
    interval: "1d",
    start_time: start,
    end_time: end,
    limit,
  }, warnings, "stocks/kline:" + symbol);
  return (body.data || []).slice().sort((a, b) => barTimeSec(a) - barTimeSec(b));
}

async function fetchMinuteBars(symbol, warnings) {
  const end = Math.floor(Date.now() / 1000) + 60;
  const start = end - CONFIG.latestPriceLookbackHours * 3600;
  const body = await optionalArrays("/api/v1/stocks/kline", {
    symbol,
    interval: CONFIG.latestPriceInterval,
    session: "ETH",
    start_time: start,
    end_time: end,
    limit: CONFIG.latestPriceLimit,
  }, warnings, "stocks/kline-1min:" + symbol);
  return (body.data || []).slice().sort((a, b) => barTimeSec(a) - barTimeSec(b));
}

async function fetchHourlyBars(symbol, warnings) {
  const end = Math.floor(Date.now() / 1000) + 3600;
  const start = end - 35 * 86400;
  const body = await optionalArrays("/api/v1/stocks/kline", {
    symbol,
    interval: "1h",
    session: "ETH",
    start_time: start,
    end_time: end,
    limit: 120,
  }, warnings, "stocks/kline-1h:" + symbol);
  return (body.data || []).slice().sort((a, b) => barTimeSec(a) - barTimeSec(b));
}

async function fetchNews(symbol, startSec, endSec, warnings, holdingSymbol) {
  const body = await optionalArrays("/api/v1/stocks/market-news", {
    symbol,
    start_time: startSec,
    end_time: endSec,
    sort_by_type: "PUBLISHED_TIME",
    sort_by: "DESC",
    limit: CONFIG.eventSourceLimits.marketNewsFetch,
  }, warnings, "market-news:" + symbol);
  return (body.data || []).map((item) => {
    const mapping = perTickerSourceMapping(symbol, holdingSymbol, "market-news");
    return {
      sourceType: "news",
      symbol,
      sourceRecordId: item.id ? String(item.id) : "",
      title: item.title || "",
      summary: item.summary || "",
      source: item.source || item.source_domain || "",
      url: item.url || "",
      publishedAtMs: item.publish_time ? item.publish_time * 1000 : Date.parse(item.time_published || "") || null,
      metadata: {
        sourceOrigin: "per_ticker_search",
        sourceLane: "per_ticker_market_news",
        sourceSearchMode: "arrays_market_news_by_symbol",
        querySymbol: symbol,
        sourceRelatedTickers: mergeSourceTickers(mapping.sourceRelatedTickers, item.tickers || []),
        relatedHoldings: mapping.relatedHoldings,
        sentiment: item.overall_sentiment_label || "",
        topics: item.topics || [],
        tickers: item.tickers || [],
      },
    };
  });
}

function normalizeMarketNewsTopic(value) {
  const text = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return SUPPORTED_MARKET_NEWS_TOPICS.indexOf(text) >= 0 ? text : "";
}

function normalizeTickerRows(tickers) {
  return uniqueSymbols((Array.isArray(tickers) ? tickers : []).map((row) => {
    if (typeof row === "string") return row;
    return row && (row.ticker || row.symbol || row.name || "");
  }));
}

function perTickerSourceMapping(querySymbol, holdingSymbol, relationLabel) {
  const query = String(querySymbol || "").toUpperCase();
  const holding = String(holdingSymbol || query || "").toUpperCase();
  if (!holding) {
    return {
      relatedHoldings: [],
      sourceRelatedTickers: normalizeTickerRows(query ? [query] : []),
    };
  }
  const relation = holding === query ? "direct" : "option_underlying";
  const rationale = holding === query
    ? "Fetched by per-ticker " + relationLabel + " query for current holding " + holding + "."
    : "Fetched by per-ticker " + relationLabel + " query for market-data symbol " + query + ", mapped to current holding " + holding + ".";
  return {
    relatedHoldings: [{
      symbol: holding,
      relation,
      confidence: "medium",
      rationale,
      mappingSource: "per_ticker_query_symbol",
    }],
    sourceRelatedTickers: normalizeTickerRows(query ? [query] : []),
  };
}

function mergeSourceTickers(base, extra) {
  return normalizeTickerRows([].concat(base || []).concat(extra || []));
}

function technicalEventsEnabled() {
  return !!(CONFIG.technicalEvents && CONFIG.technicalEvents.enabled && (CONFIG.technicalEvents.detectors || []).length);
}

function technicalDetectorEnabled(detector) {
  return technicalEventsEnabled() && (CONFIG.technicalEvents.detectors || []).indexOf(detector) >= 0;
}

function technicalSeverityAllowed(severity) {
  const min = TECHNICAL_SEVERITY_RANK[CONFIG.technicalEvents.minSeverity] || TECHNICAL_SEVERITY_RANK.medium;
  return (TECHNICAL_SEVERITY_RANK[severity] || TECHNICAL_SEVERITY_RANK.medium) >= min;
}

function fmtLevel(value) {
  if (!Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  return "$" + (abs >= 100 ? value.toFixed(2) : value.toFixed(3));
}

function simpleMovingAverage(values, period) {
  const cleanValues = (values || []).filter(Number.isFinite);
  if (cleanValues.length < period) return null;
  return mean(cleanValues.slice(cleanValues.length - period));
}

function rsiValue(closes, period) {
  const values = (closes || []).filter(Number.isFinite);
  if (values.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss += Math.abs(diff);
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  const rs = gain / loss;
  return 100 - (100 / (1 + rs));
}

function averageTrueRange(bars, period) {
  const rows = (bars || []).filter((bar) =>
    Number.isFinite(barHigh(bar)) && Number.isFinite(barLow(bar)) && Number.isFinite(barClose(bar)));
  if (rows.length < 2) return null;
  const start = Math.max(1, rows.length - period);
  const ranges = [];
  for (let i = start; i < rows.length; i += 1) {
    const high = barHigh(rows[i]);
    const low = barLow(rows[i]);
    const prevClose = barClose(rows[i - 1]);
    ranges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return ranges.length ? mean(ranges) : null;
}

function technicalContext(holding, marketDataSymbol, dailyBars, priceSignal, runAtMs) {
  const completed = (Array.isArray(dailyBars) ? dailyBars : [])
    .slice()
    .sort((a, b) => barTimeSec(a) - barTimeSec(b))
    .filter((bar) => Number.isFinite(barClose(bar)));
  if (!completed.length || !priceSignal || !priceSignal.available) return null;
  const latestCompleted = completed[completed.length - 1];
  const latestCompletedSec = barTimeSec(latestCompleted);
  const latestPrice = Number(priceSignal.latestPrice || priceSignal.close);
  const latestPriceAsOfMs = Number(priceSignal.latestPriceAsOfMs || latestCompletedSec * 1000 || runAtMs);
  const liveIsNewer = Number.isFinite(latestPrice) && latestPriceAsOfMs / 1000 > latestCompletedSec;
  const currentPrice = Number.isFinite(latestPrice) ? latestPrice : barClose(latestCompleted);
  const priorBars = liveIsNewer ? completed : completed.slice(0, -1);
  const closesCompleted = completed.map(barClose).filter(Number.isFinite);
  const closesWithCurrent = liveIsNewer && Number.isFinite(currentPrice)
    ? closesCompleted.concat([currentPrice])
    : closesCompleted;
  return {
    holding,
    holdingSymbol: String(holding && holding.symbol || marketDataSymbol || "").toUpperCase(),
    marketDataSymbol: String(marketDataSymbol || holding && holding.symbol || "").toUpperCase(),
    completed,
    priorBars,
    latestCompleted,
    currentPrice,
    previousClose: liveIsNewer ? barClose(latestCompleted) : (priorBars.length ? barClose(priorBars[priorBars.length - 1]) : null),
    eventAtMs: Number.isFinite(latestPriceAsOfMs) ? latestPriceAsOfMs : runAtMs,
    runAtMs,
    closesCompleted,
    closesWithCurrent,
    oneDayPct: priceSignal.oneDayPct,
    volumeMultiple: Number.isFinite(priceSignal.cumulativeVolumeMultiple)
      ? priceSignal.cumulativeVolumeMultiple
      : priceSignal.dailyVolumeMultiple,
    rsi14: rsiValue(closesWithCurrent, CONFIG.technicalEvents.rsiPeriod),
    atr: averageTrueRange(completed, CONFIG.technicalEvents.atrPeriod),
  };
}

function makeTechnicalEvent(ctx, type, detectorId, timeframe, title, summary, severity, indicators) {
  if (!technicalSeverityAllowed(severity)) return null;
  const mapping = perTickerSourceMapping(ctx.marketDataSymbol, ctx.holdingSymbol, "technical-analysis");
  const dateKey = new Date(ctx.eventAtMs).toISOString().slice(0, 10);
  return {
    sourceType: "technical_event",
    symbol: ctx.marketDataSymbol,
    sourceRecordId: ["technical", ctx.marketDataSymbol, type, detectorId, timeframe, dateKey].join(":"),
    title,
    summary,
    source: "Computed technical analysis",
    url: "",
    publishedAtMs: ctx.eventAtMs,
    metadata: {
      sourceOrigin: "computed_technical_analysis",
      sourceLane: "technical_analysis",
      sourceSearchMode: "computed_from_ohlcv",
      querySymbol: ctx.marketDataSymbol,
      technicalEventType: type,
      detectorId,
      timeframe,
      severity,
      confidence: severity === "high" ? "high" : "medium",
      indicators: indicators || {},
      sourceText: summary,
      sourceRelatedTickers: mergeSourceTickers(mapping.sourceRelatedTickers, [ctx.marketDataSymbol]),
      relatedHoldings: mapping.relatedHoldings,
    },
  };
}

function detectBreakoutTechnicalEvents(ctx) {
  if (!technicalDetectorEnabled("breakout")) return [];
  const out = [];
  const lookbacks = [CONFIG.technicalEvents.longBreakoutLookbackDays, CONFIG.technicalEvents.breakoutLookbackDays];
  for (let i = 0; i < lookbacks.length; i += 1) {
    const lookback = lookbacks[i];
    if (ctx.priorBars.length < lookback) continue;
    const rows = ctx.priorBars.slice(ctx.priorBars.length - lookback);
    const resistance = Math.max.apply(null, rows.map(barHigh).filter(Number.isFinite));
    const support = Math.min.apply(null, rows.map(barLow).filter(Number.isFinite));
    const resistanceBuffer = Math.max(resistance * CONFIG.technicalEvents.levelBufferPct, (ctx.atr || 0) * CONFIG.technicalEvents.atrBufferMultiple);
    const supportBuffer = Math.max(support * CONFIG.technicalEvents.levelBufferPct, (ctx.atr || 0) * CONFIG.technicalEvents.atrBufferMultiple);
    const volumeText = Number.isFinite(ctx.volumeMultiple) && ctx.volumeMultiple >= CONFIG.technicalEvents.volumeMultiple
      ? " on elevated volume (" + round(ctx.volumeMultiple, 2) + "x)"
      : "";
    if (Number.isFinite(resistance) && ctx.currentPrice > resistance + resistanceBuffer && (!Number.isFinite(ctx.previousClose) || ctx.previousClose <= resistance + resistanceBuffer)) {
      out.push(makeTechnicalEvent(
        ctx,
        "breakout",
        "daily_breakout_v1",
        "1d",
        ctx.marketDataSymbol + " breaks above " + lookback + "D resistance" + volumeText,
        ctx.marketDataSymbol + " technical breakout: latest price " + fmtLevel(ctx.currentPrice) + " cleared " + lookback + "D resistance near " + fmtLevel(resistance) + "; 1D move " + fmtMove(ctx.oneDayPct) + ", volume " + (Number.isFinite(ctx.volumeMultiple) ? round(ctx.volumeMultiple, 2) + "x" : "n/a") + ", RSI" + CONFIG.technicalEvents.rsiPeriod + " " + round(ctx.rsi14, 1) + ".",
        lookback >= 55 ? "high" : "medium",
        { currentPrice: round(ctx.currentPrice, 4), resistance: round(resistance, 4), lookbackDays: lookback, volumeMultiple: round(ctx.volumeMultiple, 2), rsi: round(ctx.rsi14, 1), atr: round(ctx.atr, 4) }
      ));
      break;
    }
    if (Number.isFinite(support) && ctx.currentPrice < support - supportBuffer && (!Number.isFinite(ctx.previousClose) || ctx.previousClose >= support - supportBuffer)) {
      out.push(makeTechnicalEvent(
        ctx,
        "breakdown",
        "daily_breakout_v1",
        "1d",
        ctx.marketDataSymbol + " breaks below " + lookback + "D support" + volumeText,
        ctx.marketDataSymbol + " technical breakdown: latest price " + fmtLevel(ctx.currentPrice) + " fell below " + lookback + "D support near " + fmtLevel(support) + "; 1D move " + fmtMove(ctx.oneDayPct) + ", volume " + (Number.isFinite(ctx.volumeMultiple) ? round(ctx.volumeMultiple, 2) + "x" : "n/a") + ", RSI" + CONFIG.technicalEvents.rsiPeriod + " " + round(ctx.rsi14, 1) + ".",
        lookback >= 55 ? "high" : "medium",
        { currentPrice: round(ctx.currentPrice, 4), support: round(support, 4), lookbackDays: lookback, volumeMultiple: round(ctx.volumeMultiple, 2), rsi: round(ctx.rsi14, 1), atr: round(ctx.atr, 4) }
      ));
      break;
    }
  }
  return out.filter(Boolean);
}

function detectSupportResistanceTechnicalEvents(ctx) {
  if (!technicalDetectorEnabled("support_resistance")) return [];
  const lookback = CONFIG.technicalEvents.supportResistanceLookbackDays;
  if (ctx.priorBars.length < Math.min(20, lookback)) return [];
  const rows = ctx.priorBars.slice(Math.max(0, ctx.priorBars.length - lookback));
  const support = Math.min.apply(null, rows.map(barLow).filter(Number.isFinite));
  const resistance = Math.max.apply(null, rows.map(barHigh).filter(Number.isFinite));
  const latestLow = barLow(ctx.latestCompleted);
  const latestHigh = barHigh(ctx.latestCompleted);
  const supportBuffer = Math.max(support * CONFIG.technicalEvents.levelBufferPct, (ctx.atr || 0) * CONFIG.technicalEvents.atrBufferMultiple);
  const resistanceBuffer = Math.max(resistance * CONFIG.technicalEvents.levelBufferPct, (ctx.atr || 0) * CONFIG.technicalEvents.atrBufferMultiple);
  const out = [];
  if (Number.isFinite(support) && Number.isFinite(latestLow) && latestLow <= support + supportBuffer && ctx.currentPrice > support + supportBuffer && (ctx.oneDayPct || 0) > 0) {
    out.push(makeTechnicalEvent(
      ctx,
      "support_bounce",
      "support_resistance_v1",
      "1d",
      ctx.marketDataSymbol + " bounces from support near " + fmtLevel(support),
      ctx.marketDataSymbol + " tested support near " + fmtLevel(support) + " and reclaimed it; latest price " + fmtLevel(ctx.currentPrice) + ", 1D move " + fmtMove(ctx.oneDayPct) + ", volume " + (Number.isFinite(ctx.volumeMultiple) ? round(ctx.volumeMultiple, 2) + "x" : "n/a") + ".",
      "medium",
      { currentPrice: round(ctx.currentPrice, 4), support: round(support, 4), lookbackDays: lookback, volumeMultiple: round(ctx.volumeMultiple, 2), atr: round(ctx.atr, 4) }
    ));
  }
  if (Number.isFinite(resistance) && Number.isFinite(latestHigh) && latestHigh >= resistance - resistanceBuffer && ctx.currentPrice < resistance - resistanceBuffer && (ctx.oneDayPct || 0) < 0) {
    out.push(makeTechnicalEvent(
      ctx,
      "resistance_rejection",
      "support_resistance_v1",
      "1d",
      ctx.marketDataSymbol + " rejects resistance near " + fmtLevel(resistance),
      ctx.marketDataSymbol + " tested resistance near " + fmtLevel(resistance) + " and faded; latest price " + fmtLevel(ctx.currentPrice) + ", 1D move " + fmtMove(ctx.oneDayPct) + ", volume " + (Number.isFinite(ctx.volumeMultiple) ? round(ctx.volumeMultiple, 2) + "x" : "n/a") + ".",
      "medium",
      { currentPrice: round(ctx.currentPrice, 4), resistance: round(resistance, 4), lookbackDays: lookback, volumeMultiple: round(ctx.volumeMultiple, 2), atr: round(ctx.atr, 4) }
    ));
  }
  return out.filter(Boolean);
}

function detectRsiTechnicalEvents(ctx) {
  if (!technicalDetectorEnabled("rsi")) return [];
  const period = CONFIG.technicalEvents.rsiPeriod;
  const prev = rsiValue(ctx.closesWithCurrent.slice(0, -1), period);
  const curr = rsiValue(ctx.closesWithCurrent, period);
  if (!Number.isFinite(prev) || !Number.isFinite(curr)) return [];
  const overbought = CONFIG.technicalEvents.rsiOverbought;
  const oversold = CONFIG.technicalEvents.rsiOversold;
  const rows = [];
  if (prev <= overbought && curr > overbought) {
    rows.push(["rsi_overbought_break", ctx.marketDataSymbol + " RSI crosses above " + overbought, "RSI" + period + " rose from " + round(prev, 1) + " to " + round(curr, 1) + ", putting " + ctx.marketDataSymbol + " into momentum/overbought territory.", "medium"]);
  } else if (prev >= overbought && curr < overbought) {
    rows.push(["rsi_overbought_exit", ctx.marketDataSymbol + " RSI falls back below " + overbought, "RSI" + period + " fell from " + round(prev, 1) + " to " + round(curr, 1) + ", weakening the overbought momentum setup.", "medium"]);
  }
  if (prev >= oversold && curr < oversold) {
    rows.push(["rsi_oversold_break", ctx.marketDataSymbol + " RSI crosses below " + oversold, "RSI" + period + " fell from " + round(prev, 1) + " to " + round(curr, 1) + ", putting " + ctx.marketDataSymbol + " into oversold territory.", "medium"]);
  } else if (prev <= oversold && curr > oversold) {
    rows.push(["rsi_oversold_reclaim", ctx.marketDataSymbol + " RSI reclaims " + oversold + " from oversold", "RSI" + period + " rose from " + round(prev, 1) + " to " + round(curr, 1) + ", a possible momentum repair from oversold conditions.", "medium"]);
  }
  return rows.map((row) => makeTechnicalEvent(
    ctx,
    row[0],
    "rsi_v1",
    "1d",
    row[1],
    row[2] + " Latest price " + fmtLevel(ctx.currentPrice) + ", 1D move " + fmtMove(ctx.oneDayPct) + ".",
    row[3],
    { currentPrice: round(ctx.currentPrice, 4), rsiPrevious: round(prev, 1), rsiCurrent: round(curr, 1), period }
  )).filter(Boolean);
}

function detectMovingAverageTechnicalEvents(ctx) {
  if (!technicalDetectorEnabled("ma_cross")) return [];
  const pairs = [
    { fast: CONFIG.technicalEvents.maFastPeriod, slow: CONFIG.technicalEvents.maSlowPeriod, label: "golden/death", severity: "high" },
    { fast: CONFIG.technicalEvents.shortMaFastPeriod, slow: CONFIG.technicalEvents.shortMaSlowPeriod, label: "short-term", severity: "medium" },
  ];
  const out = [];
  pairs.forEach((pair) => {
    const closes = ctx.closesWithCurrent;
    if (closes.length < pair.slow + 1) return;
    const prevCloses = closes.slice(0, -1);
    const prevFast = simpleMovingAverage(prevCloses, pair.fast);
    const prevSlow = simpleMovingAverage(prevCloses, pair.slow);
    const currFast = simpleMovingAverage(closes, pair.fast);
    const currSlow = simpleMovingAverage(closes, pair.slow);
    if (!Number.isFinite(prevFast) || !Number.isFinite(prevSlow) || !Number.isFinite(currFast) || !Number.isFinite(currSlow)) return;
    if (prevFast <= prevSlow && currFast > currSlow) {
      out.push(makeTechnicalEvent(
        ctx,
        pair.slow >= 200 ? "golden_cross" : "ma_bull_cross",
        "ma_cross_v1",
        "1d",
        ctx.marketDataSymbol + " " + pair.fast + "D MA crosses above " + pair.slow + "D MA",
        ctx.marketDataSymbol + " bullish moving-average cross: " + pair.fast + "D MA " + fmtLevel(currFast) + " moved above " + pair.slow + "D MA " + fmtLevel(currSlow) + "; latest price " + fmtLevel(ctx.currentPrice) + ".",
        pair.severity,
        { currentPrice: round(ctx.currentPrice, 4), fastPeriod: pair.fast, slowPeriod: pair.slow, fastMa: round(currFast, 4), slowMa: round(currSlow, 4) }
      ));
    } else if (prevFast >= prevSlow && currFast < currSlow) {
      out.push(makeTechnicalEvent(
        ctx,
        pair.slow >= 200 ? "death_cross" : "ma_bear_cross",
        "ma_cross_v1",
        "1d",
        ctx.marketDataSymbol + " " + pair.fast + "D MA crosses below " + pair.slow + "D MA",
        ctx.marketDataSymbol + " bearish moving-average cross: " + pair.fast + "D MA " + fmtLevel(currFast) + " moved below " + pair.slow + "D MA " + fmtLevel(currSlow) + "; latest price " + fmtLevel(ctx.currentPrice) + ".",
        pair.severity,
        { currentPrice: round(ctx.currentPrice, 4), fastPeriod: pair.fast, slowPeriod: pair.slow, fastMa: round(currFast, 4), slowMa: round(currSlow, 4) }
      ));
    }
  });
  return out.filter(Boolean);
}

function detectVolumePriceTechnicalEvents(ctx) {
  if (!technicalDetectorEnabled("volume_price")) return [];
  const volumeMultiple = ctx.volumeMultiple;
  const move = ctx.oneDayPct;
  if (!Number.isFinite(volumeMultiple) || !Number.isFinite(move)) return [];
  if (volumeMultiple < CONFIG.technicalEvents.volumeMultiple || Math.abs(move) < CONFIG.technicalEvents.volumePriceMovePct) return [];
  const bullish = move > 0;
  return [makeTechnicalEvent(
    ctx,
    bullish ? "volume_price_bullish" : "volume_price_bearish",
    "volume_price_v1",
    "1d",
    ctx.marketDataSymbol + " " + (bullish ? "advances" : "declines") + " on elevated volume",
    ctx.marketDataSymbol + " " + (bullish ? "advanced" : "declined") + " " + fmtMove(move) + " with cumulative volume at " + round(volumeMultiple, 2) + "x the same-time baseline. This is computed market-structure evidence, not a fundamental catalyst.",
    Math.abs(move) >= CONFIG.materiality.priceOneDayPct || volumeMultiple >= CONFIG.materiality.cumulativeVolumeMultiple ? "high" : "medium",
    { currentPrice: round(ctx.currentPrice, 4), oneDayPct: round(move, 2), volumeMultiple: round(volumeMultiple, 2), rsi: round(ctx.rsi14, 1) }
  )].filter(Boolean);
}

function buildTechnicalEvents(holding, marketDataSymbol, dailyBars, hourlyBars, minuteBars, priceSignal, runAtMs) {
  if (!technicalEventsEnabled()) return [];
  const ctx = technicalContext(holding, marketDataSymbol, dailyBars, priceSignal, runAtMs);
  if (!ctx) return [];
  const detectors = [
    detectBreakoutTechnicalEvents,
    detectSupportResistanceTechnicalEvents,
    detectRsiTechnicalEvents,
    detectMovingAverageTechnicalEvents,
    detectVolumePriceTechnicalEvents,
  ];
  const seen = {};
  const events = [];
  detectors.forEach((detector) => {
    detector(ctx).forEach((event) => {
      if (!event || seen[event.sourceRecordId]) return;
      seen[event.sourceRecordId] = true;
      events.push(event);
    });
  });
  return events.slice(0, CONFIG.technicalEvents.maxEventsPerHolding);
}

function normalizeThemeTopicMappings(parsed, themeContexts) {
  const rows = Array.isArray(parsed && parsed.themeTopicMappings)
    ? parsed.themeTopicMappings
    : (Array.isArray(parsed && parsed.theme_topic_mappings) ? parsed.theme_topic_mappings : []);
  const mappedByTheme = {};
  rows.forEach((row) => {
    const theme = normalizeThemeName(row && (row.theme || row.theme_id || row.themeId));
    if (!theme) return;
    const topics = uniqueCompactStrings(
      (Array.isArray(row.topics) ? row.topics : [row.topic]).map(normalizeMarketNewsTopic).filter(Boolean),
      80
    );
    mappedByTheme[theme] = {
      theme,
      topics,
      reason: clean(row.reason || row.mapping_reason || "", 360),
    };
  });
  return (themeContexts || []).map((context) => {
    const theme = normalizeThemeName(context.theme);
    const mapped = mappedByTheme[theme] || { theme, topics: [], reason: "" };
    const topics = uniqueCompactStrings(mapped.topics || [], 80);
    return {
      theme,
      topics,
      status: topics.length ? "mapped" : "no_supported_topic",
      reason: mapped.reason || (topics.length ? "Pi mapped this portfolio theme to supported Arrays market-news topics." : "Pi did not find a supported Arrays market-news topic for this theme."),
      linked_holdings: context.linked_holdings || [],
      allocation: context.allocation || 0,
    };
  }).filter((row) => row.theme);
}

async function fetchPriceTargetNews(symbol, startSec, endSec, warnings, holdingSymbol) {
  const body = await optionalArrays("/api/v1/stocks/company/price-target-news", {
    symbol,
    start_time: startSec,
    end_time: endSec,
    limit: CONFIG.eventSourceLimits.priceTargetFetch,
  }, warnings, "price-target-news:" + symbol);
  return (body.data || []).map((item) => {
    const itemSymbol = item.symbol || symbol;
    const mapping = perTickerSourceMapping(symbol, holdingSymbol, "price-target");
    return {
      sourceType: "analyst",
      symbol: itemSymbol,
      sourceRecordId: item.news_url || item.news_title || "",
      title: item.news_title || "Price target news",
      summary: [
        item.analyst_company || "",
        Number.isFinite(item.price_target) ? "target " + item.price_target : "",
        Number.isFinite(item.price_when_posted) ? "price_when_posted " + item.price_when_posted : "",
      ].filter(Boolean).join(" · "),
      source: item.news_publisher || item.analyst_company || "",
      url: item.news_url || "",
      publishedAtMs: item.observed_at ? item.observed_at * 1000 : Date.parse(item.publish_time || "") || null,
      metadata: {
        ...item,
        sourceOrigin: "per_ticker_search",
        sourceLane: "per_ticker_price_target",
        sourceSearchMode: "arrays_price_target_news_by_symbol",
        querySymbol: symbol,
        sourceRelatedTickers: mergeSourceTickers(mapping.sourceRelatedTickers, itemSymbol ? [itemSymbol] : []),
        relatedHoldings: mapping.relatedHoldings,
      },
    };
  });
}

async function fetchEarnings(symbol, nowSec, warnings, holdingSymbol) {
  const body = await optionalArrays("/api/v1/stocks/earnings-calendar", {
    symbol,
    start_time: nowSec - 7 * 86400,
    end_time: nowSec + 45 * 86400,
  }, warnings, "earnings-calendar:" + symbol);
  return (body.data || []).map((item) => {
    const itemSymbol = item.symbol || symbol;
    const eventAtMs = Date.parse((item.date || "") + "T12:00:00Z") || null;
    const mapping = perTickerSourceMapping(symbol, holdingSymbol, "earnings-calendar");
    return {
      sourceType: "corporate_event",
      symbol: itemSymbol,
      sourceRecordId: item.id ? String(item.id) : [symbol, item.date, item.time].join(":"),
      title: symbol + " earnings " + (item.date || ""),
      summary: "Earnings calendar: " + (item.date || "unknown date") + " " + (item.time || ""),
      source: "Arrays earnings-calendar",
      url: "",
      publishedAtMs: null,
      metadata: {
        ...item,
        eventAtMs,
        sourceOrigin: "per_ticker_search",
        sourceLane: "per_ticker_earnings_calendar",
        sourceSearchMode: "arrays_earnings_calendar_by_symbol",
        querySymbol: symbol,
        sourceRelatedTickers: mergeSourceTickers(mapping.sourceRelatedTickers, itemSymbol ? [itemSymbol] : []),
        relatedHoldings: mapping.relatedHoldings,
      },
    };
  });
}

function parseSourceMs(value) {
  if (!value) return null;
  const text = String(value);
  let ms = Date.parse(text);
  if (!Number.isFinite(ms) && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    ms = Date.parse(text + "T00:00:00Z");
  }
  return Number.isFinite(ms) ? ms : null;
}

function macroPoint(kind, symbol, row, fetchedAtMs) {
  if (!row) return null;
  const sourceDate = row.date || row.timestamp || row.time || "";
  const sourceAsOfMs = parseSourceMs(sourceDate);
  return {
    ...row,
    kind,
    symbol: row.symbol || symbol,
    fetchedAtMs,
    fetchedAtHkt: hkt(fetchedAtMs),
    sourceDate,
    sourceAsOfMs,
    sourceAsOfHkt: Number.isFinite(sourceAsOfMs) ? hkt(sourceAsOfMs) : "",
    sourceAgeHours: Number.isFinite(sourceAsOfMs) ? round((fetchedAtMs - sourceAsOfMs) / 3600000, 2) : null,
    timestampPrecision: sourceDate ? "date" : "missing",
    freshnessNote: sourceDate
      ? "Macro endpoint provides date-level source timestamp; fetchedAtMs is retrieval time."
      : "Macro endpoint did not provide a source timestamp; use as contextual only.",
  };
}

function macroFreshnessSummary(macro) {
  return Object.keys(macro || {})
    .filter((key) => key !== "_meta")
    .map((key) => {
      const row = macro[key] || {};
      return {
        key,
        sourceDate: row.sourceDate || row.date || "",
        sourceAsOfHkt: row.sourceAsOfHkt || "",
        fetchedAtHkt: row.fetchedAtHkt || "",
        sourceAgeHours: row.sourceAgeHours,
        timestampPrecision: row.timestampPrecision || "",
      };
    });
}

async function fetchMacro(warnings) {
  const fetchedAtMs = Date.now();
  const out = {
    _meta: {
      fetchedAtMs,
      fetchedAtHkt: hkt(fetchedAtMs),
      timestampPolicy: "Macro data is fetched once per run. Arrays macro real-time/rates endpoints currently expose date-level source timestamps, so analyst should treat sourceDate/sourceAge as freshness context and fetchedAt as retrieval time.",
    },
  };
  const indexSymbols = ["^SPX", "^IXIC", "^VIX"];
  for (const symbol of indexSymbols) {
    const body = await optionalArrays("/api/v1/macro/index/real-time", { symbol }, warnings, "macro-index:" + symbol);
    out[symbol] = macroPoint("index", symbol, (body.data || [])[0] || null, fetchedAtMs);
  }
  const oil = await optionalArrays("/api/v1/macro/commodity/real-time", { symbol: "CLUSD" }, warnings, "macro-oil:CLUSD");
  out.CLUSD = macroPoint("commodity", "CLUSD", (oil.data || [])[0] || null, fetchedAtMs);
  const rates = await optionalArrays("/api/v1/macro/treasury-rates", {}, warnings, "macro-rates");
  out.rates = macroPoint("treasury_rates", "UST", (rates.data || [])[0] || null, fetchedAtMs);
  out._meta.items = macroFreshnessSummary(out);
  return out;
}

function polymarketEventUrl(item) {
  const slug = item && (item.slug || item.eventSlug);
  return slug ? "https://polymarket.com/event/" + slug : "https://polymarket.com";
}

function polymarketMarketUrl(item) {
  const slug = item && item.slug;
  return slug ? "https://polymarket.com/market/" + slug : polymarketEventUrl(item);
}

function yesOutcomeSnapshot(market) {
  const outcomes = parseJsonArrayField(market && market.outcomes);
  const prices = parseJsonArrayField(market && market.outcomePrices);
  const tokenIds = parseJsonArrayField(market && market.clobTokenIds);
  const yesIdx = outcomes.map((row) => String(row || "").toLowerCase()).indexOf("yes");
  const idx = yesIdx >= 0 ? yesIdx : 0;
  const probability = amount(prices[idx]);
  const tokenId = tokenIds[idx] ? String(tokenIds[idx]) : "";
  return {
    outcome: outcomes[idx] || "Yes",
    probability,
    tokenId,
  };
}

function closestHistoryPoint(history, targetSec) {
  let best = null;
  let bestDistance = Infinity;
  (history || []).forEach((point) => {
    const t = Number(point && point.t);
    const p = amount(point && point.p);
    if (!Number.isFinite(t) || !Number.isFinite(p)) return;
    const distance = Math.abs(t - targetSec);
    if (distance < bestDistance) {
      best = { t, p };
      bestDistance = distance;
    }
  });
  return best;
}

function rateDecisionEndMs(event) {
  const direct = parseSourceMs(event && event.endDate);
  if (Number.isFinite(direct)) return direct;
  const markets = Array.isArray(event && event.markets) ? event.markets : [];
  const times = markets.map((market) => parseSourceMs(market && market.endDate)).filter(Number.isFinite);
  return times.length ? Math.min.apply(null, times) : null;
}

function isFedDecisionEvent(event) {
  const title = String((event && (event.title || event.question)) || "");
  return /fed decision/i.test(title);
}

function isFedDecisionMarket(market) {
  const q = String((market && market.question) || "").toLowerCase();
  return q.indexOf("fed") >= 0 && (
    q.indexOf("interest rates") >= 0 ||
    q.indexOf("increase") >= 0 ||
    q.indexOf("decrease") >= 0 ||
    q.indexOf("no change") >= 0
  );
}

function rateMoveLabel(question) {
  const text = String(question || "");
  const lower = text.toLowerCase();
  const bpsMatch = text.match(/([0-9]+)\s*\+?\s*bps/i);
  const bps = bpsMatch ? bpsMatch[1] + " bps " : "";
  if (lower.indexOf("no change") >= 0) return "no-change";
  if (lower.indexOf("increase") >= 0 || lower.indexOf("hike") >= 0) return bps + "hike";
  if (lower.indexOf("decrease") >= 0 || lower.indexOf("cut") >= 0) return bps + "cut";
  return clean(text.replace(/^will\s+/i, "").replace(/\?$/, ""), 80);
}

function fmtProbabilityPct(value) {
  return Number.isFinite(value) ? (value * 100).toFixed(1) + "%" : "n/a";
}

function fmtPp(value) {
  if (!Number.isFinite(value)) return "n/a";
  return (value >= 0 ? "+" : "") + value.toFixed(1) + "pp";
}

function compactRateMarket(event, market, current, previousPoint) {
  const currentProbability = current.probability;
  const previousProbability = previousPoint && Number.isFinite(previousPoint.p) ? previousPoint.p : null;
  const deltaPct = Number.isFinite(currentProbability) && Number.isFinite(previousProbability)
    ? round((currentProbability - previousProbability) * 100, 2)
    : null;
  return {
    eventTitle: clean(event && event.title || "", 140),
    eventSlug: event && event.slug || "",
    marketId: String(market && market.id || ""),
    conditionId: String(market && market.conditionId || ""),
    question: clean(market && market.question || "", 180),
    label: rateMoveLabel(market && market.question),
    outcome: current.outcome,
    currentProbability,
    currentProbabilityPct: Number.isFinite(currentProbability) ? round(currentProbability * 100, 2) : null,
    previousProbability,
    previousProbabilityPct: Number.isFinite(previousProbability) ? round(previousProbability * 100, 2) : null,
    probabilityChangePct: deltaPct,
    previousPointHkt: previousPoint && previousPoint.t ? hkt(previousPoint.t * 1000) : "",
    volume: amount((market && (market.volumeNum !== undefined ? market.volumeNum : market.volume)) || null),
    volume24hr: amount(market && market.volume24hr),
    volume1wk: amount(market && market.volume1wk),
    liquidity: amount((market && (market.liquidityNum !== undefined ? market.liquidityNum : market.liquidity)) || null),
    openInterest: amount((market && market.openInterest) || (event && event.openInterest)),
    url: polymarketMarketUrl(market),
  };
}

async function fetchPolymarketRateDecisionEvents(runAtMs, warnings) {
  const searchQueries = ["Fed Decision interest rates", "Fed interest rates 2026"];
  const eventByKey = {};
  for (const q of searchQueries) {
    const body = await externalJson(POLYMARKET_GAMMA_BASE, "/public-search", {
      q,
      limit_per_type: 12,
      events_status: "active",
      keep_closed_markets: 0,
    }, warnings, "rate-repricing-polymarket-search:" + q);
    ((body && body.events) || []).forEach((event) => {
      const key = event && (event.id || event.slug || event.ticker || event.title);
      if (key) eventByKey[key] = event;
    });
  }
  const events = Object.keys(eventByKey).map((key) => eventByKey[key])
    .filter(isFedDecisionEvent)
    .map((event) => ({ event, endMs: rateDecisionEndMs(event) }))
    .filter((row) => Number.isFinite(row.endMs) && row.endMs > runAtMs - 3600000)
    .sort((a, b) => a.endMs - b.endMs)
    .slice(0, RATE_REPRICING_DECISION_COUNT)
    .map((row) => row.event);
  const targetSec = Math.floor((runAtMs - RATE_REPRICING_LOOKBACK_HOURS * 3600000) / 1000);
  const marketRows = [];
  for (const event of events) {
    const markets = (Array.isArray(event.markets) ? event.markets : [])
      .filter(isFedDecisionMarket);
    for (const market of markets) {
      const current = yesOutcomeSnapshot(market);
      if (!current.tokenId || !Number.isFinite(current.probability)) continue;
      const historyBody = await externalJson(POLYMARKET_CLOB_BASE, "/prices-history", {
        market: current.tokenId,
        interval: "1d",
        fidelity: 60,
      }, warnings, "rate-repricing-polymarket-history:" + (market.id || current.tokenId));
      const previousPoint = closestHistoryPoint((historyBody && historyBody.history) || [], targetSec);
      marketRows.push(compactRateMarket(event, market, current, previousPoint));
    }
  }
  return { events, marketRows };
}

function buildRateRepricingComputedEvents(rateData, runAtMs) {
  const threshold = CONFIG.rateRepricingEvents.probabilityChangeThresholdPct;
  const grouped = {};
  (rateData.marketRows || []).forEach((row) => {
    if (!Number.isFinite(row.probabilityChangePct) || Math.abs(row.probabilityChangePct) < threshold) return;
    const key = row.eventSlug || row.eventTitle || "fed-decision";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  });
  return Object.keys(grouped).map((key) => {
    const rows = grouped[key].slice().sort((a, b) => Math.abs(b.probabilityChangePct || 0) - Math.abs(a.probabilityChangePct || 0));
    const top = rows[0] || {};
    const eventTitle = top.eventTitle || "Fed decision";
    const moveText = rows.slice(0, 4).map((row) => (
      row.label + " " + fmtPp(row.probabilityChangePct) + " to " + fmtProbabilityPct(row.currentProbability)
    )).join("; ");
    const volumeText = rows.slice(0, 3).map((row) => (
      row.label + " volume $" + Math.round(row.volume || 0).toLocaleString("en-US") +
      ", 24h $" + Math.round(row.volume24hr || 0).toLocaleString("en-US") +
      ", liquidity $" + Math.round(row.liquidity || 0).toLocaleString("en-US")
    )).join("; ");
    return {
      sourceType: "rate_repricing_event",
      sourceRecordId: "polymarket-rate-repricing-" + normalizeKey(key),
      symbol: "PORTFOLIO",
      title: eventTitle.replace(/\?$/, "") + " odds repriced: " + top.label + " " + fmtPp(top.probabilityChangePct),
      summary: "Polymarket-implied Fed decision probabilities changed over the last " + RATE_REPRICING_LOOKBACK_HOURS + " hours: " + moveText + ". Market depth context: " + volumeText + ".",
      source: "Polymarket",
      url: polymarketEventUrl({ slug: top.eventSlug }),
      sourceLinks: [polymarketEventUrl({ slug: top.eventSlug })],
      affectedThemes: ["rates", "policy-path", "liquidity", "risk-appetite"],
      publishedAtMs: runAtMs,
      metadata: {
        sourceOrigin: "rate_repricing_lane",
        sourceLane: "rate_repricing",
        sourceSearchMode: "polymarket_next_three_fed_decisions_24h_delta",
        riskFactors: ["rates", "policy-path", "liquidity", "risk-appetite", "valuation-multiple"],
        portfolioRelevanceBasis: "Market-implied Fed path repricing can affect a long-duration, AI/tech, crypto, and broad risk-asset portfolio through discount rates, liquidity, risk appetite, and valuation multiples.",
        rateRepricingSupport: true,
        lookbackHours: RATE_REPRICING_LOOKBACK_HOURS,
        probabilityChangeThresholdPct: threshold,
        decisionMarketCount: RATE_REPRICING_DECISION_COUNT,
        materialMoves: rows,
        allDecisionMarkets: (rateData.marketRows || []).filter((row) => row.eventSlug === top.eventSlug),
      },
    };
  });
}

async function fetchRateRepricingNews(rateEvents, runAtMs, warnings) {
  if (!rateEvents.length) return [];
  try {
    const { searchBrave } = require("@arrays/data/search/search-brave:v1.0.0");
    const top = rateEvents[0];
    const query = [
      "Fed rate expectations prediction markets",
      "rate hike odds",
      "market pricing",
      "why changed today",
      clean(top.title || "", 80),
    ].filter(Boolean).join(" ");
    const result = await searchBrave({
      query,
      result_filter: "news",
      freshness: "pd",
      count: RATE_REPRICING_NEWS_LIMIT,
    });
    return ((((result || {}).response || {}).data || []).slice(0, RATE_REPRICING_NEWS_LIMIT).map((row, idx) => {
      const publishedAtMs = parseSourceMs(row.date || row.published_at || row.age || "") || runAtMs;
      return {
        sourceType: "rate_repricing_news",
        sourceRecordId: row.url || row.title || ("rate-repricing-news-" + idx),
        symbol: "PORTFOLIO",
        title: clean(row.title || "", 240),
        summary: clean(row.description || row.title || "", 700),
        source: row.source || row.source_domain || "Brave News",
        url: row.url || "",
        sourceLinks: row.url ? [row.url] : [],
        affectedThemes: ["rates", "policy-path", "liquidity", "risk-appetite"],
        publishedAtMs,
        metadata: {
          sourceOrigin: "rate_repricing_lane",
          sourceLane: "rate_repricing_news",
          sourceSearchMode: "brave_news_after_prediction_market_delta",
          sourceLinks: row.url ? [row.url] : [],
          riskFactors: ["rates", "policy-path", "liquidity", "risk-appetite", "valuation-multiple"],
          portfolioRelevanceBasis: "Market commentary explaining a material prediction-market Fed path repricing.",
          rateRepricingSupport: true,
          supportingRateMoveEventIds: rateEvents.map((event) => event.sourceRecordId || event.title).filter(Boolean),
          searchQuery: query,
          sourceDate: row.date || row.age || "",
        },
      };
    })).filter((row) => row.title || row.url);
  } catch (err) {
    warnings.push({ source: "rate-repricing-news-search", error: String(err && err.message ? err.message : err).slice(0, 260) });
    return [];
  }
}

async function fetchRateRepricingEvents(runAtMs, warnings) {
  const summary = {
    enabled: CONFIG.rateRepricingEvents.enabled,
    source: "Polymarket",
    lookbackHours: RATE_REPRICING_LOOKBACK_HOURS,
    decisionMarketCount: RATE_REPRICING_DECISION_COUNT,
    probabilityChangeThresholdPct: CONFIG.rateRepricingEvents.probabilityChangeThresholdPct,
    checkedMarkets: 0,
    materialMoveCount: 0,
    computedEventCount: 0,
    newsEventCount: 0,
    marketRows: [],
    error: "",
  };
  if (!CONFIG.rateRepricingEvents.enabled) return { records: [], summary };
  try {
    const rateData = await fetchPolymarketRateDecisionEvents(runAtMs, warnings);
    summary.marketRows = (rateData.marketRows || []).slice(0, 24);
    summary.checkedMarkets = (rateData.marketRows || []).length;
    const computedEvents = buildRateRepricingComputedEvents(rateData, runAtMs);
    const newsEvents = await fetchRateRepricingNews(computedEvents, runAtMs, warnings);
    summary.materialMoveCount = computedEvents.reduce((acc, event) => acc + (((event.metadata || {}).materialMoves || []).length), 0);
    summary.computedEventCount = computedEvents.length;
    summary.newsEventCount = newsEvents.length;
    return { records: computedEvents.concat(newsEvents), summary };
  } catch (err) {
    summary.error = String(err && err.message ? err.message : err).slice(0, 260);
    warnings.push({ source: "rate-repricing-lane", error: summary.error });
    return { records: [], summary };
  }
}

function isoDateOnly(ms) {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function piMessageText(message) {
  const content = message && Array.isArray(message.content) ? message.content : [];
  return content
    .filter((block) => block && block.type === "text")
    .map((block) => block.text || "")
    .join("");
}

function buildPiThemeContexts(snapshot, currentThemes) {
  const seen = {};
  const canComputeSizing = canComputePortfolioSizing(snapshot);
  return (currentThemes || [])
    .filter((row) => row && row.theme && row.theme !== "uncategorized")
    .map((row) => {
      const theme = normalizeThemeName(row.theme);
      return {
        theme,
        allocation: canComputeSizing ? round(row.allocation || 0, 4) : null,
        exposure_available: canComputeSizing,
        linked_holdings: holdingsForTheme(snapshot, theme).map((holding) => ({
          symbol: holding.symbol,
          weight: canComputeSizing ? round(holding.allocation || 0, 4) : null,
        })),
      };
    })
    .filter((row) => {
      if (!row.theme || seen[row.theme]) return false;
      seen[row.theme] = true;
      return true;
	    });
}

function buildPiHoldingContexts(snapshot) {
  const canComputeSizing = canComputePortfolioSizing(snapshot);
  return (snapshot.holdings || []).map((holding) => {
    const marketDataSymbol = marketDataSymbolForHolding(holding);
    const aliases = uniqueCompactStrings(
      []
        .concat(CONFIG.aliases[holding.symbol] || [])
        .concat(CONFIG.aliases[marketDataSymbol] || [])
        .concat([holding.symbol, marketDataSymbol]),
      80
    ).slice(0, 8);
    return {
      holding_symbol: holding.symbol,
      market_data_symbol: marketDataSymbol,
      asset_class: holding.assetClass,
      side: holding.side,
      quantity: canComputeSizing ? holding.quantity : null,
      weight: canComputeSizing ? round(holding.allocation || 0, 4) : null,
      market_value: canComputeSizing && Number.isFinite(holding.marketValue) ? round(holding.marketValue, 2) : null,
      position_size_available: canComputeSizing,
      themes: themesForHolding(snapshot, holding),
      aliases,
      instrument_details: {
        underlying: holding.instrumentDetails && holding.instrumentDetails.underlying || "",
        optionType: holding.instrumentDetails && holding.instrumentDetails.optionType || "",
        expiry: holding.instrumentDetails && holding.instrumentDetails.expiry || "",
        strike: holding.instrumentDetails && holding.instrumentDetails.strike || null,
      },
    };
  });
}

function normalizeConfidence(value) {
  const text = String(value || "").toLowerCase();
  return ["low", "medium", "high"].indexOf(text) >= 0 ? text : "";
}

function arrayFromPossibleObject(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    return Object.keys(value).map((key) => {
      const row = value[key];
      return row && typeof row === "object" ? { symbol: key, ...row } : { symbol: key, rationale: String(row || "") };
    });
  }
  return [];
}

function sourceRelatedTickersFromPiItem(item) {
  return uniqueSymbols(
    []
      .concat(item && item.source_related_tickers || [])
      .concat(item && item.sourceRelatedTickers || [])
      .concat(item && item.source_tickers || [])
      .concat(item && item.symbols || [])
      .concat(item && item.tickers || [])
  );
}

function relatedHoldingsFromPiItem(item, snapshot) {
  const holdingBy = bySymbol(snapshot);
  const rows = []
    .concat(arrayFromPossibleObject(item && item.related_holdings))
    .concat(arrayFromPossibleObject(item && item.relatedHoldings))
    .concat(arrayFromPossibleObject(item && item.holding_mappings))
    .concat(arrayFromPossibleObject(item && item.affected_holdings));
  const byHolding = {};
  rows.forEach((row) => {
    const value = typeof row === "string" ? { symbol: row } : (row || {});
    const symbol = String(
      value.holding_symbol ||
      value.holdingSymbol ||
      value.holding ||
      value.symbol ||
      ""
    ).toUpperCase();
    if (!symbol || !holdingBy[symbol]) return;
    const relation = normalizeRelation(value.relation || value.relationship || value.relation_type || value.relationType || "portfolio_relevance");
    const confidence = normalizeConfidence(value.confidence);
    byHolding[symbol] = {
      symbol,
      relation,
      confidence,
      rationale: clean(value.rationale || value.reason || value.why_relevant || value.whyRelevant || "", 320),
      mappingStrength: strongHoldingRelation(relation, confidence) ? "holding_level" : "context_only",
      mappingSource: "pi_agentic_event_mapping",
    };
  });
  return Object.keys(byHolding)
    .sort((a, b) => ((holdingBy[b] && holdingBy[b].allocation) || 0) - ((holdingBy[a] && holdingBy[a].allocation) || 0))
    .map((symbol) => byHolding[symbol]);
}

function normalizeRelation(value) {
  return clean(value || "", 80).toLowerCase().replace(/[\s-]+/g, "_");
}

function strongHoldingRelation(relation, confidence) {
  const normalized = normalizeRelation(relation);
  if (normalized === "direct") return true;
  if (normalized === "peer_competitor") return true;
  if (normalized === "supplier_customer" || normalized === "customer_supplier") return true;
  if (normalized === "option_underlying") return true;
  if (["second_order", "second_order_demand", "second_order_supply", "value_chain", "downstream_demand", "upstream_supply"].indexOf(normalized) >= 0 && confidence === "high") return true;
  if (normalized === "other" && confidence === "high") return true;
  return false;
}

function contextOnlyRelatedHoldings(rows) {
  return (rows || []).filter((row) => row && row.mappingStrength !== "holding_level");
}

function holdingLevelRelatedHoldings(rows) {
  return (rows || []).filter((row) => row && row.mappingStrength === "holding_level");
}

function piEventSourceType(item, themeNews) {
  const kind = String(item && (item.source_kind || item.sourceKind || item.source_type || item.sourceType) || "").toLowerCase();
  if (themeNews && (kind.indexOf("topic") >= 0 || kind.indexOf("arrays") >= 0)) return "topic_news";
  return themeNews ? "theme_news" : "breaking_news";
}

function inferBreakingNewsSymbols(item, snapshot) {
  const explicit = Array.isArray(item.symbols) ? item.symbols.map((s) => String(s || "").toUpperCase()) : [];
  const holdingBy = bySymbol(snapshot);
  const explicitHeld = explicit.filter((symbol) => !!holdingBy[symbol]);
  if (explicitHeld.length) return explicitHeld;
  const explicitUnderlyingHeld = [];
  explicit.forEach((symbol) => {
    (snapshot.holdings || []).forEach((holding) => {
      if (marketDataSymbolForHolding(holding) === symbol) explicitUnderlyingHeld.push(holding.symbol);
    });
  });
  if (explicitUnderlyingHeld.length) return uniqueSymbols(explicitUnderlyingHeld);

  const text = ((item.title || "") + " " + (item.summary || "") + " " + (item.why_relevant || "")).toLowerCase();
  const itemThemes = normalizedItemThemes(item);
  const inferred = (snapshot.holdings || [])
    .filter((holding) => {
      if (holdingReferenceSymbols(holding).some((symbol) => eventMentionsSymbol({ title: item.title || "", summary: text, metadata: { tickers: explicit } }, symbol))) return true;
      const themes = themesForHolding(snapshot, holding);
      return itemThemes.some((theme) => themes.indexOf(normalizeThemeName(theme)) >= 0);
    })
    .sort((a, b) => (b.allocation || 0) - (a.allocation || 0))
    .slice(0, 6)
    .map((holding) => holding.symbol);
  return inferred;
}

function normalizedItemThemes(item) {
  const out = {};
  if (Array.isArray(item && item.themes)) {
    item.themes.forEach((theme) => {
      const key = String(theme || "").toLowerCase();
      if (key) out[key] = true;
    });
  }
  const matched = String((item && (item.matched_theme || item.theme)) || "").toLowerCase();
  if (matched) out[matched] = true;
  return Object.keys(out);
}

function normalizedItemRiskFactors(item) {
  const out = {};
  []
    .concat(item && item.risk_factors || [])
    .concat(item && item.riskFactors || [])
    .concat(item && item.portfolio_risk_factors || [])
    .concat(item && item.portfolioRiskFactors || [])
    .forEach((factor) => {
      const key = normalizeThemeName(factor);
      if (key) out[key] = true;
    });
  return Object.keys(out);
}

function eventScope(item) {
  return String(item.event_scope || item.source_type || item.source_kind || "").toLowerCase();
}

function isThemeNewsEvent(item) {
  const scope = eventScope(item);
  return scope.indexOf("theme") >= 0 || scope.indexOf("industry") >= 0;
}

function themeAllocationLookup(currentThemes) {
  const out = {};
  (currentThemes || []).forEach((row) => {
    if (row && row.theme) out[String(row.theme).toLowerCase()] = row.allocation || 0;
  });
  return out;
}

function sourceEventTimeValue(item, themeNews) {
  const fieldNames = ["source_event_time", "sourceEventTime", "origin_source_time", "original_source_time"];
  for (const name of fieldNames) {
    if (!Object.prototype.hasOwnProperty.call(item || {}, name)) continue;
    const value = item[name];
    if (value === null) return null;
    const text = String(value || "").trim();
    if (text) return text;
  }
  return themeNews ? "" : null;
}

function normalizeBreakingNewsRecords(parsed, snapshot, runAtMs, currentThemes) {
  const events = Array.isArray(parsed && parsed.events) ? parsed.events : [];
  const records = [];
  const themeAllocationBy = themeAllocationLookup(currentThemes);
	events.slice(0, CONFIG.maxBreakingNewsRecords).forEach((item, idx) => {
	  const title = clean(item.title || item.event_title || "", 240);
	  const summary = clean(item.summary || item.why_relevant || item.market_impact || "", 700);
	  const sourceText = clean(item.source_text || item.sourceText || item.source_text_excerpt || item.sourceTextExcerpt || item.content || item.description || item.raw_text || "", 1600);
	  if (!title && !summary) return;
	  const themeNews = isThemeNewsEvent(item);
	  const sourceType = piEventSourceType(item, themeNews);
		  const allRelatedHoldings = relatedHoldingsFromPiItem(item, snapshot);
		  const relatedHoldings = holdingLevelRelatedHoldings(allRelatedHoldings);
		  const contextualRelatedHoldings = contextOnlyRelatedHoldings(allRelatedHoldings);
		  const matchedSymbols = relatedHoldings.map((row) => row.symbol);
	  const riskFactors = normalizedItemRiskFactors(item);
	  const eventThemes = uniqueCompactStrings(normalizedItemThemes(item).concat(riskFactors), 80).map(normalizeThemeName).filter(Boolean);
	  const sourceRelatedTickers = sourceRelatedTickersFromPiItem(item);
	  const themeAllocation = eventThemes.reduce((acc, theme) => Math.max(acc, themeAllocationBy[theme] || 0), 0);
		  const sourceTweetUrl = clean(
		    item.source_tweet_url ||
		    item.sourceTweetUrl ||
		    item.expanded_from_tweet_url ||
		    item.expandedFromTweetUrl ||
		    item.x_post_url ||
		    item.xPostUrl ||
		    "",
		    500
		  );
		  const sourceTweetId = clean(
		    item.source_tweet_id ||
		    item.sourceTweetId ||
		    item.expanded_from_tweet_id ||
		    item.expandedFromTweetId ||
		    item.x_post_id ||
		    item.xPostId ||
		    "",
		    80
		  );
		  const sourceTweetRank = amount(item.source_tweet_rank || item.sourceTweetRank || item.x_rank || item.xRank);
		  const sourceTweetEngagementScore = amount(item.source_tweet_engagement_score || item.sourceTweetEngagementScore || item.engagement_score || item.engagementScore);
		  const expandedFromTweetUrl = clean(item.expanded_from_tweet_url || item.expandedFromTweetUrl || sourceTweetUrl || "", 500);
		  const expandedFromTweetId = clean(item.expanded_from_tweet_id || item.expandedFromTweetId || sourceTweetId || "", 80);
		  const rawLinks = Array.isArray(item.source_links) ? item.source_links.filter(Boolean) : [];
		  const links = uniqueCompactStrings((sourceTweetUrl ? [sourceTweetUrl] : []).concat(rawLinks), 500).slice(0, 6);
    const publishedAtMs =
      Date.parse(item.published_at_iso || item.event_time_iso || item.publishedAt || "") ||
      Date.parse(item.created_at || "") ||
      null;
    const sourceEventTimeRaw = sourceEventTimeValue(item, themeNews);
    const sourceEventAtMs = parseSourceMs(sourceEventTimeRaw);
    const holdingBy = bySymbol(snapshot);
	    const affectedThemes = uniqueCompactStrings(
	      eventThemes.concat(matchedSymbols.reduce((acc, symbol) => acc.concat(themesForHolding(snapshot, holdingBy[symbol] || { symbol })), [])),
	      80
	    ).map(normalizeThemeName).filter(Boolean);
	    const canComputeSizing = canComputePortfolioSizing(snapshot);
		  const linkedHoldings = matchedSymbols.map((symbol) => ({
		    symbol,
		    weight: canComputeSizing ? round((holdingBy[symbol] && holdingBy[symbol].allocation) || 0, 4) : null,
		  }));
		  const linkedHoldingWeight = canComputeSizing ? linkedHoldings.reduce((acc, row) => acc + (Number(row.weight) || 0), 0) : null;
	  const portfolioRelevanceBasis = clean(
	    item.portfolio_relevance_basis ||
	    item.portfolioRelevanceBasis ||
	    item.why_relevant ||
	    item.market_impact ||
	    "",
	    700
	  );
		  const rawPiMappingReason = clean(item.mapping_reason || item.mappingReason || "", 700);
		  const mappingReason = clean(
		    (matchedSymbols.length ? rawPiMappingReason : "") ||
		    relatedHoldings.map((row) => row.symbol + ": " + (row.rationale || row.relation || "")).join("; ") ||
		    portfolioRelevanceBasis ||
		    (contextualRelatedHoldings.length
		      ? "Context-only thematic read-through returned by Pi for " + contextualRelatedHoldings.map((row) => row.symbol).join(", ") + "; code did not treat these as affected holdings."
		      : "") ||
		    rawPiMappingReason ||
		    "",
		    700
		  );
	  const sourceOrigin = sourceType === "topic_news"
	    ? "arrays_topic_news"
	    : (themeNews ? "pi_theme_search" : "pi_market_breaking_search");
	  const sourceLane = sourceType === "topic_news"
	    ? "pi_arrays_topic_news"
	    : (themeNews ? "pi_theme_news" : "pi_market_breaking");
		  const sourceSearchMode = sourceType === "topic_news"
		    ? "pi_agent_arrays_market_news_by_topic"
		    : (themeNews ? "pi_planned_brave_theme_search" : "arrays_indexed_x_top_tweets");
	  records.push({
	    sourceType,
	    symbol: matchedSymbols.length ? (matchedSymbols.length > 1 ? "PORTFOLIO" : matchedSymbols[0]) : "PORTFOLIO",
	    affectedSymbols: matchedSymbols,
	    affectedThemes,
      sourceRecordId: item.event_id || item.id || links[0] || title || ("pi-event-search-" + idx),
      title,
      summary,
	    source: sourceType === "topic_news"
	      ? "Pi event-search topic-news lane: " + (item.matched_theme || item.source_kind || "Arrays")
	      : (themeNews
	        ? "Pi event-search theme-news lane: " + (item.matched_theme || item.source_kind || "Brave")
	        : (item.source_kind ? "Pi event-search loop: " + item.source_kind : "Pi event-search loop")),
      url: links[0] || "",
      publishedAtMs,
		        mappingReason,
		        rawPiMappingReason,
      metadata: {
        sourceLinks: links,
        confidence: item.confidence || "",
	        whyRelevant: item.why_relevant || "",
	        mappingReason,
	        sourceText,
	        themes: item.themes || (item.matched_theme ? [item.matched_theme] : []),
	        riskFactors,
	        portfolioRelevanceBasis,
	        affectedThemes,
	        affectedSymbols: matchedSymbols,
		        linkedHoldings,
		        relatedHoldings,
		        contextualRelatedHoldings,
		        allRelatedHoldings,
		        sourceRelatedTickers,
		        tickers: sourceRelatedTickers,
		        sourceTweetId,
		        sourceTweetUrl,
		        sourceTweetRank: Number.isFinite(sourceTweetRank) ? sourceTweetRank : null,
		        sourceTweetEngagementScore: Number.isFinite(sourceTweetEngagementScore) ? round(sourceTweetEngagementScore, 3) : null,
		        expandedFromTweetId,
		        expandedFromTweetUrl,
			        holdingMappingPolicy: matchedSymbols.length ? "pi_agent_holding_level_related_holdings_only" : "pi_agent_context_only_or_portfolio_level",
	        portfolioLevelEvent: !matchedSymbols.length,
	        piBreakingNews: !themeNews,
	        piThemeNews: themeNews,
	        sourceOrigin,
	        sourceLane,
	        sourceSearchMode,
	        themeMatched: themeNews,
        matchedTheme: item.matched_theme || eventThemes[0] || "",
        themeAllocation: themeNews ? round(themeAllocation || 0, 4) : null,
        linkedHoldingWeight: round(linkedHoldingWeight || 0, 4),
	        query: item.search_query || item.query || (sourceType === "breaking_news" ? "arrays_indexed_x_top_engagement_recent_90m" : ""),
        sourceTimeLabel: item.source_time_label || item.sourceTimeLabel || item.published_at_label || "",
        sourceEventTime: sourceEventTimeRaw === null ? null : String(sourceEventTimeRaw || ""),
        sourceEventAtMs,
        sourceEventHkt: Number.isFinite(sourceEventAtMs) ? hkt(sourceEventAtMs) : "",
        fetchedAtMs: themeNews ? runAtMs : null,
        fetchedAtHkt: themeNews ? hkt(runAtMs) : "",
	        searchProvider: themeNews ? "Brave via Pi Agent" : (sourceType === "breaking_news" ? "Arrays indexed X via code; Brave source expansion via Pi when used" : ""),
        eventScope: eventScope(item) || (themeNews ? "theme_news" : "market_breaking"),
      },
    });
  });
  return records;
}

function boolValue(value) {
  if (value === true || value === false) return value;
  const text = String(value || "").toLowerCase().trim();
  return text === "true" || text === "1" || text === "yes";
}

function parseAlfsJson(value) {
  if (value && typeof value === "object") return value;
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function externalBreakingRowsFromPayload(payload) {
  if (Array.isArray(payload)) {
    if (payload.length === 1 && Array.isArray(payload[0])) return payload[0];
    return payload;
  }
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  if (payload && Array.isArray(payload.events)) return payload.events;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

function externalBreakingEventTimeMs(row) {
  const parsed =
    parseSourceMs(row && (row.reportedAt || row.publishedAt || row.updatedAt || row.observedAt)) ||
    amount(row && row.date);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeExternalList(value) {
  return uniqueCompactStrings((Array.isArray(value) ? value : parseJsonArrayField(value)).map((item) => {
    if (typeof item === "string") return item;
    return item && (item.tag || item.name || item.value || item.topic || item.assetClass || item.asset_class || item.ticker || item.symbol) || "";
  }), 80).map(normalizeThemeName).filter(Boolean);
}

function pushExternalEvidenceSource(target, item) {
  const url = clean(item && item.url || "", 500);
  const title = clean(item && item.title || "", 180);
  const evidenceSummary = clean(item && item.evidence_summary || item && item.evidenceSummary || "", 280);
  const textExcerpt = clean(item && item.text_excerpt || item && item.textExcerpt || "", 280);
  if (!url && !title && !evidenceSummary && !textExcerpt) return;
  const key = url || normalizeKey([item && item.kind, item && item.publisher, item && item.handle, title, textExcerpt]);
  if (!key) return;
  const existing = target.find((row) => row._key === key);
  const row = {
    _key: key,
    _priority: amount(item && item.priority) || 0,
    kind: clean(item && item.kind || "", 40),
    publisher: clean(item && item.publisher || item && item.source_name || "", 80),
    handle: clean(item && item.handle || item && item.username || item && item.author_handle || "", 80),
    title,
    url,
    published_at: item && item.published_at || item && item.publishedAt || "",
    source_role: clean(item && item.source_role || item && item.sourceRole || "", 60),
    official_source: boolValue(item && (item.official_source || item.officialSource || item.official || item.is_official)),
    supports_event: item && item.supports_event === false ? false : true,
    credibility: clean(item && item.credibility || "", 40),
    engagement_score: amount(item && item.engagement_score || item && item.engagementScore) || 0,
    evidence_summary: evidenceSummary,
    text_excerpt: textExcerpt,
  };
  if (existing) {
    Object.keys(row).forEach((field) => {
      if (field === "_key") return;
      if (field === "_priority") existing[field] = Math.max(existing[field] || 0, row[field] || 0);
      else if (field === "official_source") existing[field] = !!(existing[field] || row[field]);
      else if (field === "supports_event") existing[field] = existing[field] !== false && row[field] !== false;
      else if (!existing[field] && row[field]) existing[field] = row[field];
    });
    return;
  }
  target.push(row);
}

function compactExternalEvidenceSource(row) {
  return {
    kind: row.kind || "",
    publisher: row.publisher || "",
    handle: row.handle || "",
    title: row.title || "",
    url: row.url || "",
    published_at: row.published_at || "",
    source_role: row.source_role || "",
    official_source: !!row.official_source,
    supports_event: row.supports_event !== false,
    credibility: row.credibility || "",
    engagement_score: row.engagement_score || 0,
    evidence_summary: row.evidence_summary || "",
    text_excerpt: row.text_excerpt || "",
  };
}

function externalEvidenceSourcesFromEvent(event) {
  const rows = [];
  if (event && event.primarySourceUrl) {
    pushExternalEvidenceSource(rows, {
      kind: "primary_source",
      publisher: event.primarySourceName || "",
      title: event.title || "",
      url: event.primarySourceUrl,
      source_role: "primary",
      supports_event: true,
      priority: 120,
    });
  }
  (event && event.sources || []).forEach((source) => {
    const official = boolValue(source && (source.official_source || source.officialSource || source.official));
    const role = clean(source && (source.source_role || source.sourceRole) || "", 60);
    const supportsEvent = !(source && source.supports_event === false);
    pushExternalEvidenceSource(rows, {
      kind: "feed_source",
      publisher: source && source.publisher || "",
      title: source && source.title || "",
      url: source && source.url || "",
      source_role: role,
      official_source: official,
      supports_event: supportsEvent,
      credibility: source && source.credibility || "",
      evidence_summary: source && (source.evidence_summary || source.evidenceSummary) || "",
      published_at: source && (source.published_at || source.publishedAt) || "",
      priority: (official ? 115 : 0) + (role === "primary" ? 20 : 0) + (supportsEvent ? 60 : 20),
    });
  });
  (event && event.xCandidates || []).forEach((candidate) => {
    const official = boolValue(candidate && (candidate.official_source || candidate.officialSource || candidate.official || candidate.is_official));
    const engagement = amount(candidate && (candidate.engagement_score || candidate.engagementScore)) || 0;
    pushExternalEvidenceSource(rows, {
      kind: "x_candidate",
      handle: candidate && (candidate.handle || candidate.username || candidate.author_handle) || "",
      title: candidate && (candidate.title || candidate.headline) || "",
      url: candidate && candidate.url || "",
      published_at: candidate && (candidate.published_at || candidate.publishedAt) || "",
      official_source: official,
      supports_event: candidate && candidate.supports_event === false ? false : true,
      engagement_score: engagement,
      text_excerpt: candidate && (candidate.text_excerpt || candidate.textExcerpt || candidate.text || candidate.summary) || "",
      priority: (official ? 110 : 70) + Math.min(30, Math.log10(Math.max(1, engagement)) * 10),
    });
  });
  return rows
    .sort((a, b) => (b._priority || 0) - (a._priority || 0))
    .slice(0, 12)
    .map(compactExternalEvidenceSource);
}

function sourceLinksFromExternalEvent(event) {
  return uniqueCompactStrings(externalEvidenceSourcesFromEvent(event).map((source) => source && source.url), 500).slice(0, 10);
}

function normalizeExternalBreakingEvent(row, idx, runAtMs) {
  const sources = parseJsonArrayField(row && row.sourcesJson);
  const xCandidates = parseJsonArrayField(row && row.xCandidatesJson);
  const marketTags = normalizeExternalList(row && (row.marketTagsJson || row.marketTags));
  const assetClasses = normalizeExternalList(row && (row.assetClassesJson || row.assetClasses));
  const tickersMentioned = normalizeTickerRows(parseJsonArrayField(row && (row.tickersMentionedJson || row.tickersMentioned)));
  const eventType = normalizeThemeName(row && row.eventType);
  const reportedAtMs = externalBreakingEventTimeMs(row) || runAtMs;
  const sourceEvidence = externalEvidenceSourcesFromEvent({
    title: row && row.canonicalHeadline || "",
    primarySourceName: row && row.primarySourceName || "",
	    primarySourceUrl: row && row.primarySourceUrl || "",
	    sources,
	    xCandidates,
	  });
  const sourceLinks = uniqueCompactStrings(sourceEvidence.map((source) => source && source.url), 500).slice(0, 10);
  const sourceText = clean(
    [
      row && row.canonicalHeadline,
      row && row.eventSummary,
      row && row.whyMarketCares,
      sources.map((source) => source && (source.evidence_summary || source.title || source.publisher || "")).join(" "),
      xCandidates.map((candidate) => candidate && (candidate.text_excerpt || "")).join(" "),
    ].filter(Boolean).join(" "),
    2400
  );
  return {
    externalEventId: clean(row && row.eventId || ("external-breaking-" + idx), 160),
    externalEventKey: clean(row && row.eventKey || row && row.eventId || ("external-breaking-" + idx), 180),
    title: clean(row && row.canonicalHeadline || "", 240),
    summary: clean(row && row.eventSummary || row && row.whyMarketCares || "", 700),
    whyMarketCares: clean(row && row.whyMarketCares || "", 700),
    eventType,
    sourceConfidence: clean(row && row.sourceConfidence || "", 40),
    breakingScore: amount(row && row.breakingScore) || 0,
    attentionScore: amount(row && row.attentionScore) || 0,
    noveltyScore: amount(row && row.noveltyScore) || 0,
    sourceCount: amount(row && row.sourceCount) || sources.length,
    xCandidateCount: amount(row && row.xCandidateCount) || xCandidates.length,
    updateCount: amount(row && row.updateCount) || 0,
    reportedAt: row && row.reportedAt || "",
    observedAt: row && row.observedAt || "",
    updatedAt: row && row.updatedAt || "",
    reportedAtMs,
    primarySourceName: clean(row && row.primarySourceName || "", 120),
    primarySourceUrl: row && row.primarySourceUrl || "",
    hidden: boolValue(row && row.hidden),
    hiddenReason: clean(row && row.hiddenReason || "", 240),
    marketTags,
    assetClasses,
    tickersMentioned,
	    sources,
	    xCandidates,
	    sourceEvidence,
	    sourceLinks,
	    sourceText,
	    raw: row || {},
	  };
}

function externalMacroRiskFactors(event) {
  const raw = uniqueCompactStrings(
    []
      .concat(event.marketTags || [])
      .concat(event.assetClasses || [])
      .concat(event.eventType ? [event.eventType] : []),
    80
  ).map(normalizeThemeName).filter(Boolean);
  const macro = {
    macro: true,
    policy: true,
    rates: true,
    rate: true,
    inflation: true,
    cpi: true,
    ppi: true,
    jobs: true,
    fomc: true,
    fed: true,
    treasury: true,
    yields: true,
    liquidity: true,
    credit: true,
    dollar: true,
    fx: true,
    oil: true,
    crude: true,
    brent: true,
    commodities: true,
    geopolitical: true,
    "geopolitical-risk": true,
    "middle-east": true,
    iran: true,
    israel: true,
    sanctions: true,
    "market-structure": true,
    crypto: true,
    "risk-appetite": true,
    "risk-sentiment": true,
  };
  return raw.filter((tag) => macro[tag]);
}

function externalThemeMatches(event, currentThemes) {
  const current = {};
  (currentThemes || []).forEach((row) => {
    const key = normalizeThemeName(row && row.theme);
    if (key) current[key] = true;
  });
  return uniqueCompactStrings((event.marketTags || []).filter((tag) => current[normalizeThemeName(tag)]), 80)
    .map(normalizeThemeName)
    .filter(Boolean);
}

function addMappedHolding(target, symbol, relation, confidence, rationale, source) {
  const key = String(symbol || "").toUpperCase();
  if (!key) return;
  const normalizedRelation = normalizeRelation(relation);
  const normalizedConfidence = normalizeConfidence(confidence) || "medium";
  target[key] = {
    symbol: key,
    relation: normalizedRelation,
    confidence: normalizedConfidence,
    rationale: clean(rationale || "", 320),
    mappingStrength: strongHoldingRelation(normalizedRelation, normalizedConfidence) ? "holding_level" : "context_only",
    mappingSource: source || "code_external_breaking_mapping",
  };
}

function deterministicExternalBreakingMapping(event, snapshot, currentThemes) {
  const holdingBy = bySymbol(snapshot);
  const byHolding = {};
  (event.tickersMentioned || []).forEach((ticker) => {
    const symbol = String(ticker || "").toUpperCase();
    if (!symbol) return;
    if (holdingBy[symbol]) {
      addMappedHolding(
        byHolding,
        symbol,
        "direct",
        "high",
        "External Breaking News feed tickersMentioned includes " + symbol + ", matching a current holding.",
        "code_direct_ticker_match"
      );
    }
    (snapshot.holdings || []).forEach((holding) => {
      if (!holding || holding.symbol === symbol) return;
      if (marketDataSymbolForHolding(holding) === symbol) {
        addMappedHolding(
          byHolding,
          holding.symbol,
          "option_underlying",
          "high",
          "External Breaking News feed tickersMentioned includes underlying " + symbol + " for current option holding " + holding.symbol + ".",
          "code_option_underlying_match"
        );
      }
    });
  });
  const relatedHoldings = Object.keys(byHolding)
    .sort((a, b) => ((holdingBy[b] && holdingBy[b].allocation) || 0) - ((holdingBy[a] && holdingBy[a].allocation) || 0))
    .map((symbol) => byHolding[symbol]);
  const holdingLevel = holdingLevelRelatedHoldings(relatedHoldings);
  const matchedThemes = externalThemeMatches(event, currentThemes);
  const riskFactors = externalMacroRiskFactors(event);
  const affectedThemes = uniqueCompactStrings(
    []
      .concat(event.marketTags || [])
      .concat(matchedThemes)
      .concat(riskFactors)
      .concat(holdingLevel.reduce((acc, row) => acc.concat(themesForSymbol(snapshot, row.symbol)), [])),
    80
  ).map(normalizeThemeName).filter(Boolean);
  const portfolioLevel = !holdingLevel.length && (riskFactors.length || matchedThemes.length);
  const mappingStatus = holdingLevel.length ? "holding_level" : (portfolioLevel ? "portfolio_level" : "not_relevant");
  return {
    mappingStatus,
    affectedSymbols: holdingLevel.map((row) => row.symbol),
    affectedThemes,
    riskFactors,
    relatedHoldings,
    portfolioRelevanceBasis: portfolioLevel
      ? clean("Portfolio-level " + (riskFactors.length ? riskFactors.join(", ") : "theme") + " event from the external Breaking News feed.", 500)
      : "",
    mappingReason: holdingLevel.length
      ? relatedHoldings.map((row) => row.symbol + ": " + row.rationale).join("; ")
      : (portfolioLevel ? "Code mapped this as portfolio-level risk/theme context using marketTags/eventType/assetClasses." : "No deterministic current-holding or portfolio-risk match."),
  };
}

function externalBreakingReviewPriority(event) {
  const mapping = event.deterministicMapping || {};
  const base = mapping.mappingStatus === "holding_level" ? 10000 : (mapping.mappingStatus === "portfolio_level" ? 5000 : 0);
  const confidenceBoost = event.sourceConfidence === "high" ? 200 : (event.sourceConfidence === "medium" ? 80 : 0);
  return base + confidenceBoost + (event.breakingScore || 0) * 10 + (event.attentionScore || 0) * 3 + (event.noveltyScore || 0) * 3;
}

function compactExternalEventForMappingAgent(event) {
  const mapping = event.deterministicMapping || {};
  return {
    external_event_id: event.externalEventId,
    external_event_key: event.externalEventKey,
    headline: event.title,
    summary: event.summary,
    why_market_cares: event.whyMarketCares,
    event_type: event.eventType,
    market_tags: event.marketTags,
    asset_classes: event.assetClasses,
    tickers_mentioned: event.tickersMentioned,
    source_confidence: event.sourceConfidence,
    breaking_score: event.breakingScore,
    attention_score: event.attentionScore,
    novelty_score: event.noveltyScore,
	    reported_at: event.reportedAt,
	    updated_at: event.updatedAt,
	    primary_source_name: event.primarySourceName,
	    primary_source_url: event.primarySourceUrl,
	    source_evidence: compactSourceEvidenceRows(event.sourceEvidence, 8),
	    sources: (event.sources || []).slice(0, 5).map((source) => ({
      publisher: clean(source && source.publisher || "", 80),
      title: clean(source && source.title || "", 180),
      url: source && source.url || "",
      source_role: source && source.source_role || "",
      official_source: !!(source && source.official_source),
      supports_event: source && source.supports_event !== false,
      credibility: source && source.credibility || "",
      evidence_summary: clean(source && source.evidence_summary || "", 280),
    })),
	    x_candidates: (event.xCandidates || []).slice(0, 6).map((candidate) => ({
	      handle: clean(candidate && candidate.handle || "", 80),
      url: candidate && candidate.url || "",
      published_at: candidate && candidate.published_at || "",
      engagement_score: amount(candidate && candidate.engagement_score) || 0,
      text_excerpt: clean(candidate && candidate.text_excerpt || "", 260),
    })),
    deterministic_mapping: {
      mapping_status: mapping.mappingStatus || "not_relevant",
      affected_symbols: mapping.affectedSymbols || [],
      affected_themes: mapping.affectedThemes || [],
      risk_factors: mapping.riskFactors || [],
      portfolio_relevance_basis: mapping.portfolioRelevanceBasis || "",
      mapping_reason: mapping.mappingReason || "",
      related_holdings: (mapping.relatedHoldings || []).map((row) => ({
        holding_symbol: row.symbol,
        relation: row.relation,
        confidence: row.confidence,
        rationale: row.rationale,
      })),
    },
  };
}

function buildExternalBreakingMappingPrompt(input) {
  return [
    "You are the Portfolio Relevance Mapping Agent inside Portfolio Watch.",
    "External Breaking News feed has already discovered, source-expanded, clustered, and scored the market-wide events. Do not search, do not invent sources, and do not decide push/no_push.",
    "Your job is only portfolio-specific mapping: review code's deterministic direct/ticker/macro pre-map, correct mistakes, and find any source-grounded related holdings that code missed.",
    "",
    "Rules:",
    "- First review deterministic_mapping for every event. Keep it only if the event text/source trail supports it.",
    "- For events without deterministic holding-level mapping, cross-check current_portfolio_holdings for direct mention, option-underlying, peer/competitor, supplier/customer, customer/supplier, or high-confidence second-order/value-chain relations.",
    "- A second-order/value-chain relation must name the intermediate customer/supplier/product market and a concrete demand, supply, cost, pricing, capacity, or regulatory transmission from the event to the holding.",
    "- Shared broad theme alone is not a holding-level relation. Use portfolio_level when the event matters through macro/rates/oil/geopolitics/crypto/risk appetite or a portfolio theme bucket but no holding-level chain is source-grounded.",
    "- Use exact holding_symbol values from current_portfolio_holdings. Do not map to tickers the user does not hold.",
    "- If an event has no meaningful portfolio read-through, set mapping_status to not_relevant.",
    "- Return JSON only.",
    "",
    "Schema:",
    "{",
    '  "event_mappings": [',
    '    {"external_event_id":"", "external_event_key":"", "mapping_status":"holding_level|portfolio_level|not_relevant", "affected_symbols":["TICKER"], "affected_themes":["theme"], "risk_factors":["rates"], "portfolio_relevance_basis":"", "mapping_reason":"", "reviewed_deterministic_mappings":[{"holding_symbol":"","verdict":"keep|remove|uncertain","reason":""}], "related_holdings":[{"holding_symbol":"TICKER","relation":"direct|peer_competitor|supplier_customer|customer_supplier|option_underlying|second_order|second_order_demand|second_order_supply|value_chain|downstream_demand|upstream_supply|other","confidence":"low|medium|high","rationale":"source-grounded transmission"}]}',
    "  ]",
    "}",
    "",
    "Input JSON:",
    compactJson(input, CONFIG.maxPiPromptContextChars),
  ].join("\n");
}

function normalizeExternalMappingRows(parsed, events, snapshot) {
  const eventById = {};
  (events || []).forEach((event) => {
    eventById[event.externalEventId] = event;
    eventById[event.externalEventKey] = event;
  });
  const rows = Array.isArray(parsed && parsed.event_mappings) ? parsed.event_mappings : (Array.isArray(parsed && parsed.eventMappings) ? parsed.eventMappings : []);
  const byId = {};
  rows.forEach((row) => {
    const eventId = String(row.external_event_id || row.externalEventId || "").trim();
    const eventKey = String(row.external_event_key || row.externalEventKey || "").trim();
    const event = eventById[eventId] || eventById[eventKey];
    if (!event) return;
    const statusText = String(row.mapping_status || row.mappingStatus || "").toLowerCase();
    const relatedHoldings = relatedHoldingsFromPiItem(row, snapshot).map((holding) => ({
      ...holding,
      mappingSource: "pi_external_breaking_mapping_review",
    }));
    const holdingLevel = holdingLevelRelatedHoldings(relatedHoldings);
    const status = statusText === "holding_level" || statusText === "portfolio_level" || statusText === "not_relevant"
      ? statusText
      : (holdingLevel.length ? "holding_level" : ((row.portfolio_relevance_basis || row.portfolioRelevanceBasis) ? "portfolio_level" : "not_relevant"));
    byId[event.externalEventId] = {
      mappingStatus: status,
      affectedSymbols: uniqueSymbols(
        []
          .concat(row.affected_symbols || row.affectedSymbols || [])
          .concat(holdingLevel.map((holding) => holding.symbol))
      ),
      affectedThemes: uniqueCompactStrings(row.affected_themes || row.affectedThemes || [], 80).map(normalizeThemeName).filter(Boolean),
      riskFactors: uniqueCompactStrings(row.risk_factors || row.riskFactors || [], 80).map(normalizeThemeName).filter(Boolean),
      portfolioRelevanceBasis: clean(row.portfolio_relevance_basis || row.portfolioRelevanceBasis || "", 700),
      mappingReason: clean(row.mapping_reason || row.mappingReason || "", 700),
      relatedHoldings,
      reviewedDeterministicMappings: row.reviewed_deterministic_mappings || row.reviewedDeterministicMappings || [],
      reviewedByPi: true,
    };
  });
  return byId;
}

async function reviewExternalBreakingMappings(events, snapshot, currentThemes, runAtMs, summary, warnings) {
  if (!CONFIG.externalBreakingNewsPiReviewEnabled || !events.length) return {};
  try {
    const { Agent, getModel } = require("@alva/pi");
    summary.agentCalled = true;
    summary.mappingAgentCalled = true;
    const chunks = chunkArray(events, CONFIG.externalBreakingNewsPiChunkSize);
    const merged = {};
    const chunkErrors = [];
    const retryCount = Math.max(0, Math.floor(CONFIG.externalBreakingNewsPiRetryCount));
    const perAttemptTimeoutMs = Math.max(120000, Math.floor(CONFIG.timeouts.externalBreakingMappingMs / Math.max(1, chunks.length * (retryCount + 1))));
    summary.piReviewChunkCount = chunks.length;
    summary.piReviewChunkSize = CONFIG.externalBreakingNewsPiChunkSize;
    summary.piReviewRetryCount = retryCount;
    summary.piReviewPerAttemptTimeoutMs = perAttemptTimeoutMs;
    summary.piReviewStopReasons = [];
    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx += 1) {
      const chunk = chunks[chunkIdx];
      let chunkDone = false;
      let lastError = "";
      for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
          const agent = new Agent({
            initialState: {
              systemPrompt: "You map already sourced market events to a current portfolio. Return JSON only.",
              model: getModel("openai", "gpt-5.5"),
              tools: [],
              thinkingLevel: "off",
            },
          });
          const promptInput = {
            run_at_hkt: hkt(runAtMs),
            review_chunk: { index: chunkIdx + 1, count: chunks.length, attempt: attempt + 1 },
            source_contract: {
              external_feed: resolveAlfsPath(CONFIG.externalBreakingNewsFeedPath),
              event_fact_layer: "Standalone Breaking News feed already handled discovery, source expansion, event clustering, and source confidence.",
              portfolio_mapping_layer: "This agent only reviews deterministic portfolio mappings and finds source-grounded related holdings.",
            },
            current_portfolio_holdings: buildPiHoldingContexts(snapshot),
            current_portfolio_theme_context: buildPiThemeContexts(snapshot, currentThemes),
            portfolio_capabilities: snapshot.portfolioCapabilities || {},
            external_breaking_events: chunk.map(compactExternalEventForMappingAgent),
          };
          const { message } = await agent.ask(buildExternalBreakingMappingPrompt(promptInput), { timeoutMs: perAttemptTimeoutMs });
          const stopReason = message && message.stopReason ? String(message.stopReason) : "";
          if (stopReason) summary.piReviewStopReasons.push({ chunk: chunkIdx + 1, attempt: attempt + 1, stopReason });
          summary.stopReason = stopReason || summary.stopReason || "";
          if (message && message.model) summary.model = message.model;
          if (message && message.errorMessage) throw new Error("External breaking mapping agent error: " + message.errorMessage);
          const text = piMessageText(message);
          summary.rawTextPreview = clean(text, 900);
          const parsed = parseJsonLenient(text);
          if (!parsed) throw new Error("External breaking mapping agent did not return parseable JSON");
          const normalized = normalizeExternalMappingRows(parsed, chunk, snapshot);
          Object.keys(normalized).forEach((key) => { merged[key] = normalized[key]; });
          chunkDone = true;
          break;
        } catch (err) {
          lastError = String(err && err.message ? err.message : err).slice(0, 260);
        }
      }
      if (!chunkDone) chunkErrors.push("chunk " + (chunkIdx + 1) + "/" + chunks.length + ": " + lastError);
    }
    summary.piReviewedEventCount = Object.keys(merged).length;
    if (chunkErrors.length) {
      summary.error = chunkErrors.join(" | ").slice(0, 900);
      warnings.push({ source: "external-breaking-mapping-agent", error: summary.error });
    }
    return merged;
  } catch (err) {
    summary.error = String(err && err.message ? err.message : err).slice(0, 260);
    warnings.push({ source: "external-breaking-mapping-agent", error: summary.error });
    return {};
  }
}

function mergeExternalMapping(event, piMapping) {
  const deterministic = event.deterministicMapping || {};
  if (!piMapping || !piMapping.reviewedByPi) return deterministic;
  if (piMapping.mappingStatus === "not_relevant") return piMapping;
  const piHoldingLevel = holdingLevelRelatedHoldings(piMapping.relatedHoldings || []);
  const deterministicHoldingLevel = holdingLevelRelatedHoldings(deterministic.relatedHoldings || []);
  const relatedHoldings = piMapping.relatedHoldings && piMapping.relatedHoldings.length
    ? piMapping.relatedHoldings
    : deterministic.relatedHoldings || [];
  return {
    ...deterministic,
    ...piMapping,
    mappingStatus: piMapping.mappingStatus || deterministic.mappingStatus || (piHoldingLevel.length || deterministicHoldingLevel.length ? "holding_level" : "portfolio_level"),
    relatedHoldings,
    affectedSymbols: uniqueSymbols(
      []
        .concat(piMapping.affectedSymbols || [])
        .concat(holdingLevelRelatedHoldings(relatedHoldings).map((row) => row.symbol))
    ),
    affectedThemes: uniqueCompactStrings(
      []
        .concat(deterministic.affectedThemes || [])
        .concat(piMapping.affectedThemes || []),
      80
    ).map(normalizeThemeName).filter(Boolean),
    riskFactors: uniqueCompactStrings(
      []
        .concat(deterministic.riskFactors || [])
        .concat(piMapping.riskFactors || []),
      80
    ).map(normalizeThemeName).filter(Boolean),
    portfolioRelevanceBasis: piMapping.portfolioRelevanceBasis || deterministic.portfolioRelevanceBasis || "",
    mappingReason: piMapping.mappingReason || deterministic.mappingReason || "",
  };
}

function externalMappingToRawEvent(event, mapping, snapshot) {
  const holdingLevel = holdingLevelRelatedHoldings(mapping.relatedHoldings || []);
  const contextual = contextOnlyRelatedHoldings(mapping.relatedHoldings || []);
  const sourceEvidence = event.sourceEvidence || externalEvidenceSourcesFromEvent(event);
  const sourceLinks = uniqueCompactStrings(sourceEvidence.map((source) => source && source.url), 500).slice(0, 10);
  const affectedSymbols = uniqueSymbols(
    []
      .concat(mapping.affectedSymbols || [])
      .concat(holdingLevel.map((row) => row.symbol))
  );
  const affectedThemes = uniqueCompactStrings(
    []
      .concat(event.marketTags || [])
      .concat(mapping.affectedThemes || [])
      .concat(mapping.riskFactors || [])
      .concat(affectedSymbols.reduce((acc, symbol) => acc.concat(themesForSymbol(snapshot, symbol)), [])),
    80
  ).map(normalizeThemeName).filter(Boolean);
  if (mapping.mappingStatus === "not_relevant") return null;
  if (!affectedSymbols.length && !affectedThemes.length && !(mapping.portfolioRelevanceBasis || mapping.riskFactors || []).length) return null;
  const sourceTweet = (event.xCandidates || [])[0] || {};
  return {
    sourceType: "external_breaking_news",
    symbol: affectedSymbols.length ? (affectedSymbols.length > 1 ? "PORTFOLIO" : affectedSymbols[0]) : "PORTFOLIO",
    affectedSymbols,
    affectedThemes,
    sourceRecordId: event.externalEventKey || event.externalEventId,
	    title: event.title,
	    summary: event.summary,
	    source: "External Breaking News feed: " + (event.primarySourceName || "breaking-news"),
	    url: event.primarySourceUrl || sourceLinks[0] || "",
	    publishedAtMs: event.reportedAtMs,
	    mappingReason: mapping.mappingReason || mapping.portfolioRelevanceBasis || event.whyMarketCares || "",
	    sourceLinks,
    metadata: {
      sourceOrigin: "external_breaking_news_feed",
      sourceLane: "external_breaking_news",
      sourceSearchMode: "alfs_events_current_range",
      externalFeedPath: resolveAlfsPath(CONFIG.externalBreakingNewsFeedPath),
      externalEventId: event.externalEventId,
      externalEventKey: event.externalEventKey,
      externalReportedAt: event.reportedAt,
      externalObservedAt: event.observedAt,
      externalUpdatedAt: event.updatedAt,
      whyMarketCares: event.whyMarketCares,
      eventType: event.eventType,
      sourceConfidence: event.sourceConfidence,
      breakingScore: event.breakingScore,
      attentionScore: event.attentionScore,
      noveltyScore: event.noveltyScore,
      sourceCount: event.sourceCount,
      xCandidateCount: event.xCandidateCount,
      updateCount: event.updateCount,
      themes: event.marketTags,
      riskFactors: mapping.riskFactors || externalMacroRiskFactors(event),
      portfolioRelevanceBasis: mapping.portfolioRelevanceBasis || event.whyMarketCares || "",
      affectedThemes,
      affectedSymbols,
      relatedHoldings: holdingLevel,
      contextualRelatedHoldings: contextual,
      allRelatedHoldings: mapping.relatedHoldings || [],
      sourceRelatedTickers: event.tickersMentioned,
      tickers: event.tickersMentioned,
	      sourceText: event.sourceText,
	      sources: event.sources,
	      xCandidates: event.xCandidates,
	      sourceEvidence,
	      evidenceSources: sourceEvidence,
	      sourceLinks,
      sourceTweetId: sourceTweet.platform_id || sourceTweet.candidate_id || "",
      sourceTweetUrl: sourceTweet.url || "",
      sourceTweetRank: null,
      sourceTweetEngagementScore: amount(sourceTweet.engagement_score) || null,
      sourceTimeLabel: event.reportedAt || "",
      sourceEventTime: event.reportedAt || "",
      sourceEventAtMs: event.reportedAtMs || null,
      sourceEventHkt: Number.isFinite(event.reportedAtMs) ? hkt(event.reportedAtMs) : "",
      portfolioLevelEvent: !affectedSymbols.length,
      holdingMappingPolicy: affectedSymbols.length ? "external_feed_pi_reviewed_holding_level_related_holdings_only" : "external_feed_portfolio_level",
      mappingReviewedByPi: !!mapping.reviewedByPi,
      reviewedDeterministicMappings: mapping.reviewedDeterministicMappings || [],
    },
  };
}

async function readExternalBreakingRows(runAtMs, summary, warnings) {
  const basePath = resolveAlfsPath(CONFIG.externalBreakingNewsFeedPath);
  const startMs = runAtMs - CONFIG.externalBreakingNewsLookbackMinutes * 60 * 1000;
  const endMs = runAtMs + 60 * 1000;
  const rangePath = basePath + "/@range/" + Math.floor(startMs) + ".." + Math.ceil(endMs);
  try {
    const payload = parseAlfsJson(await alfs.readFile(rangePath));
    const rows = externalBreakingRowsFromPayload(payload);
    summary.feedReadPath = rangePath;
    summary.feedReadMode = "range_ms";
    summary.feedRowsRead = rows.length;
    return rows;
  } catch (err) {
    const error = String(err && err.message ? err.message : err).slice(0, 220);
    warnings.push({ source: "external-breaking-feed-range", error });
    const fallbackPath = basePath + "/@last/" + CONFIG.externalBreakingNewsMaxRows;
    const payload = parseAlfsJson(await alfs.readFile(fallbackPath));
    const rows = externalBreakingRowsFromPayload(payload).filter((row) => {
      const ms = externalBreakingEventTimeMs(row);
      return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
    });
    summary.feedReadPath = fallbackPath;
    summary.feedReadMode = "last_filter_after_range_error";
    summary.feedRangeError = error;
    summary.feedRowsRead = rows.length;
    return rows;
  }
}

async function fetchExternalBreakingNews(snapshot, currentThemes, fetchStartMs, runAtMs, warnings) {
  const summary = {
    enabled: CONFIG.breakingNewsEnabled,
    sourceMode: "external_feed",
    environment: "Alva feed read + Pi portfolio mapping review",
    agentCalled: false,
    mappingAgentCalled: false,
    model: "gpt-5.5",
    tools: ["alfs.readFile(events/current range)", "Pi portfolio relevance mapping agent"],
    queries: [],
    queryPlanning: "external_breaking_news_feed_range_then_portfolio_mapping",
    holdingContextCount: 0,
    themeContextCount: 0,
    toolCalls: [],
    parsedEventCount: 0,
    rawEventRecords: 0,
    externalRowsRead: 0,
    normalizedExternalEventCount: 0,
    deterministicMappedEventCount: 0,
    piReviewedEventCount: 0,
    stopReason: "",
    rawTextPreview: "",
    error: "",
    themeNewsSummary: {
      enabled: false,
      environment: "external_breaking_news_feed",
      agentCalled: false,
      tools: [],
      queries: [],
      parsedEventCount: 0,
      rawEventRecords: 0,
      error: "",
    },
  };
  if (!CONFIG.breakingNewsEnabled) return { records: [], summary };
  summary.holdingContextCount = (snapshot.holdings || []).length;
  summary.themeContextCount = (currentThemes || []).length;
  try {
    const rows = await readExternalBreakingRows(runAtMs, summary, warnings);
    summary.externalRowsRead = rows.length;
    summary.queries = summary.feedReadPath ? [summary.feedReadPath] : [];
    summary.toolCalls.push({
      tool: "alfs.readFile",
      purpose: "external_breaking_news_feed",
      query: summary.feedReadPath || resolveAlfsPath(CONFIG.externalBreakingNewsFeedPath),
      resultCount: rows.length,
      lookbackMinutes: CONFIG.externalBreakingNewsLookbackMinutes,
    });
    const events = rows
      .map((row, idx) => normalizeExternalBreakingEvent(row, idx, runAtMs))
      .filter((event) => event && event.title && (!event.hidden || CONFIG.externalBreakingNewsIncludeHidden))
      .slice(0, CONFIG.externalBreakingNewsMaxRows)
      .map((event) => ({
        ...event,
        deterministicMapping: deterministicExternalBreakingMapping(event, snapshot, currentThemes),
      }));
    summary.normalizedExternalEventCount = events.length;
    summary.deterministicMappedEventCount = events.filter((event) => event.deterministicMapping && event.deterministicMapping.mappingStatus !== "not_relevant").length;
    const reviewEvents = events
      .slice()
      .sort((a, b) => externalBreakingReviewPriority(b) - externalBreakingReviewPriority(a))
      .slice(0, CONFIG.externalBreakingNewsPiMaxEvents);
    const piMappings = await reviewExternalBreakingMappings(reviewEvents, snapshot, currentThemes, runAtMs, summary, warnings);
    const records = events
      .map((event) => externalMappingToRawEvent(event, mergeExternalMapping(event, piMappings[event.externalEventId]), snapshot))
      .filter(Boolean)
      .sort((a, b) => (b.publishedAtMs || 0) - (a.publishedAtMs || 0))
      .slice(0, CONFIG.externalBreakingNewsMaxMappedEvents);
    summary.parsedEventCount = events.length;
    summary.rawEventRecords = records.length;
    summary.searchAudit = [{
      query: summary.feedReadPath || resolveAlfsPath(CONFIG.externalBreakingNewsFeedPath),
      lane: "external_breaking_news",
      tools_used: ["alfs.readFile", "Pi portfolio mapping review"],
      candidate_count: events.length,
      result_assessment: records.length ? "mapped_to_portfolio_context" : "no_portfolio_relevant_events",
    }];
    return { records, summary };
  } catch (err) {
    summary.error = String(err && err.message ? err.message : err).slice(0, 260);
    summary.themeNewsSummary.error = summary.error;
    warnings.push({ source: "external-breaking-news-feed", error: summary.error });
    return { records: [], summary };
  }
}

async function fetchInternalBreakingNews(snapshot, currentThemes, fetchStartMs, runAtMs, warnings) {
  const summary = {
    enabled: CONFIG.breakingNewsEnabled,
    environment: "Pi Agent",
    agentCalled: false,
    model: "gpt-5.5",
		  tools: ["searchArraysIndexedX(code)", "searchBrave", "searchArraysMarketNewsTopic"],
	    queries: [],
	    indexedXDiscovery: null,
    themeQueries: [],
    themeTopicMappings: [],
    topicNewsCalls: [],
    topicNewsRecords: 0,
	  queryPlanning: "pi_agent_objective_centric",
	  holdingContextCount: 0,
	  themeContextCount: 0,
    toolCalls: [],
    parsedEventCount: 0,
    rawEventRecords: 0,
    themeNewsSummary: {
      enabled: true,
	    environment: "Pi Agent",
	    agentCalled: false,
	    tools: ["themeTopicMappings", "searchArraysMarketNewsTopic", "searchBrave"],
      queries: [],
      themeTopicMappings: [],
      topicNewsCalls: [],
      topicNewsRecords: 0,
	      queryPlanning: "pi_agent_objective_centric",
	      holdingContextCount: 0,
	      themeContextCount: 0,
      toolCalls: [],
      parsedEventCount: 0,
      rawEventRecords: 0,
      error: "",
    },
    stopReason: "",
    rawTextPreview: "",
    error: "",
  };
  if (!CONFIG.breakingNewsEnabled) return { records: [], summary };
	  const themeContexts = buildPiThemeContexts(snapshot, currentThemes);
	  const holdingContexts = buildPiHoldingContexts(snapshot);
	  summary.holdingContextCount = holdingContexts.length;
	  summary.themeContextCount = themeContexts.length;
	  summary.themeNewsSummary.holdingContextCount = holdingContexts.length;
	  summary.themeNewsSummary.themeContextCount = themeContexts.length;

	  try {
	    const { Agent, Type, getModel } = require("@alva/pi");
	    const { searchBrave } = require("@arrays/data/search/search-brave:v1.0.0");
	    const indexedXDiscovery = await fetchIndexedXTopTweets(fetchStartMs, runAtMs, warnings);
	    summary.indexedXDiscovery = {
	      source: indexedXDiscovery.source,
	      discovery_mode: indexedXDiscovery.discovery_mode,
	      ranking_formula: indexedXDiscovery.ranking_formula,
		      startHkt: indexedXDiscovery.startHkt,
		      endHkt: indexedXDiscovery.endHkt,
		      fetchedPages: indexedXDiscovery.fetchedPages,
		      pageLimit: CONFIG.maxIndexedXTweetsFetch,
		      maxPages: CONFIG.maxIndexedXTweetFetchPages,
		      fetchedRows: indexedXDiscovery.fetchedRows,
		      eligibleRows: indexedXDiscovery.eligibleRows,
		      keptRows: indexedXDiscovery.keptRows,
		      pages: indexedXDiscovery.pages,
		      topTweets: indexedXDiscovery.topTweets.slice(0, 10).map((tweet) => ({
	        rank: tweet.rank,
	        handle: tweet.handle,
	        content_type: tweet.content_type,
	        published_at_hkt: tweet.published_at_hkt,
	        engagement_score: tweet.metrics && tweet.metrics.engagement_score,
	        url: tweet.url,
	        text: clean(tweet.text, 220),
	      })),
	    };
		    const toolCalls = [{
			      tool: "searchArraysIndexedX",
			      purpose: "market_breaking indexed_x_top_engagement",
			      query: "/api/v1/social-feeds/x/search q omitted; code paginates and ranks by engagement",
			      resultCount: indexedXDiscovery.fetchedRows,
			      startHkt: indexedXDiscovery.startHkt,
			      endHkt: indexedXDiscovery.endHkt,
			      limit: CONFIG.maxIndexedXTweetsFetch * CONFIG.maxIndexedXTweetFetchPages,
		    }];
		    let themeBraveCallCount = 0;
		    let sourceBraveCallCount = 0;
		    let topicNewsCallCount = 0;
		    const maxThemeBraveCalls = themeContexts.length * CONFIG.maxThemeNewsSearchAttemptsPerTheme;
		    const maxSourceBraveCalls = CONFIG.maxBreakingNewsBraveCalls;
		    const maxTopicNewsCalls = CONFIG.maxTopicNewsToolCalls;
	    const tools = [
		      {
	        name: "searchArraysMarketNewsTopic",
	        description: "Fetch recent Arrays market-news rows for one supported topic after you map a supplied portfolio theme to that topic. Use the returned source_tickers only as source context; you must still decide related_holdings yourself from the current portfolio context.",
	        parameters: Type.Object({
	          topic: Type.String(),
	          theme: Type.Optional(Type.String()),
	          purpose: Type.Optional(Type.String()),
	        }),
	        execute: async (_id, { topic, theme, purpose }) => {
	          const normalizedTopic = normalizeMarketNewsTopic(topic);
	          if (!normalizedTopic) {
	            const compactInvalid = { success: false, topic, rows: [], error: "unsupported_topic" };
	            toolCalls.push({ tool: "searchArraysMarketNewsTopic", purpose: purpose || "theme_news", theme: clean(theme || "", 80), topic: clean(topic || "", 80), resultCount: 0, error: "unsupported_topic" });
	            return { content: [{ type: "text", text: compactJson(compactInvalid, 2000) }], details: compactInvalid };
	          }
	          if (topicNewsCallCount >= maxTopicNewsCalls) {
	            const compactLimit = { success: false, topic: normalizedTopic, rows: [], limitReached: true };
	            toolCalls.push({ tool: "searchArraysMarketNewsTopic", purpose: purpose || "theme_news", theme: clean(theme || "", 80), topic: normalizedTopic, resultCount: 0, limitReached: true });
	            return { content: [{ type: "text", text: compactJson(compactLimit, 2000) }], details: compactLimit };
	          }
	          topicNewsCallCount += 1;
	          const body = await optionalArrays("/api/v1/stocks/market-news", {
	            topic: normalizedTopic,
	            start_time: Math.floor(fetchStartMs / 1000),
	            end_time: Math.floor(runAtMs / 1000),
	            sort_by_type: "PUBLISHED_TIME",
	            sort_by: "DESC",
	            limit: CONFIG.maxTopicNewsRowsPerTopic,
	          }, warnings, "pi-market-news-topic:" + normalizedTopic);
	          const rows = (body.data || []).slice(0, CONFIG.maxTopicNewsRowsPerTopic).map((item) => {
	            const publishedAtMs = item.publish_time ? item.publish_time * 1000 : Date.parse(item.time_published || "") || null;
	            return {
	              id: item.id ? String(item.id) : (item.url || item.title || ""),
	              title: clean(item.title || "", 240),
	              summary: clean(item.summary || "", 700),
	              source_text: clean(item.summary || item.title || "", 1400),
	              url: item.url || "",
	              source: item.source || item.source_domain || "Arrays market-news topic",
	              published_at_iso: Number.isFinite(publishedAtMs) ? new Date(publishedAtMs).toISOString() : "",
	              published_at_hkt: Number.isFinite(publishedAtMs) ? hkt(publishedAtMs) : "",
	              source_related_tickers: normalizeTickerRows(item.tickers),
	              topics: item.topics || [],
	            };
	          });
	          const compact = {
	            success: true,
	            topic: normalizedTopic,
	            theme: theme || "",
	            start_hkt: hkt(fetchStartMs),
	            end_hkt: hkt(runAtMs),
	            rows,
	          };
	          toolCalls.push({
	            tool: "searchArraysMarketNewsTopic",
	            purpose: purpose || "theme_news",
	            theme: clean(theme || "", 80),
	            topic: normalizedTopic,
	            resultCount: rows.length,
	            startHkt: hkt(fetchStartMs),
	            endHkt: hkt(runAtMs),
	            limit: CONFIG.maxTopicNewsRowsPerTopic,
	          });
	          return { content: [{ type: "text", text: compactJson(compact, CONFIG.maxTopicNewsToolResultChars) }], details: compact };
	        },
	      },
	      {
		        name: "searchBrave",
	        description: "Search web/news results. Use purpose='theme_news' with result_filter='news' for recent theme/industry searches you plan from portfolio theme context. Use purpose='source_expansion' with result_filter='web' only after a supplied indexed-X top tweet plausibly qualifies as market-breaking, to identify its original/official or earliest credible source. source_expansion must not discover brand-new market_breaking events without an indexed-X anchor and is not restricted to the recent event window. Never use result_filter='news' for source_expansion. If results are off-objective, refine the query within budget.",
        parameters: Type.Object({
          query: Type.String(),
          result_filter: Type.Optional(Type.String()),
          purpose: Type.Optional(Type.String()),
          theme: Type.Optional(Type.String()),
        }),
        execute: async (_id, { query, result_filter, purpose, theme }) => {
          const normalizedPurpose = String(purpose || "").toLowerCase();
          const callPurpose = normalizedPurpose.indexOf("theme") >= 0 ? "theme_news" : "source_expansion";
          const limitReached = callPurpose === "theme_news"
            ? themeBraveCallCount >= maxThemeBraveCalls
            : sourceBraveCallCount >= maxSourceBraveCalls;
          if (limitReached) {
            const compactLimit = { success: false, query, rows: [], limitReached: true };
            toolCalls.push({ tool: "searchBrave", purpose: callPurpose, theme: clean(theme || "", 80), query: clean(query, 180), resultCount: 0, limitReached: true });
            return { content: [{ type: "text", text: compactJson(compactLimit, 2000) }], details: compactLimit };
          }
          if (callPurpose === "theme_news") themeBraveCallCount += 1;
          else sourceBraveCallCount += 1;
          const resultFilter = callPurpose === "source_expansion"
            ? "web"
            : (result_filter || "news");
          const braveParams = {
            query,
            result_filter: resultFilter,
            count: callPurpose === "theme_news" ? CONFIG.maxThemeNewsRowsPerQuery : 5,
          };
          if (callPurpose === "theme_news") braveParams.freshness = "pd";
          const result = await searchBrave(braveParams);
	          const rows = (((result || {}).response || {}).data || []).slice(0, callPurpose === "theme_news" ? CONFIG.maxThemeNewsRowsPerQuery : 5).map((row) => ({
	            title: clean(row.title || "", 240),
	            url: row.url || "",
	            description: clean(row.description || "", 500),
	            source_text: clean(row.description || row.title || "", 1400),
	            age: row.age || "",
            date: row.date || "",
            result_type: row.result_type || resultFilter || "",
          }));
          const compact = { success: !!(result && result.success !== false), query, rows };
          toolCalls.push({
            tool: "searchBrave",
            purpose: callPurpose,
            theme: clean(theme || "", 80),
            query: clean(query, 180),
            resultFilter,
            freshness: callPurpose === "theme_news" ? "pd" : "unrestricted",
            resultCount: rows.length,
          });
          return { content: [{ type: "text", text: compactJson(compact, 8000) }], details: compact };
        },
      },
    ];
	    const systemPrompt = [
	      "You are the Pi event-search agent inside a portfolio watch automation.",
	      "Your job is fresh event discovery only. You do not decide whether to push.",
	      "You cover two lanes: market-wide indexed-X breaking-news review, and theme/industry news discovery for supplied current portfolio themes.",
	      "For market-wide breaking-news, runtime code has already fetched recent Arrays indexed X posts and ranked them by engagement. Review only the supplied indexed_x_top_tweets; do not use portfolio holdings as discovery seeds and do not invent X results.",
		      "A supplied indexed-X tweet is only a market_breaking anchor if it is fresh, investment-related, and plausibly market-moving for macro, rates, oil, geopolitics, semiconductors, AI infrastructure, crypto, major listed assets, or broad risk appetite. If the top tweets are social, political color with no market transmission, product fluff, jokes, or generic commentary, return no market_breaking event for them.",
		      "When a supplied indexed-X tweet qualifies, proactively use searchBrave source_expansion to look for the original/official source first; if no official source is findable, use the earliest credible media/source link.",
		      "For every indexed-X market_breaking event you return, include source_tweet_id, source_tweet_url, source_tweet_rank, source_tweet_engagement_score, expanded_from_tweet_url, the best original/official or earliest credible source you found, plus source_event_time when available. Use null only after a real source-expansion attempt fails or budget is exhausted.",
		      "When using searchBrave for source_expansion, always pass purpose='source_expansion' and result_filter='web'. Do not pass result_filter='news' for source_expansion; the news vertical can miss official/source pages such as Fed statements, Reuters, CNBC, or primary-source pages.",
		      "Do not use source_expansion to discover market_breaking events that were not anchored to a supplied indexed-X tweet. Brave expansion can confirm and enrich an indexed-X candidate, not create a new market_breaking candidate.",
		      "For theme/industry news, first map every supplied current portfolio theme to supported Arrays market-news topics. Use no_supported_topic when none fit. When a topic fits, call searchArraysMarketNewsTopic to inspect actual source rows before returning any topic-derived event.",
	      "You may also build Brave news queries from supplied current portfolio theme context when useful, especially when topic mapping is too broad or needs source context.",
	      "For returned single-name or theme events, agentically map them to current holdings using current_portfolio_holdings and return related_holdings[] only when there is a holding-level relation. Use exact holding_symbol values from the supplied portfolio. Source-returned tickers are context only, not an automatic mapping.",
	      "When deciding related_holdings, use the event source text from tool rows (source_text/content/summary/description) plus source metadata. Do not map a holding from title and URL alone; if the source text is missing or too thin, use source expansion when appropriate or omit the event.",
	      "A holding-level relation requires direct mention, peer/competitor read-through, supplier/customer exposure, option-underlying exposure, or a high-confidence second-order/value-chain link grounded in the source. A second-order link must name the intermediate customer/supplier/product market and a concrete demand, supply, cost, pricing, or capacity transmission.",
	      "Shared theme/industry, broad AI-infrastructure read-through, macro/rates/oil/FX/liquidity sensitivity, crypto beta, or generic sector sympathy is context-only: put it in themes/risk_factors/portfolio_relevance_basis, not related_holdings[].",
	      "For data-center power/capex, energy-supply, or AI-infrastructure buildout events, do not map memory, semiconductor, server, or networking holdings merely because they share the AI-infrastructure theme. Map them only if the source directly mentions that holding, its product market, its customer/supplier chain, or a concrete second-order demand/supply/pricing transmission.",
	      "Do not drop a truly market-moving macro, policy, liquidity, geopolitical, rates, oil, or broad risk-appetite event only because it has no exact holding symbol. For those portfolio-level events, return related_holdings: [], symbols: [], risk_factors, and portfolio_relevance_basis. If an event has neither exact holding relevance nor a credible portfolio-level risk-factor basis, do not return it.",
	      "After each tool result, reflect on whether the query was on-objective. If results are stale, generic, or off-topic, try a sharper query within budget rather than returning bad events.",
	      "Only return events that are new enough for the supplied window and plausibly material to markets, sectors, macro, major listed assets, or the supplied theme/industry exposures.",
      "Do not invent sources, prices, portfolio positions, or conclusions. If nothing clears the bar, return an empty events array.",
      "Return JSON only.",
    ].join("\n");
    const agent = new Agent({
      initialState: {
        systemPrompt,
        model: getModel("openai", "gpt-5.5"),
        tools,
        thinkingLevel: "off",
      },
    });
    const prompt = [
      "Objective-centric market and theme discovery context:",
      compactJson({
		        run_at_hkt: hkt(runAtMs),
		        window_start_hkt: hkt(fetchStartMs),
		        market_breaking_objective: "Review the supplied recent Arrays indexed X top-engagement tweets and decide whether any one is a fresh investment-related market-breaking event. Only qualifying supplied tweets may enter Brave source expansion.",
		        indexed_x_discovery: {
		          source: indexedXDiscovery.source,
		          discovery_mode: indexedXDiscovery.discovery_mode,
		          ranking_formula: indexedXDiscovery.ranking_formula,
		          start_hkt: indexedXDiscovery.startHkt,
		          end_hkt: indexedXDiscovery.endHkt,
		          fetched_rows: indexedXDiscovery.fetchedRows,
		          eligible_rows_after_code_filters: indexedXDiscovery.eligibleRows,
		          supplied_top_tweet_count: indexedXDiscovery.keptRows,
		          indexed_x_top_tweets: indexedXDiscovery.topTweets,
		        },
		        theme_news_objective: "For each supplied current portfolio theme, map it to supported Arrays market-news topics, fetch useful topic rows with searchArraysMarketNewsTopic, and/or run a concise Brave industry/news query when it adds source context. Return events you can map to current holdings agentically, plus truly material portfolio-level risk-factor events when no exact holding symbol applies.",
		        supported_arrays_market_news_topics: SUPPORTED_MARKET_NEWS_TOPICS,
			        search_budgets: {
			          indexed_x_page_limit: CONFIG.maxIndexedXTweetsFetch,
			          indexed_x_max_pages: CONFIG.maxIndexedXTweetFetchPages,
			          indexed_x_max_rows_fetched_by_code: CONFIG.maxIndexedXTweetsFetch * CONFIG.maxIndexedXTweetFetchPages,
			          indexed_x_top_tweets_supplied_to_pi: CONFIG.maxIndexedXTweetsForPi,
		          theme_brave_calls: maxThemeBraveCalls,
	          source_expansion_brave_calls: maxSourceBraveCalls,
	          topic_news_calls: maxTopicNewsCalls,
	          topic_news_rows_per_call: CONFIG.maxTopicNewsRowsPerTopic,
	          brave_rows_per_theme_call: CONFIG.maxThemeNewsRowsPerQuery,
	        },
	        current_portfolio_holdings: holdingContexts,
	        current_portfolio_theme_context: themeContexts,
	      }, CONFIG.maxPiPromptContextChars),
	      "",
		      "Run the search loop:",
		      "1. Review indexed_x_top_tweets in rank order. Decide whether any supplied tweet is a fresh investment-related market_breaking anchor. Do not call a discovery search tool and do not invent tweets.",
		      "2. For each qualifying indexed-X anchor, use searchBrave with purpose='source_expansion' and result_filter='web' to look first for the original/official source, then the earliest credible media/source link if official is unavailable. Do not use result_filter='news' for source_expansion. This source lookup is not restricted to the recent event window; older official/primary sources are allowed.",
		      "3. If no supplied indexed-X tweet qualifies as investment-related breaking news, return no market_breaking events. Do not use Brave source_expansion to create a brand-new unanchored market_breaking event.",
		      "4. Map every supplied current portfolio theme to zero or more supported Arrays market-news topics. This mapping is required even if you also use Brave. If no topic fits, return status no_supported_topic for that theme.",
		      "5. For mapped topics that could produce useful portfolio-relevant events, call searchArraysMarketNewsTopic with the topic and theme. Inspect rows yourself and return only rows that clear event quality and holding mapping.",
		      "6. Optionally call searchBrave for theme_news discovery using purpose='theme_news', result_filter='news', and the theme name in the theme parameter. Use the supplied theme context, not prebuilt query strings.",
		      "7. Deduplicate same-event variants across indexed X, Brave, and Arrays topic rows. Do not return an event only because a tool result existed.",
		      "8. For each returned event, set event_scope to market_breaking or theme_news. For Arrays topic rows, use event_scope='theme_news' and source_kind='arrays_topic_news'. For Brave theme rows, include matched_theme and the actual search_query you used.",
			      "9. For each returned event, fill related_holdings with exact holding_symbol values from current_portfolio_holdings only when a holding-level relation exists. Include relation, confidence, and rationale grounded in the source_text/content/summary/description you saw. Source tickers may go in source_related_tickers but must not substitute for related_holdings. For portfolio-level macro/policy/risk/theme events with no exact holding-level relation, leave related_holdings empty and provide risk_factors plus portfolio_relevance_basis.",
		      "10. For each returned event, published_at_iso must be copied from the discovery/source row timestamp when available. For indexed-X market_breaking events, this must be the supplied tweet's published_at_iso; if no timestamp is available, leave it blank and include source_time_label if present.",
		      "11. For indexed-X market_breaking events, source_event_time should be the original/official source timestamp/date when found, otherwise the earliest credible non-X source time, otherwise null. It may be older than published_at_iso and must not replace the X freshness field.",
		      "12. In search_audit, include the code-provided indexed-X discovery attempt, every meaningful tool attempt, lane, theme when applicable, tools_used, candidate_count, and a short result_assessment such as useful/refined/noisy/no_event.",
		      "13. Return up to " + CONFIG.maxBreakingNewsRecords + " mapped events total across market-breaking, theme Brave, and Arrays topic-news sources.",
      "",
      "Output schema:",
      "{",
      '  "themeTopicMappings": [',
      '    {"theme":"memory", "topics":["TECHNOLOGY","MANUFACTURING"], "status":"mapped|no_supported_topic", "reason":"why these Arrays market-news topics fit this portfolio theme"}',
      "  ],",
      '  "events": [',
			      '    {"event_id":"stable short id", "event_scope":"market_breaking|theme_news", "title":"", "summary":"", "source_text_excerpt":"short excerpt from source_text/content/summary used for mapping", "published_at_iso":"", "source_time_label":"", "source_event_time":null, "source_tweet_id":"", "source_tweet_url":"", "source_tweet_rank":1, "source_tweet_engagement_score":0, "expanded_from_tweet_url":"", "source_related_tickers":["TICKER"], "themes":["theme-a"], "risk_factors":["rates","liquidity"], "portfolio_relevance_basis":"why this can matter to the current portfolio even if no exact holding-level relation applies", "matched_theme":"theme-a", "search_query":"", "source_links":["https://..."], "source_kind":"indexed_x|mixed|news|arrays_topic_news", "confidence":"low|medium|high", "why_relevant":"", "related_holdings":[{"holding_symbol":"TICKER", "relation":"direct|peer_competitor|supplier_customer|customer_supplier|second_order|second_order_demand|second_order_supply|value_chain|downstream_demand|upstream_supply|option_underlying|other", "confidence":"low|medium|high", "rationale":"source-grounded first- or second-order relation to this holding"}]}',
	      "  ],",
	      '  "search_audit": [{"query":"arrays_indexed_x_top_engagement_recent_90m", "lane":"market_breaking|theme_news", "theme":"", "tools_used":["searchArraysIndexedX(code)"], "candidate_count":0, "result_assessment":"useful|refined|noisy|no_event"}]',
      "}",
    ].join("\n");
    summary.agentCalled = true;
    summary.themeNewsSummary.agentCalled = true;
    const { message } = await agent.ask(prompt, { timeoutMs: CONFIG.timeouts.internalBreakingNewsMs });
    summary.stopReason = message && message.stopReason ? String(message.stopReason) : "";
    if (message && message.model) summary.model = message.model;
    if (message && message.errorMessage) throw new Error("Pi agent error: " + message.errorMessage);
    const text = piMessageText(message);
    summary.rawTextPreview = clean(text, 900);
	    const parsed = safeParseJson(text);
	    if (!parsed) throw new Error("Pi event-search loop did not return parseable JSON");
	    const topicMappings = normalizeThemeTopicMappings(parsed, themeContexts);
	    const piRecords = normalizeBreakingNewsRecords(parsed, snapshot, runAtMs, currentThemes);
	    const records = piRecords;
	    const themeToolCalls = toolCalls.filter((call) => call && call.tool === "searchBrave" && call.purpose === "theme_news");
		    const marketToolCalls = toolCalls.filter((call) => call && (call.tool === "searchArraysIndexedX" || call.tool === "searchGrokX"));
	    const topicToolCalls = toolCalls.filter((call) => call && call.tool === "searchArraysMarketNewsTopic");
	    const themeParsedCount = Array.isArray(parsed.events) ? parsed.events.filter((item) => isThemeNewsEvent(item)).length : 0;
	    const themeRecordCount = records.filter((record) => record.sourceType === "theme_news" || record.sourceType === "topic_news").length;
    summary.toolCalls = toolCalls;
	    summary.queries = marketToolCalls.map((call) => call.query).filter(Boolean);
	    summary.themeQueries = themeToolCalls.map((call) => ({ theme: call.theme || "", query: call.query || "" })).filter((row) => row.query);
	    summary.themeTopicMappings = topicMappings;
	    summary.topicNewsCalls = topicToolCalls;
	    summary.topicNewsRecords = topicToolCalls.reduce((acc, call) => acc + (Number(call.resultCount) || 0), 0);
	    summary.parsedEventCount = Array.isArray(parsed.events) ? parsed.events.length : 0;
	    summary.rawEventRecords = records.length;
    summary.searchAudit = Array.isArray(parsed.search_audit) ? parsed.search_audit.slice(0, 12) : [];
    summary.themeNewsSummary.toolCalls = themeToolCalls;
	    summary.themeNewsSummary.queries = summary.themeQueries;
	    summary.themeNewsSummary.themeTopicMappings = topicMappings;
	    summary.themeNewsSummary.topicNewsCalls = topicToolCalls;
	    summary.themeNewsSummary.topicNewsRecords = summary.topicNewsRecords;
    summary.themeNewsSummary.parsedEventCount = themeParsedCount;
    summary.themeNewsSummary.rawEventRecords = themeRecordCount;
    return { records, summary };
  } catch (err) {
    summary.error = String(err && err.message ? err.message : err).slice(0, 260);
    summary.themeNewsSummary.error = summary.error;
    warnings.push({ source: "pi-event-search-loop", error: summary.error });
    return { records: [], summary };
  }
}

async function fetchBreakingNews(snapshot, currentThemes, fetchStartMs, runAtMs, warnings) {
  if (CONFIG.breakingNewsSourceMode === "internal_pi") {
    return fetchInternalBreakingNews(snapshot, currentThemes, fetchStartMs, runAtMs, warnings);
  }
  return fetchExternalBreakingNews(snapshot, currentThemes, fetchStartMs, runAtMs, warnings);
}

function themeSearchPhrase(theme) {
  return String(theme || "").replace(/-/g, " ") + " market news";
}

function holdingsForTheme(snapshot, theme) {
  const themeLc = String(theme || "").toLowerCase();
  return (snapshot.holdings || [])
    .filter((holding) => {
      const themes = themesForHolding(snapshot, holding).map((x) => String(x || "").toLowerCase());
      return themes.indexOf(themeLc) >= 0;
    })
    .slice()
    .sort((a, b) => (b.allocation || 0) - (a.allocation || 0));
}

function legacyEventKey(item, runAtMs) {
  const symbols = rawAffectedSymbols(item);
  const subject = symbols.length > 1 || String(item.symbol || "").toUpperCase() === "PORTFOLIO"
    ? "multi"
    : (symbols[0] || item.symbol || "unknown");
  if (item.sourceRecordId) return [item.sourceType, subject, normalizeKey(item.sourceRecordId)].join(":");
  if (item.url) return [item.sourceType, subject, normalizeKey(item.url)].join(":");
  return [item.sourceType, subject, normalizeKey(item.title), String(Math.floor((item.publishedAtMs || runAtMs || Date.now()) / 86400000))].join(":");
}

function eventKey(item, runAtMs) {
  if (String(item && item.sourceType || "").toLowerCase() === "external_breaking_news") {
    const sourceId = normalizeKey(item && (item.sourceRecordId || (item.metadata && item.metadata.externalEventKey) || (item.metadata && item.metadata.externalEventId) || item.title));
    if (sourceId) return ["external-breaking-news", sourceId].join(":");
  }
  if (isNewsLikeEvent(item)) {
    const urlKey = canonicalEventUrl(item);
    if (urlKey) return ["news-url", urlKey].join(":");
    const titleKey = normalizeKey(item && item.title);
    if (titleKey) return ["news-title", titleKey, eventDayBucket(item, runAtMs)].join(":");
  }
  return legacyEventKey(item, runAtMs);
}

function normalizeEvent(rawItems, previousIndex, runAtMs) {
  const seenThisRun = {};
  const index = previousIndex && typeof previousIndex === "object" ? previousIndex : {};
  const records = [];
  rawItems.forEach((raw) => {
    const key = eventKey(raw, runAtMs);
    const legacyKey = legacyEventKey(raw, runAtMs);
    const prior = index[key] || index[legacyKey];
    const rawPublishedAtMs = Number.isFinite(raw.publishedAtMs) ? raw.publishedAtMs : null;
    let status = "new";
    if (seenThisRun[key] !== undefined) {
      const existing = records[seenThisRun[key]];
      if (existing) {
        existing.metadata = mergeEventMetadata(existing, raw);
        existing.sourceLinks = mergeUniqueStrings(existing.sourceLinks || [], raw.sourceLinks || (raw.url ? [raw.url] : []), 500);
        existing.affectedThemes = uniqueCompactStrings((existing.affectedThemes || []).concat(rawAffectedThemes(raw)), 80).map(normalizeThemeName).filter(Boolean);
        existing.mappingReason = existing.mappingReason || raw.mappingReason || (raw.metadata && raw.metadata.mappingReason) || "";
      }
      return;
    } else if (prior) {
      const oldHash = prior.textHash || "";
      const nextHash = normalizeKey((raw.title || "") + " " + (raw.summary || ""));
      status = oldHash && oldHash !== nextHash ? "updated" : "seen_before";
    }
    seenThisRun[key] = records.length;
    const firstSeenAtMs = prior && prior.firstSeenAtMs ? prior.firstSeenAtMs : runAtMs;
    const textHash = normalizeKey((raw.title || "") + " " + (raw.summary || ""));
    index[key] = {
      eventKey: key,
      sourceType: raw.sourceType || "",
      symbol: raw.symbol || "",
      title: raw.title || "",
      url: raw.url || "",
      affectedSymbols: rawAffectedSymbols(raw),
      affectedThemes: rawAffectedThemes(raw),
      textHash,
      firstSeenAtMs,
      lastSeenAtMs: runAtMs,
      seenCount: (prior && prior.seenCount ? prior.seenCount : 0) + 1,
    };
    const record = {
      eventKey: key,
      sourceType: raw.sourceType || "",
      symbol: raw.symbol || "",
      title: clean(raw.title, 240),
      summary: clean(raw.summary, 700),
      url: raw.url || "",
      source: raw.source || "",
      dedupeStatus: status,
      metadata: raw.metadata || {},
      affectedSymbols: rawAffectedSymbols(raw),
      affectedThemes: rawAffectedThemes(raw),
      sourceLinks: raw.sourceLinks || (raw.metadata && raw.metadata.sourceLinks) || [],
      mappingReason: raw.mappingReason || (raw.metadata && raw.metadata.mappingReason) || "",
      publishedAtMs: rawPublishedAtMs,
      firstSeenAtMs,
      lastSeenAtMs: runAtMs,
      runAtMs,
    };
    record.metadata = mergeEventMetadata(record, raw);
    records.push(record);
  });
  const keys = Object.keys(index).sort((a, b) => (index[b].lastSeenAtMs || 0) - (index[a].lastSeenAtMs || 0));
  const capped = {};
  keys.slice(0, 1000).forEach((key) => {
    capped[key] = index[key];
  });
  return { records, index: capped };
}

function eventAffectedSymbols(item, snapshot) {
  const holdingBy = bySymbol(snapshot);
  const metadata = item && item.metadata || {};
  if (metadata.holdingMappingPolicy === "pi_agent_related_holdings_only") {
    return uniqueSymbols(rawAffectedSymbols(item).filter((symbol) => !!holdingBy[symbol]));
  }
  if (metadata.holdingMappingPolicy === "pi_agent_related_holdings_or_portfolio_level") {
    return uniqueSymbols(rawAffectedSymbols(item).filter((symbol) => !!holdingBy[symbol]));
  }
  const out = [];
  rawAffectedSymbols(item).forEach((symbol) => {
    if (holdingBy[symbol]) out.push(symbol);
    (snapshot.holdings || []).forEach((holding) => {
      if (marketDataSymbolForHolding(holding) === symbol) out.push(holding.symbol);
    });
  });
  return uniqueSymbols(out);
}

function eventAffectedThemes(item, snapshot, affectedSymbols) {
  return uniqueCompactStrings(
    rawAffectedThemes(item).concat((affectedSymbols || []).reduce((acc, symbol) => acc.concat(themesForHolding(snapshot, bySymbol(snapshot)[symbol] || { symbol })), [])),
    80
  ).map(normalizeThemeName).filter(Boolean);
}

function eventPortfolioExposure(snapshot, affectedSymbols) {
  if (!canComputePortfolioSizing(snapshot)) return null;
  const holdingBy = bySymbol(snapshot);
  return (affectedSymbols || []).reduce((acc, symbol) => acc + ((holdingBy[symbol] && holdingBy[symbol].allocation) || 0), 0);
}

function eventCandidateEligible(item, affectedSymbols, runAtMs) {
  if (!item || item.dedupeStatus === "duplicate") return false;
  return true;
}

function eventMentionsSymbol(item, symbol) {
  const text = ((item.title || "") + " " + (item.summary || "")).toLowerCase();
  const metadata = item.metadata || {};
  const tickers = metadata.tickers || [];
  const tickerHit = Array.isArray(tickers) && tickers.some((row) => {
    if (typeof row === "string") return row.toUpperCase() === symbol;
    return String(row.ticker || row.symbol || "").toUpperCase() === symbol;
  });
  if (tickerHit) return true;
  const itemThemes = Array.isArray(metadata.themes) ? metadata.themes.map((theme) => String(theme || "").toLowerCase()) : [];
  if (metadata.themeMatched && itemThemes.length) {
    const holdingThemes = fallbackThemesForSymbol(symbol).map((theme) => String(theme || "").toLowerCase());
    if (itemThemes.some((theme) => holdingThemes.indexOf(theme) >= 0)) return true;
  }
  if (text.indexOf("$" + symbol.toLowerCase()) >= 0) return true;
  const aliases = CONFIG.aliases[symbol] || [symbol];
  return aliases.some((alias) => {
    const raw = String(alias || "").toLowerCase();
    if (!raw) return false;
    if (raw[0] === "$") return text.indexOf(raw) >= 0;
    if (raw.length <= 3) {
      const rx = new RegExp("(^|[^a-z0-9])" + raw.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "([^a-z0-9]|$)");
      return rx.test(text);
    }
    return text.indexOf(raw) >= 0;
  });
}

function priceSignalSchemaCompatible(previousPriceSignals) {
  const rows = Object.keys(previousPriceSignals || {}).map((key) => previousPriceSignals[key]).filter(Boolean);
  if (!rows.length) return false;
  return rows.every((row) =>
    row.priceSignalVersion === CONFIG.priceSignalVersion &&
    row.volumeSignalVersion === CONFIG.volumeSignalVersion);
}

function priceSignalMap(signals) {
  const out = {};
  (signals || []).forEach((signal) => {
    if (signal && signal.symbol) out[signal.symbol] = signal;
  });
  return out;
}

function buildAnomalies(snapshot, priceSignals) {
  const anomalies = [];
  const holdingBySymbol = bySymbol(snapshot);

  (priceSignals || []).forEach((signal) => {
    const h = holdingBySymbol[signal.symbol];
    if (!h || !signal.available || !signal.abnormal) return;
    const marketDataSymbol = signal.marketDataSymbol || signal.symbol;
    const usesUnderlying = marketDataSymbol && marketDataSymbol !== signal.symbol;
    const signalLabel = usesUnderlying ? signal.symbol + " underlying " + marketDataSymbol : signal.symbol;
    anomalies.push({
      anomalyId: "anomaly:" + signal.symbol + ":" + (signal.reasons || []).join("+"),
      lane: "anomaly_attribution",
      anomalyType: "asset_anomaly",
      symbol: signal.symbol,
      primaryAsset: signal.symbol,
      marketDataSymbol,
      underlyingSymbol: signal.underlyingSymbol || "",
      marketDataBasis: signal.marketDataBasis || (usesUnderlying ? "underlying_equity" : "holding_symbol"),
      title: signalLabel + " asset anomaly",
      summary:
        signalLabel + " triggered " + (signal.triggerKinds || []).join("+") + " anomaly; latest 1d " + fmtMove(signal.oneDayPct) +
        " (" + (signal.oneDayBasis || "latest basis") + ")" +
        ", last closed 1d " + fmtMove(signal.lastClosedOneDayPct) +
        ", 5d " + fmtMove(signal.fiveDayPct) +
        ", z " + signal.zScore +
        ", cumulative volume " + signal.cumulativeVolumeMultiple + "x.",
      reason: usesUnderlying
        ? "Objective asset-level anomaly on the option holding's underlying equity; attribution should consider price and volume triggers together."
        : "Objective asset-level anomaly on a current holding; attribution should consider price and volume triggers together.",
      anomalyMetrics: signal,
      eventRefs: [],
      sourceOrigin: "asset_anomaly_signal",
      sourceOriginLabel: sourceOriginLabel("asset_anomaly_signal"),
      sourceLane: "price_volume_anomaly",
      sourceSearchMode: usesUnderlying ? "computed_from_underlying_market_data" : "computed_from_market_data",
    });
  });

  return anomalies;
}

function anomalyThemes(snapshot, anomaly) {
  const holding = bySymbol(snapshot)[anomaly && anomaly.symbol] || {};
  return themesForHolding(snapshot, holding);
}

function compactHoldingForAnomalyAgent(snapshot, anomaly) {
  const holding = bySymbol(snapshot)[anomaly && anomaly.symbol] || {};
  const canComputeSizing = canComputePortfolioSizing(snapshot);
  const sourceAccounts = holding && holding.instrumentDetails && Array.isArray(holding.instrumentDetails.sourceAccounts)
    ? holding.instrumentDetails.sourceAccounts
    : [];
  return {
    symbol: holding.symbol || (anomaly && anomaly.symbol) || "",
    assetClass: holding.assetClass || "",
    side: holding.side || "",
    quantity: canComputeSizing ? holding.quantity : null,
    currentPrice: holding.currentPrice,
    marketValue: canComputeSizing ? holding.marketValue : null,
    weight: canComputeSizing ? round(holding.allocation || 0, 4) : null,
    positionSizeAvailable: canComputeSizing,
    sourceAccountCount: sourceAccounts.length || null,
    themes: anomalyThemes(snapshot, anomaly),
    marketDataSymbol: anomaly && anomaly.marketDataSymbol || holding.symbol || "",
    underlyingSymbol: anomaly && anomaly.underlyingSymbol || "",
    marketDataBasis: anomaly && anomaly.marketDataBasis || "",
  };
}

function relatedHoldingSymbol(row) {
  return String(
    row && (
      row.holding_symbol ||
      row.holdingSymbol ||
      row.symbol ||
      row.ticker ||
      ""
    ) || ""
  ).toUpperCase();
}

function topLevelRiskFactors(item) {
  const metadata = item && item.metadata || {};
  return uniqueCompactStrings(
    []
      .concat(item && item.riskFactors || [])
      .concat(item && item.risk_factors || [])
      .concat(metadata.riskFactors || [])
      .concat(metadata.risk_factors || []),
    80
  ).map(normalizeThemeName).filter(Boolean);
}

function portfolioEventCanInformAnomaly(item, anomaly, snapshot) {
  const metadata = item && item.metadata || {};
  const portfolioLevel = !!(item && item.portfolioLevelEvent) || !!metadata.portfolioLevelEvent;
  if (!portfolioLevel) return false;
  const factors = topLevelRiskFactors(item);
  if (!factors.length) return false;
  const broadMacro = {
    rates: true,
    inflation: true,
    cpi: true,
    jobs: true,
    fomc: true,
    liquidity: true,
    credit: true,
    dollar: true,
    fx: true,
    oil: true,
    crude: true,
    sanctions: true,
    geopolitical: true,
    "risk-appetite": true,
    "broad-risk-appetite": true,
  };
  if (factors.some((factor) => broadMacro[factor])) return true;
  const holdingThemes = anomalyThemes(snapshot, anomaly);
  return holdingThemes.some((theme) => factors.indexOf(theme) >= 0 && broadMacro[theme]);
}

function eventMatchesAnomalyContext(item, anomaly, snapshot) {
  if (!item || !anomaly) return false;
  const symbol = String(anomaly.symbol || "").toUpperCase();
  const marketDataSymbol = String(anomaly.marketDataSymbol || anomaly.symbol || "").toUpperCase();
  const affected = uniqueSymbols(rawAffectedSymbols(item));
  if (affected.indexOf(symbol) >= 0 || affected.indexOf(marketDataSymbol) >= 0) return true;
  const metadata = item.metadata || {};
  const related = uniqueSymbols(
    []
      .concat(item.relatedHoldings || [])
      .concat(metadata.relatedHoldings || [])
      .filter((row) => !row || !row.mappingStrength || row.mappingStrength === "holding_level")
      .map(relatedHoldingSymbol)
  );
  if (related.indexOf(symbol) >= 0 || related.indexOf(marketDataSymbol) >= 0) return true;
  const sourceTickers = normalizeTickerRows(
    []
      .concat(item.sourceRelatedTickers || [])
      .concat(metadata.sourceRelatedTickers || [])
      .concat(metadata.tickers || [])
  );
  if (sourceTickers.indexOf(symbol) >= 0 || sourceTickers.indexOf(marketDataSymbol) >= 0) return true;
  if (portfolioEventCanInformAnomaly(item, anomaly, snapshot)) return true;
  return false;
}

function relatedEventsForAnomaly(anomaly, eventRecords, eventCandidates, snapshot) {
  const eventByKey = {};
  (eventRecords || []).forEach((event) => {
    if (event && event.eventKey) eventByKey[event.eventKey] = event;
  });
  const relatedKeys = {};
  (eventCandidates || []).forEach((candidate) => {
    if (!candidate) return;
	    const linked = eventMatchesAnomalyContext(candidate, anomaly, snapshot);
	    if (!linked) return;
    (candidate.eventRefs || []).forEach((key) => {
      if (key) relatedKeys[key] = true;
    });
  });
  (eventRecords || []).forEach((event) => {
    if (eventMatchesAnomalyContext(event, anomaly, snapshot) && event.eventKey) relatedKeys[event.eventKey] = true;
  });
  return Object.keys(relatedKeys)
    .map((key) => eventByKey[key])
    .filter(Boolean)
    .slice(0, 60);
}

function buildAnomalyAttributionPrompt(input) {
  return [
    "You are a per-asset Anomaly Attribution Agent for a portfolio watch automation.",
    "Your job is to explain one computed held-asset anomaly before the final portfolio analyst writes the user message.",
    "",
    "Use the Skill Hub why-the-move methodology when available: skill_id = carl-2/discord-why-the-move.",
    "If the Alva Ask environment exposes a Skill Hub/tool path for that skill, use it. If not, apply the same method directly: decompose market / sector / asset-specific drivers, test timing / direction / size, require sourced support, and do not invent catalysts.",
    "",
    "Rules:",
    "- This is attribution only, not a push/no-push decision.",
    "- Use available tools if the supplied packet looks stale, wrong, or too thin.",
	    "- Do not invent facts, prices, catalysts, source links, or causal chains.",
	    "- A current event is not automatically the cause. It must fit timing, direction, and size.",
	    "- A narrative can be context, but not a fresh catalyst unless there is a dated new fact or clear same-session market reaction.",
	    "- related_event_records and event_candidates_for_context are possible context, not causal evidence. Do not treat a portfolio-level or context-only thematic event as a supporting event for this asset unless the source directly names the asset, its product market, peer, customer/supplier chain, or there is clear same-session market reaction in this asset group.",
	    "- When related records include sourceEvidence or sourceText, review those primary/supporting/X source items before labeling the event stale, rumor, or unsupported.",
	    "- Broad data-center power/capex or AI-infrastructure buildout news is not by itself a memory, semiconductor, server, or networking catalyst. If it lacks direct product-market transmission or a specific high-confidence second-order value-chain transmission, classify it as background context or weak_correlation, not plausible/confirmed attribution.",
	    "- If attribution is not strong, return weak_correlation or unexplained and say what the best grounded guess is.",
    "",
    "Return JSON only. It MUST begin with { and end with }.",
    "Schema:",
    "{",
    '  "anomaly_id":"",',
    '  "symbol":"",',
    '  "market_data_symbol":"",',
    '  "headline":"",',
    '  "summary":"",',
    '  "attribution_status":"confirmed|plausible|weak_correlation|unexplained",',
    '  "driver_split":{"market":"","sector":"","asset_specific":""},',
    '  "supporting_events":[],',
    '  "source_links":[],',
    '  "data_quality_notes":[],',
    '  "confidence":"low|medium|high",',
    '  "as_of_hkt":""',
    "}",
    "",
    "Input JSON:",
    compactJson(input, CONFIG.maxAnomalyAttributionPromptChars),
  ].join("\n");
}

function normalizeAnomalyAttributionPacket(parsed, anomaly, runAtMs, rawText, errorText, sessionId) {
  const payload = parsed && typeof parsed === "object" ? parsed : {};
  const status = clean(payload.attribution_status || payload.attributionStatus || "", 60);
  const allowed = { confirmed: true, plausible: true, weak_correlation: true, unexplained: true };
  return {
    attributionPacketId: "attrib:" + (anomaly.anomalyId || anomaly.symbol || "unknown"),
    anomalyId: anomaly.anomalyId || "",
    symbol: anomaly.symbol || anomaly.primaryAsset || "",
    marketDataSymbol: anomaly.marketDataSymbol || anomaly.symbol || "",
    underlyingSymbol: anomaly.underlyingSymbol || "",
    environment: "Alva Ask (LLM)",
    call: "ask(buildAnomalyAttributionPrompt(anomalyInput))",
    skillhubSkill: "carl-2/discord-why-the-move",
    version: CONFIG.anomalyAttributionVersion,
    agentStatus: errorText ? "agent_error" : "completed",
    error: errorText || "",
    headline: clean(payload.headline || "", 220),
    summary: errorText
      ? "Anomaly attribution agent failed or returned unparseable JSON; final analyst should still review this anomaly as real but attribution-uncertain."
      : clean(payload.summary || "", 900),
    attributionStatus: allowed[status] ? status : (errorText ? "unexplained" : "weak_correlation"),
    driverSplit: payload.driver_split || payload.driverSplit || {},
    supportingEvents: Array.isArray(payload.supporting_events) ? payload.supporting_events : (payload.supportingEvents || []),
    sourceLinks: Array.isArray(payload.source_links) ? payload.source_links : (payload.sourceLinks || []),
    dataQualityNotes: Array.isArray(payload.data_quality_notes)
      ? payload.data_quality_notes
      : (payload.dataQualityNotes || (errorText ? [errorText] : [])),
    confidence: payload.confidence || (errorText ? "low" : "medium"),
    asOfHkt: payload.as_of_hkt || payload.asOfHkt || hkt(runAtMs),
    rawTextPreview: clean(rawText || "", 1200),
    sessionId: sessionId || "",
  };
}

function runAnomalyAttributionAgents(anomalies, context) {
  const packets = [];
  const warnings = context.warnings || [];
	  (anomalies || []).forEach((anomaly, idx) => {
	    const relatedEventRecords = relatedEventsForAnomaly(anomaly, context.eventRecords || [], context.eventCandidates || [], context.snapshot || {});
	    const canComputeSizingForPacket = canComputePortfolioSizing(context.snapshot || {});
	    const promptInput = {
      run_at_hkt: context.runAtHkt || hkt(context.runAtMs),
      account_id: snapshotAccountId(context.snapshot || {}),
      account_ids: (context.snapshot && context.snapshot.accountIds) || [],
      anomaly_index: idx + 1,
      anomaly,
      holding: compactHoldingForAnomalyAgent(context.snapshot || {}, anomaly),
      related_event_records: relatedEventRecords.map(compactRawEventForAnalyst),
	      event_candidates_for_context: (context.eventCandidates || [])
	        .filter((candidate) => {
	          return eventMatchesAnomalyContext(candidate, anomaly, context.snapshot || {});
	        })
        .slice(0, 30)
        .map(compactEventCandidateForAnalyst),
      portfolio_snapshot_context: {
        totalValue: context.snapshot && context.snapshot.totalValue,
        cash: context.snapshot && context.snapshot.cash,
	        valuationBasis: context.snapshot && context.snapshot.priceBasis,
	        topHoldings: ((context.snapshot && context.snapshot.holdings) || []).slice(0, 10).map((h) => ({
	          symbol: h.symbol,
	          weight: canComputeSizingForPacket ? round(h.allocation || 0, 4) : null,
	          themes: themesForHolding(context.snapshot || {}, h),
	        })),
      },
      macro_context: context.macro || {},
      prior_alert_history: context.priorAlertHistory || [],
      source_contract: {
        price: "Current move metrics come from Arrays latest 1min extended-hours price versus previous regular close when available.",
        volume: "Volume anomaly is hourly cumulative volume versus historical same-time cumulative volume.",
        events: "Related event records are starting context only. Verify or ignore them if timing/direction/size does not fit the anomaly.",
      },
    };
    let rawText = "";
    let sessionId = "";
    try {
      const result = ask(buildAnomalyAttributionPrompt(promptInput), { effort: "high", timeoutMs: CONFIG.timeouts.anomalyAttributionMs });
      rawText = String(result && result.text || "");
      sessionId = String(result && result.session_id || "");
      const parsed = safeParseJson(rawText);
      if (!parsed) throw new Error("Anomaly attribution prompt did not return parseable JSON");
      packets.push(normalizeAnomalyAttributionPacket(parsed, anomaly, context.runAtMs, rawText, "", sessionId));
    } catch (err) {
      const error = String(err && err.message ? err.message : err).slice(0, 260);
      warnings.push({ source: "anomaly-attribution-agent:" + (anomaly.symbol || "unknown"), error });
      packets.push(normalizeAnomalyAttributionPacket(null, anomaly, context.runAtMs, rawText, error, sessionId));
    }
  });
  return packets;
}

function compactAnomalyAttributionPacketForAnalyst(packet) {
  const row = packet || {};
  return {
    attributionPacketId: row.attributionPacketId || "",
    anomalyId: row.anomalyId || "",
    symbol: row.symbol || "",
    marketDataSymbol: row.marketDataSymbol || "",
    skillhubSkill: row.skillhubSkill || "",
    agentStatus: row.agentStatus || "",
    headline: clean(row.headline || "", 180),
    summary: clean(row.summary || "", 700),
    attributionStatus: row.attributionStatus || "",
    driverSplit: row.driverSplit || {},
    supportingEvents: row.supportingEvents || [],
    sourceLinks: (row.sourceLinks || []).slice(0, 6),
    dataQualityNotes: row.dataQualityNotes || [],
    confidence: row.confidence || "",
    asOfHkt: row.asOfHkt || "",
    error: row.error || "",
  };
}

function compactAnomalyAttributionPacketForAudit(packet) {
  const row = compactAnomalyAttributionPacketForAnalyst(packet);
  return {
    ...row,
    environment: (packet && packet.environment) || "Alva Ask (LLM)",
    call: (packet && packet.call) || "ask(buildAnomalyAttributionPrompt(anomalyInput))",
    version: (packet && packet.version) || CONFIG.anomalyAttributionVersion,
    rawTextPreview: clean((packet && packet.rawTextPreview) || "", 1200),
    sessionId: (packet && packet.sessionId) || "",
  };
}

function anomalyAsLegacyCandidate(anomaly) {
  return {
    candidateId: anomaly.anomalyId,
    lane: anomaly.lane,
    candidateType: anomaly.anomalyType || "asset_anomaly",
    symbol: anomaly.symbol,
    title: anomaly.title,
    summary: anomaly.summary,
    reason: anomaly.reason,
    anomalyMetrics: anomaly.anomalyMetrics,
    eventRefs: [],
    sourceOrigin: anomaly.sourceOrigin,
    sourceOriginLabel: anomaly.sourceOriginLabel,
    sourceLane: anomaly.sourceLane,
    sourceSearchMode: anomaly.sourceSearchMode,
    marketDataSymbol: anomaly.marketDataSymbol,
    underlyingSymbol: anomaly.underlyingSymbol,
    marketDataBasis: anomaly.marketDataBasis,
  };
}

function buildEventCandidates(snapshot, eventRecords) {
  const candidates = [];

  (eventRecords || []).forEach((item) => {
    const affectedSymbols = eventAffectedSymbols(item, snapshot);
    if (!eventCandidateEligible(item, affectedSymbols, snapshot.runAtMs)) return;
    const affectedThemes = eventAffectedThemes(item, snapshot, affectedSymbols);
    const portfolioExposurePct = affectedSymbols.length ? eventPortfolioExposure(snapshot, affectedSymbols) : null;
    const primaryAsset = affectedSymbols.length ? (affectedSymbols.length > 1 ? "PORTFOLIO" : affectedSymbols[0]) : "PORTFOLIO";
    const sourceOrigin = sourceOriginFromEvent(item);
    const metadata = item.metadata || {};
    const linkedText = !affectedSymbols.length
      ? "portfolio-level risk/theme context" + (affectedThemes.length ? " (" + affectedThemes.join(", ") + ")" : "")
      : affectedSymbols.length > 1
      ? affectedSymbols.length + " holdings (" + affectedSymbols.join(", ") + ")"
      : affectedSymbols[0];
	    const exposureText = affectedSymbols.length
	      ? (Number.isFinite(portfolioExposurePct) ? fmtPct(portfolioExposurePct) : "sizing unavailable")
	      : "analyst-estimated";
    const portfolioLevelEvent = !affectedSymbols.length;
    candidates.push({
      candidateId: "event:" + item.eventKey,
      lane: "event_impact",
      candidateType: item.sourceType,
      symbol: primaryAsset,
      primaryAsset,
      title: item.title,
      summary: item.summary,
      reason: item.sourceType + " source record has dedupeStatus=" + item.dedupeStatus + " and maps to " + linkedText + " (" + exposureText + " exposure). Analyst must judge semantic relevance, novelty, exposure impact, and materiality.",
      eventRefs: [item.eventKey],
      affectedSymbols,
      affectedThemes,
      portfolioExposurePct,
	      portfolioExposureText: exposureText,
	      sourceLinks: item.sourceLinks || metadata.sourceLinks || (item.url ? [item.url] : []),
	      sourceEvidence: metadata.sourceEvidence || metadata.evidenceSources || item.sourceEvidence || [],
	      mappingReason: item.mappingReason || metadata.mappingReason || metadata.whyRelevant || "",
      portfolioLevelEvent,
      riskFactors: metadata.riskFactors || [],
      portfolioRelevanceBasis: metadata.portfolioRelevanceBasis || "",
      sourceOrigin,
      sourceOriginLabel: sourceOriginLabel(sourceOrigin),
      sourceLane: metadata.sourceLane || "",
      sourceSearchMode: metadata.sourceSearchMode || "",
      source: item.source,
      url: item.url,
      dedupeStatus: item.dedupeStatus,
      publishedAtMs: item.publishedAtMs,
      sourceTimeLabel: metadata.sourceTimeLabel || "",
	      sourceEventTime: metadata.sourceEventTime === undefined ? "" : metadata.sourceEventTime,
	      sourceEventAtMs: metadata.sourceEventAtMs || null,
	      relatedHoldings: metadata.relatedHoldings || [],
	      sourceRelatedTickers: metadata.sourceRelatedTickers || [],
	      sourceTweetId: metadata.sourceTweetId || "",
	      sourceTweetUrl: metadata.sourceTweetUrl || "",
	      sourceTweetRank: metadata.sourceTweetRank || null,
	      sourceTweetEngagementScore: metadata.sourceTweetEngagementScore || null,
	      sourceText: clean(metadata.sourceText || "", 900),
	      firstSeenAtMs: item.firstSeenAtMs,
      lastSeenAtMs: item.lastSeenAtMs,
    });
  });

  return candidates;
}

function buildCandidates(snapshot, previous, delta, priceSignals, previousPriceSignals, eventRecords, currentThemes, previousThemes) {
  return buildEventCandidates(snapshot, eventRecords).concat(buildAnomalies(snapshot, priceSignals).map(anomalyAsLegacyCandidate));
}

function findingDedupeKey(finding, fallback) {
  return normalizeKey([
    finding.finding_type || finding.findingType || fallback.findingType || "",
    finding.primary_asset || finding.primaryAsset || fallback.primaryAsset || "",
    finding.event_id || finding.eventId || "",
    finding.event_title || finding.summary || fallback.summary || "",
  ].join("|"));
}

function buildAnalystPrompt(input) {
  const lens = CONFIG.decisionLens || { enabled: true, mode: "framed_insight" };
  const explicitCalls = lens.enabled && lens.mode === "explicit_calls";
  return [
    "You are the analyst for a low-noise portfolio watch automation.",
    "Your job is to decide whether this run is worth interrupting a discretionary investor now, prepare accurate data analysis for any selected event or anomaly attribution, and write the user-ready message. Default to no_push unless the user would likely be glad they saw it.",
    "",
    "1. Role",
    "- This is portfolio monitoring, not a daily news digest.",
    "- Use the supplied JSON as the base packet. If something looks wrong, stale, or worth deeper confirmation, you may use tools available to verify it. Do not invent facts, prices, catalysts, or source links.",
    "- If portfolio_watch_preferences_note is supplied, treat it as this user's Portfolio Watch instruction plugin. Prioritize it for attention priorities, writing/framing choices, thesis/risk emphasis, and watch-next language.",
    "- If portfolio_watch_preferences_note conflicts with generic analyst instructions, follow the user preferences while still respecting supplied evidence, portfolio facts, source constraints, and compliance framing.",
    "- Preferences are instructions, not market facts; do not invent facts from them.",
	    "",
	    "2. Decision mission",
	    "- Judge whether current holdings may be affected, and why.",
	    "- Select user-visible findings for either material event exposure impacts or held-asset anomalies that add a new user-facing move, attribution, uncertainty, or watchpoint.",
	    "- Do not reject a source because it is opinion, preview, commentary, analyst content, or a calendar item. Judge whether it is a real signal: source authority, specificity, novelty, market influence, changed expectations, near-term catalyst relevance, and portfolio exposure.",
	    "- Choose no_push when every available signal is stale, generic, already user-visible, unsupported by the supplied data, semantically wrong, or not relevant to current holdings/themes.",
	    "- When asset_anomalies is non-empty, no_push is valid only if every computed anomaly fails the anomaly lane selection rule because the data looks wrong or the same asset's abnormal move/watchpoint was already user-visible.",
	    "- Position size calibrates tone, urgency, and exposure language; it is not by itself a suppression reason.",
    "",
    "3. Two separate lanes",
    "A) Event lane",
    "- event_candidates_to_review is a long list of source records that code attached to current holdings or preserved as portfolio-level risk-factor events. They are not yet qualified events.",
	    "- A candidate may be single-asset or portfolio-level. Use affectedSymbols, affectedThemes, riskFactors, portfolioRelevanceBasis, sourceLinks, mappingReason, and portfolioExposurePct as the starting context. portfolioExposurePct may be null when portfolio_capabilities says sizing is unavailable.",
    "- First decide whether each event candidate is a real portfolio-relevant event, weak/noisy, repeated, seen-before context, or not qualified.",
    "- For anticipated events, judge the setup, not just whether the source is breaking news. Opinion, preview, commentary, analyst, or calendar rows can support a setup alert when they clarify market expectations, disagreement, positioning, key watchpoints, or risk/reward around a near-term catalyst tied to material portfolio exposure.",
    "- Return eventCandidateStatuses for every event candidate. candidate_id must copy the candidateId exactly, including the event: prefix, with status selected, suppressed, or not_qualified and a concise reason.",
    "- Use not_qualified for any candidate you do not promote into an eventImpactFinding, including stale, routine, weak, repeated, or semantically wrong rows. Use suppressed only when you created a linked eventImpactFinding but decided it should not be selected for the notification.",
	    "- For candidates that become real events worth analysis, create eventImpactFindings with exposure_impact.",
	    "- Ask: what changed, which current holdings/themes/risk buckets may be affected, and how large is the likely direct or related exposure?",
		    "- Estimate exposure only when portfolio_capabilities.canComputeExposurePct is true. Use current holdings, weights, themes, and theme_exposure, and show the calculation briefly in exposure_impact. When sizing is unavailable, describe affected holdings/themes without inventing percentages.",
	    "- Direct/affected exposure comes only from affectedSymbols or a source-grounded holding-level relation, including high-confidence second-order value-chain transmission when concrete. Context-only theme/risk read-through can be discussed as a bucket, but do not add unrelated holdings into an affected exposure calculation.",
	    "- If relatedHoldings includes peer/competitor, supplier/customer, option-underlying, or second_order/value_chain relations, use those source-grounded relations as the allowed transmission chain. Do not invent extra second-order links inside analyst.",
	    "- Do not suppress a directly relevant event just because no anomaly was supplied. First judge whether the event is material on its own, then use current price/volume context or tools if needed. If suppressed, explain the real reason.",
    "- Treat portfolio delta and theme exposure as context only, not standalone findings.",
    "",
    "B) Anomaly lane",
    "- asset_anomalies are already computed anomalies, not candidates.",
	    "- anomaly_attribution_packets are prepared by one per-asset Alva Ask Anomaly Attribution Agent using the Skill Hub why-the-move methodology when available.",
	    "- Use those packets as the attribution starting point. Do not redo attribution from scratch unless the packet looks wrong, stale, or weak enough to verify with tools.",
	    "- Produce one final anomalyAttributionFinding for every asset anomaly, combining price and volume triggers for that asset.",
	    "- A computed held-asset anomaly is an objective portfolio signal. Select it unless the data looks wrong or prior_alert_history shows the user already received the same asset move and same attribution/watchpoint.",
	    "- Prior coverage for an anomaly means the user already received the same asset's abnormal price/volume move or anomaly watchpoint. Prior broad theme, event, or portfolio-bucket notes are context, not prior anomaly coverage.",
	    "- Weak attribution, low volume confirmation, small position size, or lack of a confirmed catalyst changes confidence, urgency, and wording; it does not change anomaly selection.",
	    "- If the dedicated packet says weak_correlation, unexplained, or agent_error, still summarize the move with uncertainty clearly labeled and a watch_next item that would confirm or reject the best grounded guess.",
	    "- Do not merge event-impact and anomaly-attribution lanes into one causal story unless there is first- or high-confidence second-order evidence. A broad portfolio/theme event may be worth noting separately while an asset move remains continuation, weak_correlation, or unexplained.",
    "",
    "4. Novelty and materiality gate",
    "- prior_alert_history is the past 7 days of user-visible run timeline. Empty runs show only that no push was sent; they are not prior suppressed reasoning.",
    "- Read prior_alert_history to avoid annoying repeats of messages the user actually received.",
    "- Novelty includes the user-facing message, not just the event/source. If prior alerts already explained the same exposure map, risk bucket, affected holdings, or generic framing, treat that as already-known context and only surface the new delta.",
    "- A repeated narrative is pushable only if there is genuinely new information, higher urgency, changed uncertainty, or stronger attribution.",
    "- Decide selected/suppressed status before drafting notification_message. Message shape follows the selected findings.",
    "- A repeated portfolio risk bucket can be selected when the current run materially changes the direction of the prior read, such as escalation risk shifting to easing risk premium.",
	    "- A direct held-asset anomaly is selected when it is new to the user, even if attribution remains weak or unexplained; use lower urgency and clearer uncertainty when sizing or attribution is limited.",
    "- A major macro, geopolitical, regulatory, war/peace, FOMC, CPI, jobs, sanctions, export-control, credit/liquidity, market-structure, or very large company event can be selected even without a clear surprise versus expectations, if it materially changes portfolio risk context.",
    "- Treat major rate-change or rate-expectation repricing as highly important portfolio-level information. If a rate hike, rate cut, Fed path, or market-implied probability change is material and relevant to current holdings, avoid suppressing it merely because it is broad macro or not tied to one company.",
    "- Source records may be new, updated, or seen_before; seen_before is context, not an automatic decision.",
    "- For known upcoming catalysts, avoid hourly repeats. One setup alert is enough unless timing is now closer, expectations changed, positioning/price/volume changed, or new evidence changes what the investor should watch.",
    "- For external_breaking_news records, the standalone Breaking News feed has already handled market-wide discovery, source expansion, source confidence, and event clustering. Treat reportedAt/sourceEventTime as the feed's event time, observedAt as when that feed first created the event, and updatedAt as when it last merged new evidence. Your job is portfolio materiality and notification judgment, not re-discovering the news.",
    "- For indexed-X breaking_news records, publishedAtMs/sourceTimeLabel should reflect the X post freshness when Pi returned it, while metadata.sourceEventTime/sourceEventAtMs is the original/official or earliest credible source time. Compare them; if the X post is fresh but sourceEventTime is old, treat it as resurfaced/newly discussed unless there is clear new information or new market reaction.",
	    "- Do not push routine price-target noise, broad market color with no portfolio implication, semantically wrong/stale event candidates, or weak-correlation event narratives that are not backed by a current held-asset anomaly.",
	    "",
	    "5. Data contract",
	    "- Dynamic mode reads one or more connected portfolio snapshots each run and aggregates holdings/cash before this analyst step. Static mode reads the configured static portfolio file each run; holdings stay unchanged until setup/update writes a new file.",
	    "- When any dynamic source account has holdingCount=0, portfolio coverage is degraded. Analyze the loaded holdings, but scope any weight, bps drag, NAV, cash, totalValue, or exposure number as the loaded snapshot rather than the full aggregate; omit the number if that wording would be awkward. If you send a push during degraded coverage, include one concise coverage note.",
	    "- full_quantity portfolios can use position quantity, Arrays latest 1min price, cash, weights, NAV deltas, and exposure percentages when coverage exists. ticker_only portfolios can use held tickers, themes, price/volume anomalies, event mapping, and related-holding logic, but must not invent weights, market value, NAV, or exposure percentages.",
	    "- Broker/source currentPrice, marketValue, cost basis, realized P&L, and unrealized P&L are intentionally omitted. Valuation uses source quantity times Arrays latest 1min price when full_quantity is available, plus source cash when supplied.",
	    "- Breaking-news source mode may read an external Breaking News feed instead of running Portfolio Watch's own market-wide news discovery. In external mode, relatedHoldings/affectedSymbols are produced by a code pre-map plus a Pi portfolio mapping review before this analyst step.",
    "- oneDayPct/currentMovePct use latest 1min extended-hours price versus previous regular-session close when available. lastClosedOneDayPct is completed-close context only.",
    "- Volume anomaly uses hourly cumulative volume versus historical same-time cumulative volume. US-listed equities/ETFs, including crypto-related equities, use the US regular-session volume day capped at 16:00 ET after hours; direct crypto assets use UTC-day volume.",
    "- anomaly_attribution_packets are agent analysis packets, not final findings. Convert them into anomalyAttributionFindings and decide selected/suppressed at the final decision layer.",
    "- If submitted derived fields look inconsistent, recompute from base fields where possible; otherwise lower confidence and add data_quality_notes.",
    "",
    "6. Notification writing style",
    "- notification_message is user-facing. Private decision fields may mention push/no_push, selected, suppressed, candidates, qualification, or why this run is worth interrupting; notification_message should not.",
    "- Focus on what the investor needs to know now, not why the automation decided to send a notification.",
    "- Choose the message shape based on the selected findings.",
	    "- For one selected finding, write 2-3 short sentences as a compact PM note. Cover what happened, why it matters, portfolio impact when material, and one watchpoint or invalidation. Target 250-450 characters.",
    "- For multiple selected findings, use real newlines and '- ' bullets. Use one bullet per selected event_impact or anomaly_attribution finding. Each bullet should be self-contained: event/anomaly, insight, portfolio relevance, thesis/risk read, watchpoint, and one source link when the selected finding has a source URL, supporting_events[].url, or sourceLinks[].",
    "- Use an opening line when it adds synthesis or transition: updating a prior alert, summarizing multiple selected findings, or naming a portfolio-level risk-direction shift. Keep it short and transition-only; reserve detailed numbers and links for the finding text.",
    "- Write like a real portfolio analyst sending a concise note after checking the book. Vary tone based on the situation: sometimes direct, sometimes cautious, sometimes slightly conversational, but it should not feel like a fixed template.",
    "- Use causal language such as behind, drove, explains, or because of only when the selected attribution is supported by first- or high-confidence second-order evidence. For broad thematic read-throughs, use context language and keep the event separate from the price-move attribution.",
    "- Use investor-facing language rather than internal workflow terms such as push, selected, candidate, qualified, cleanest item, clears the bar, interruption bar.",
    "- For each selected event_impact or anomaly_attribution finding with an available source URL, supporting_events[].url, or sourceLinks[], attach one inline Markdown link to the sourced fact or attribution. For anomaly_attribution, link the source that best supports the stated catalyst, attribution, or useful counterpoint. For a merged finding, link the source that best supports the main read; use a second link only when two independent facts are both central. Anchor text should be short and specific, preferably the publisher or source name. Never use generic anchor text such as source, link, article, here, click, or more.",
    "- Surface notable context when it changes the user's thesis, risk, watchpoint, or uncertainty. Place it inside the relevant compact note or finding bullet.",
    "- decision_lens is the structured decision object. notification_message should only surface the highest-signal thesis, risk, level, scenario, or watch-next item.",
    "- Give an opinionated but compliant PM read: whether thesis impact is strengthening, weakening, mixed, or unchanged; whether risk direction is rising, falling, mixed, or unchanged; the most relevant key level or invalidation point when available; and the next datapoint to watch.",
	    "- Mention exposure, tickers, and key move metrics only when they help the user understand importance.",
	    "- For ticker_only portfolios, say position size is unavailable when sizing matters; do not state percentage exposure, dollar exposure, NAV impact, or portfolio-weight contribution.",
    "- Sound like a sharp human analyst, not a news digest, template, or system log.",
    "- Keep compliance framing: no direct trade orders, exact sizing, or unconditional buy/sell instructions. Use review, monitor, reassess, confirmation, or invalidation language when useful. Do not treat price targets as your recommendation.",
    "",
    "7. Decision lens object",
    lens.enabled
      ? "- For every selected event_impact and anomaly_attribution finding, add a decision_lens object. Use null/empty arrays when a field is not applicable, but do not omit the object."
      : "- decision_lens is disabled; omit it.",
    "- decision_lens.thesis_impact must be one of positive, negative, mixed, neutral, unchanged, or unclear, with a short rationale.",
    "- decision_lens.risk_direction must be one of rising, falling, mixed, unchanged, or unclear, with the main risk bucket.",
    "- decision_lens.key_levels should include price/technical/catalyst levels only if supplied or confidently derivable from the packet; do not invent precise levels.",
    "- decision_lens.scenarios should be 2-4 concise if/then cases that frame upside, downside, and invalidation paths.",
    "- decision_lens.watch_next should list the next sources, catalysts, levels, or confirmations that would change the read.",
    explicitCalls
      ? "- decision_lens.action_read may contain a soft, compliant next-step framing for review, reassessment, hedge/risk-check, add-to-watch, or no_clear_action. Do not give direct orders or sizing."
      : "- decision_lens.action_read is optional. If included, default to no_clear_action unless the evidence clearly supports a compliant review/reassess/watch framing. Do not give direct orders or sizing.",
    "",
    "Return JSON only. It MUST begin with { and end with }.",
    "Schema:",
    "{",
    '  "eventCandidateStatuses": [',
    '    {"candidate_id":"", "status":"selected|suppressed|not_qualified", "reason":"", "linked_event_finding_id":""}',
    "  ],",
    '  "eventImpactFindings": [',
    '    {"finding_id":"", "finding_type":"event_impact", "primary_asset":"", "summary":"", "dedupe_key":"", "affected_holdings":[], "affected_buckets":[], "exposure_impact":{"direct_exposure_pct":null,"related_bucket_exposure_pct":null,"total_exposure_pct":null,"calculation":"","confidence":"low|medium|high"}, "position_impacts":[], "repetition_context":{"is_repeated_exposure":false,"new_information":"","matched_prior_alert":""}, "event_refs":[], "decision_lens":{"thesis_impact":{"direction":"positive|negative|mixed|neutral|unchanged|unclear","rationale":""},"risk_direction":{"direction":"rising|falling|mixed|unchanged|unclear","risk_bucket":"","rationale":""},"key_levels":[],"scenarios":[],"watch_next":[],"action_read":"no_clear_action|review_exposure|reassess_risk|watch_level|watch_catalyst|monitor_only"}, "data_quality_notes":[], "confidence":"low|medium|high"}',
    "  ],",
    '  "anomalyAttributionFindings": [',
    '    {"finding_id":"", "finding_type":"anomaly_attribution", "primary_asset":"", "summary":"", "dedupe_key":"", "attribution_packet_id":"", "anomaly_metrics":{}, "attribution_status":"confirmed|plausible|weak_correlation|unexplained", "supporting_events":[], "decision_lens":{"thesis_impact":{"direction":"positive|negative|mixed|neutral|unchanged|unclear","rationale":""},"risk_direction":{"direction":"rising|falling|mixed|unchanged|unclear","risk_bucket":"","rationale":""},"key_levels":[],"scenarios":[],"watch_next":[],"action_read":"no_clear_action|review_exposure|reassess_risk|watch_level|watch_catalyst|monitor_only"}, "data_quality_notes":[], "confidence":"low|medium|high"}',
    "  ],",
    '  "decision": {',
    '    "alert_decision":"push|no_push",',
    '    "urgency":"none|low|medium|high",',
    '    "reason":"",',
    '    "selected_event_impact_finding_ids":[],',
    '    "selected_anomaly_attribution_finding_ids":[],',
    '    "suppressed_finding_ids":[],',
    '    "suppression_reasons":{},',
    '    "message_sections":{"event_exposure_impacts":[],"anomaly_attributions":[]},',
    '    "notification_message":"",',
    '    "skip_reason":"",',
    '    "next_context_hints":[]',
    "  }",
    "}",
    "",
    "Run input JSON:",
    compactJson(input, CONFIG.maxAnalystPromptChars),
  ].join("\n");
}

function buildAnalystJsonRepairPrompt(rawText) {
  return [
    "The previous Portfolio Watch analyst response was intended to be JSON but was not parseable.",
    "Repair it into one valid JSON object. Preserve substantive content; do not add new facts, prices, links, holdings, or recommendations.",
    "Top-level keys must be eventCandidateStatuses, eventImpactFindings, anomalyAttributionFindings, and decision.",
    "Return JSON only. It MUST begin with { and end with }.",
    "",
    "Raw response:",
    cleanMultiline(rawText, 120000),
  ].join("\n");
}

function normalizeAnalyst(parsed, candidates, runAtMs) {
  parsed = normalizeEventTerminology(parsed);
  const candidateIdSet = {};
  (candidates || []).forEach((candidate) => {
    if (candidate && candidate.candidateId) candidateIdSet[candidate.candidateId] = true;
  });
  function normalizeEventCandidateStatusId(value) {
    const text = String(value || "");
    if (!text) return "";
    if (candidateIdSet[text]) return text;
    if (candidateIdSet["event:" + text]) return "event:" + text;
    return text;
  }
  const eventCandidateStatuses = Array.isArray(parsed && parsed.eventCandidateStatuses)
    ? parsed.eventCandidateStatuses.map((row) => ({
      candidateId: normalizeEventCandidateStatusId(row.candidate_id || row.candidateId || ""),
      status: String(row.status || "not_qualified").toLowerCase(),
      reason: clean(row.reason || "", 700),
      linkedEventFindingId: String(row.linked_event_finding_id || row.linkedEventFindingId || ""),
    })).filter((row) => row.candidateId)
    : [];
  const eventFindings = Array.isArray(parsed && parsed.eventImpactFindings) ? parsed.eventImpactFindings : [];
  const anomalyFindings = Array.isArray(parsed && parsed.anomalyAttributionFindings) ? parsed.anomalyAttributionFindings : [];
  const all = [];
  eventFindings.forEach((row, idx) => {
    const id = row.finding_id || "event-" + (idx + 1);
    all.push({
      findingId: id,
      findingType: "event_impact",
      primaryAsset: row.primary_asset || row.primaryAsset || "PORTFOLIO",
      summary: clean(row.summary || "", 800),
      dedupeKey: row.dedupe_key || findingDedupeKey(row, { findingType: "event_impact", summary: row.summary || "" }),
      payload: row,
      runAtMs,
    });
  });
  anomalyFindings.forEach((row, idx) => {
    const id = row.finding_id || "anomaly-" + (idx + 1);
    all.push({
      findingId: id,
      findingType: "anomaly_attribution",
      primaryAsset: row.primary_asset || row.primaryAsset || "PORTFOLIO",
      summary: clean(row.summary || "", 800),
      dedupeKey: row.dedupe_key || findingDedupeKey(row, { findingType: "anomaly_attribution", summary: row.summary || "" }),
      payload: row,
      runAtMs,
    });
  });
  const decision = parsed && parsed.decision ? parsed.decision : {};
  const selectedIds = []
    .concat(decision.selected_event_impact_finding_ids || [])
    .concat(decision.selected_anomaly_attribution_finding_ids || [])
    .map(String);
  const selectedSet = {};
  selectedIds.forEach((id) => { selectedSet[id] = true; });
  const suppression = decision.suppression_reasons || {};
  return {
    findings: all.map((finding) => ({
      ...finding,
      selected: selectedSet[finding.findingId] ? "true" : "false",
      suppressionReason: selectedSet[finding.findingId] ? "" : String(suppression[finding.findingId] || ""),
    })),
    eventCandidateStatuses,
    decision: {
      alertDecision: decision.alert_decision === "push" ? "push" : "no_push",
      urgency: decision.urgency || (decision.alert_decision === "push" ? "low" : "none"),
      reason: decision.reason || "",
      selectedFindingIds: selectedIds,
      suppressedFindingIds: (decision.suppressed_finding_ids || []).map(String),
      messageSections: decision.message_sections || {},
      notificationMessage: cleanMultiline(decision.notification_message || "", 1800),
      skipReason: decision.skip_reason || "",
      nextContextHints: Array.isArray(decision.next_context_hints) ? decision.next_context_hints : [],
    },
  };
}

function buildFallbackDecision(reason) {
  return {
    alertDecision: "no_push",
    urgency: "none",
    reason,
    selectedFindingIds: [],
    suppressedFindingIds: [],
    messageSections: {},
    notificationMessage: "",
    skipReason: reason,
    nextContextHints: [],
  };
}

function assessmentSelected(finding, decision) {
  const ids = decision && decision.selectedFindingIds ? decision.selectedFindingIds : [];
  return finding && (finding.selected === "true" || ids.indexOf(finding.findingId) >= 0);
}

function eventCandidateIdsForFinding(finding) {
  const payload = finding && finding.payload ? finding.payload : {};
  const ids = [];
  const explicit = payload.event_candidate_ids || payload.eventCandidateIds || payload.candidate_ids || payload.candidateIds || [];
  (Array.isArray(explicit) ? explicit : [explicit]).forEach((id) => {
    if (id) ids.push(String(id));
  });
  (payload.event_refs || payload.eventRefs || []).forEach((ref) => {
    if (!ref) return;
    const text = String(ref);
    ids.push(text.indexOf("event:") === 0 ? text : "event:" + text);
  });
  return ids;
}

function compactAssessmentForAudit(finding, decision) {
  const payload = finding && finding.payload ? finding.payload : {};
  const selected = assessmentSelected(finding, decision);
  return {
    findingId: finding.findingId,
    findingType: finding.findingType,
    primaryAsset: finding.primaryAsset,
    status: selected ? "selected" : "suppressed",
    selected,
    summary: finding.summary,
    dedupeKey: finding.dedupeKey,
    suppressionReason: selected ? "" : (finding.suppressionReason || ""),
    confidence: payload.confidence || "",
    exposureImpact: payload.exposure_impact || payload.exposureImpact || null,
    attributionStatus: payload.attribution_status || payload.attributionStatus || "",
    eventRefs: payload.event_refs || payload.eventRefs || [],
    supportingEvents: payload.supporting_events || payload.supportingEvents || [],
    decisionLens: payload.decision_lens || payload.decisionLens || null,
    dataQualityNotes: payload.data_quality_notes || payload.dataQualityNotes || [],
    payload,
  };
}

function buildLaneArtifacts(eventCandidates, anomalies, analyst, anomalyAttributionPackets) {
  analyst = analyst || { findings: [], decision: buildFallbackDecision("unknown") };
  const decision = analyst.decision || {};
  const eventFindings = (analyst.findings || []).filter((finding) => finding.findingType === "event_impact");
  const anomalyFindings = (analyst.findings || []).filter((finding) => finding.findingType === "anomaly_attribution");
  const packetByAnomalyId = {};
  const packetBySymbol = {};
  (anomalyAttributionPackets || []).forEach((packet) => {
    if (packet && packet.anomalyId) packetByAnomalyId[packet.anomalyId] = packet;
    if (packet && packet.symbol) packetBySymbol[String(packet.symbol || "").toUpperCase()] = packet;
  });
  const analystStatusByCandidate = {};
  (analyst.eventCandidateStatuses || []).forEach((row) => {
    if (row && row.candidateId) analystStatusByCandidate[row.candidateId] = row;
  });
  const promptCandidateIdSet = {};
  const hasPromptCandidateSet = Array.isArray(analyst.promptCandidateIds);
  (analyst.promptCandidateIds || []).forEach((candidateId) => {
    if (candidateId) promptCandidateIdSet[String(candidateId)] = true;
  });
  const finalEventStatusByCandidate = {};
  eventFindings.forEach((finding) => {
    const selected = assessmentSelected(finding, decision);
    eventCandidateIdsForFinding(finding).forEach((candidateId) => {
      finalEventStatusByCandidate[candidateId] = {
        candidateId,
        status: selected ? "selected" : "suppressed",
        reason: selected ? "Selected for notification." : (finding.suppressionReason || "Qualified by analyst but not selected for notification."),
        linkedEventFindingId: finding.findingId,
      };
    });
  });
  (eventCandidates || []).forEach((candidate) => {
    if (finalEventStatusByCandidate[candidate.candidateId]) return;
    const analystStatus = analystStatusByCandidate[candidate.candidateId];
    let analystStatusValue = "";
    let reason = "";
    if (analystStatus) {
      analystStatusValue = ((analystStatus.status === "selected" || analystStatus.status === "suppressed") && !analystStatus.linkedEventFindingId)
        ? "not_qualified"
        : analystStatus.status;
      reason = analystStatus.reason || "";
    } else if (hasPromptCandidateSet && !promptCandidateIdSet[candidate.candidateId]) {
      analystStatusValue = "not_reviewed_prompt_cap";
      reason = "Candidate was outside the analyst prompt cap, so it was preserved for audit but not treated as analyst-qualified.";
    } else {
      analystStatusValue = "not_reviewed_missing_status";
      reason = "Candidate was inside the analyst prompt but no analyst status was returned, so it was preserved for audit but not treated as analyst-qualified.";
    }
    finalEventStatusByCandidate[candidate.candidateId] = {
      candidateId: candidate.candidateId,
      status: analystStatusValue,
      reason,
      linkedEventFindingId: analystStatus ? analystStatus.linkedEventFindingId : "",
    };
  });
  const eventCandidateStatuses = (eventCandidates || []).map((candidate) => ({
    ...compactEventCandidateForAudit(candidate),
    finalStatus: finalEventStatusByCandidate[candidate.candidateId] || {
      candidateId: candidate.candidateId,
      status: "not_reviewed_missing_status",
      reason: "No analyst status returned.",
      linkedEventFindingId: "",
    },
  }));
  const compactEventFindings = eventFindings.map((finding) => compactAssessmentForAudit(finding, decision));
  const compactAnomalyFindings = anomalyFindings.map((finding) => compactAssessmentForAudit(finding, decision));
  const anomalyBySymbol = {};
  compactAnomalyFindings.forEach((finding) => {
    if (finding.primaryAsset) anomalyBySymbol[String(finding.primaryAsset).toUpperCase()] = finding;
  });
  const anomalyAttributions = (anomalies || []).map((anomaly) => {
    const symbol = String(anomaly.symbol || "").toUpperCase();
    const matched = anomalyBySymbol[symbol];
    const packet = packetByAnomalyId[anomaly.anomalyId] || packetBySymbol[symbol] || null;
    return {
      ...compactAnomalyForAudit(anomaly),
      attributionPacket: packet ? compactAnomalyAttributionPacketForAudit(packet) : null,
      finalStatus: matched
        ? {
          status: matched.status,
          reason: matched.selected ? "Selected for notification." : (matched.suppressionReason || "Attributed by analyst but not selected for notification."),
          linkedAttributionFindingId: matched.findingId,
        }
        : {
          status: "missing_attribution",
          reason: "Analyst did not return an anomaly attribution for this computed anomaly. The prompt contract expects one attribution per anomaly.",
          linkedAttributionFindingId: "",
        },
      attribution: matched || null,
    };
  });
  return {
    eventCandidates: eventCandidateStatuses,
    qualifiedEvents: compactEventFindings,
    selectedEvents: compactEventFindings.filter((row) => row.selected),
    anomalies: (anomalies || []).map(compactAnomalyForAudit),
    anomalyAttributions,
    selectedAnomalyAttributions: anomalyAttributions.filter((row) => row.finalStatus && row.finalStatus.status === "selected"),
    finalStatuses: {
      eventCandidates: eventCandidateStatuses.map((row) => ({
        candidateId: row.candidateId,
        symbol: row.symbol,
        title: row.title,
        status: row.finalStatus.status,
        reason: row.finalStatus.reason,
        linkedEventFindingId: row.finalStatus.linkedEventFindingId,
      })),
      anomalies: anomalyAttributions.map((row) => ({
        anomalyId: row.anomalyId,
        symbol: row.symbol,
        status: row.finalStatus.status,
        reason: row.finalStatus.reason,
        linkedAttributionFindingId: row.finalStatus.linkedAttributionFindingId,
      })),
    },
  };
}

function countBy(rows, field) {
  const out = {};
  (rows || []).forEach((row) => {
    const value = row && row[field] !== undefined && row[field] !== null && row[field] !== ""
      ? String(row[field])
      : "unknown";
    out[value] = (out[value] || 0) + 1;
  });
  return out;
}

function sumRecords(rows) {
  return (rows || []).reduce((acc, row) => acc + (Number(row.recordsAdded) || 0), 0);
}

function feedDataPath(group, doc, suffix) {
  const owner = ALFS_USERNAME || OWNER_USERNAME || "<ALVA_USERNAME>";
  return "/alva/home/" + owner + "/feeds/" + FEED_NAME + "/v1/data/" + group + "/" + doc + "/" + suffix;
}

function buildPersistDeltaRows(input) {
  const runAtMs = input.runAtMs;
  const snapshot = input.snapshot || {};
  const eventRecords = (input.normalizedEvent && input.normalizedEvent.records) || [];
  const findings = (input.analyst && input.analyst.findings) || [];
  const decision = input.analyst && input.analyst.decision ? input.analyst.decision : {};
  const alertEntry = input.alertEntry || {};
  const laneArtifacts = input.laneArtifacts || buildLaneArtifacts(input.eventCandidates || [], input.anomalies || [], input.analyst || {}, input.anomalyAttributionPackets || []);
  const eventStored = Math.min(eventRecords.length, 160);
  const kvKeys = [
    "lastSnapshot",
    "lastRunAtMs",
    "lastPriceSignals",
    "eventIndex",
    "alertHistory",
    "findingHistory",
    "lastDecision",
    "nextRunContext",
  ];
  const rows = [
    {
      fileKey: "portfolio.snapshot",
      fileLabel: "Portfolio Snapshot",
      storageType: "feed_timeseries",
      operation: "append",
      recordsAdded: 1,
      deltaSummary: "Added one run-level portfolio snapshot with Arrays-current valuation, portfolio delta, theme exposure, and warnings.",
	      delta: {
	        runSource: RUN_SOURCE,
	        portfolioMode: snapshot.portfolioMode,
	        positionCompleteness: snapshot.positionCompleteness,
	        runAtHkt: hkt(runAtMs),
        totalValue: snapshot.totalValue,
        cashAllocation: round(snapshot.cashAllocation, 4),
        priceBasis: snapshot.priceBasis,
        pricedHoldingCount: snapshot.pricedHoldingCount,
        unpricedHoldingCount: snapshot.unpricedHoldingCount,
	        topHoldings: (snapshot.holdings || []).slice(0, 8).map((h) => ({
	          symbol: h.symbol,
	          weight: canComputePortfolioSizing(snapshot) ? round(h.allocation, 4) : null,
	          positionSizeAvailable: canComputePortfolioSizing(snapshot),
	        })),
        portfolioDeltaSummary: input.delta ? input.delta.summary : "",
        warningCount: (input.warnings || []).length,
      },
      pointer: { path: feedDataPath("portfolio", "snapshot", "@last/50"), runAtMs },
    },
    {
      fileKey: "portfolio.positions",
      fileLabel: "Portfolio Positions",
      storageType: "feed_timeseries",
      operation: "append",
      recordsAdded: (snapshot.holdings || []).length,
      deltaSummary: "Added one normalized position row per current holding.",
	      delta: {
	        runSource: RUN_SOURCE,
	        portfolioMode: snapshot.portfolioMode,
	        positionCompleteness: snapshot.positionCompleteness,
	        symbols: (snapshot.holdings || []).map((h) => h.symbol),
        valuationBasis: snapshot.priceBasis,
        costAndPnlOmitted: true,
        unpricedHoldings: (input.warnings || []).filter((w) => String(w.source || "").indexOf("portfolio-mark:") === 0).map((w) => w.source),
      },
      pointer: { path: feedDataPath("portfolio", "positions", "@last/500"), runAtMs },
    },
    {
      fileKey: "event.items",
      fileLabel: "Event Items",
      storageType: "feed_timeseries",
      operation: eventStored ? "append" : "skip_empty",
      recordsAdded: eventStored,
      deltaSummary: eventStored
        ? "Added normalized source records fetched in this run, including dedupe status and metadata."
        : "No event rows were appended because the run produced zero normalized source records.",
      delta: {
        runSource: RUN_SOURCE,
        totalNormalizedEvents: eventRecords.length,
        storedRows: eventStored,
        dedupeStatusCounts: countBy(eventRecords, "dedupeStatus"),
        sourceTypeCounts: countBy(eventRecords, "sourceType"),
        sampleNewOrUpdated: eventRecords
          .filter((row) => row.dedupeStatus === "new" || row.dedupeStatus === "updated")
          .slice(0, 8)
          .map((row) => ({ symbol: row.symbol, sourceType: row.sourceType, title: row.title, eventKey: row.eventKey })),
      },
      pointer: { path: feedDataPath("event", "items", "@last/500"), runAtMs },
    },
    {
      fileKey: "finding.records",
      fileLabel: "Analyst Assessments",
      storageType: "feed_timeseries",
      operation: findings.length ? "append" : "skip_empty",
      recordsAdded: findings.length,
      deltaSummary: findings.length
        ? "Added analyst assessments, including selected/suppressed state and payload JSON."
        : "No assessment rows were appended because no analyst assessment survived or the analyst call was skipped.",
      delta: {
        runSource: RUN_SOURCE,
        findingCountsByType: countBy(findings, "findingType"),
        selectedFindingIds: decision.selectedFindingIds || [],
        suppressedFindingIds: decision.suppressedFindingIds || [],
        findings: findings.map((f) => ({
          findingId: f.findingId,
          findingType: f.findingType,
          primaryAsset: f.primaryAsset,
          selected: f.selected,
          suppressionReason: f.suppressionReason,
        })),
      },
      pointer: { path: feedDataPath("finding", "records", "@last/300"), runAtMs },
    },
    {
      fileKey: "analysis.decision",
      fileLabel: "Alert Decision",
      storageType: "feed_timeseries",
      operation: "append",
      recordsAdded: 1,
      deltaSummary: "Added the final push/no-push decision plus event/anomaly lane artifacts, current portfolio context, and the prior user-visible alert timeline.",
	      delta: {
	        runSource: RUN_SOURCE,
	        portfolioMode: snapshot.portfolioMode,
	        positionCompleteness: snapshot.positionCompleteness,
	        alertDecision: input.shouldPush ? "push" : "no_push",
        urgency: input.shouldPush ? decision.urgency : "none",
        reason: decision.reason || decision.skipReason || "",
        skipReason: input.shouldPush ? "" : (decision.skipReason || decision.reason || "quiet_run"),
        eventCandidateCount: (input.eventCandidates || []).length,
        qualifiedEventCount: laneArtifacts.qualifiedEvents.length,
        selectedEventCount: laneArtifacts.selectedEvents.length,
	        anomalyCount: (input.anomalies || []).length,
	        anomalyAttributionCount: laneArtifacts.anomalyAttributions.length,
	        abnormalAssets: (input.priceSignals || []).filter((s) => s && s.abnormal).map((s) => s.symbol),
	        portfolioWatchPreferences: compactPortfolioWatchPreferencesForAudit(input.portfolioWatchPreferences || {}),
	      },
      pointer: { path: feedDataPath("analysis", "decision", "@last/50"), runAtMs },
    },
    {
      fileKey: "notify.message",
      fileLabel: "Notification Message",
      storageType: "feed_timeseries",
      operation: "append",
      recordsAdded: 1,
      deltaSummary: input.shouldPush
        ? "Added a Telegram-ready notification message."
        : "Added the quiet-run skip sentinel so the cron can complete without a user push.",
      delta: {
        runSource: RUN_SOURCE,
        title: input.notifyTitle,
        bodyPreview: clean(input.notifyBody === SKIP ? "SKIP_NOTIFICATION sentinel" : input.notifyBody, 800),
        shouldPush: input.shouldPush,
      },
      pointer: { path: feedDataPath("notify", "message", "@last/50"), runAtMs },
    },
    {
      fileKey: "kv_state",
      fileLabel: "Feed KV State",
      storageType: "feed_kv",
      operation: "put",
      recordsAdded: kvKeys.length,
      deltaSummary: "Updated rolling state used by the next run: last snapshot, last run time, price signals, event index, user-visible alert timeline, finding history, last decision, and next-run context.",
      delta: {
        runSource: RUN_SOURCE,
        keysUpdated: kvKeys,
        alertHistorySizeAfterPut: input.alertHistorySize,
        findingHistorySizeAfterPut: input.findingHistorySize,
        lastDecision: alertEntry,
      },
      pointer: {
        path: "/alva/home/" + (ALFS_USERNAME || OWNER_USERNAME || "<ALVA_USERNAME>") + "/feeds/" + FEED_NAME + "/v1/kv/",
        keys: kvKeys,
      },
    },
  ];
  const auditRowsPlanned = rows.length + 2;
	  rows.push({
    fileKey: "audit.run_log",
    fileLabel: "Run Audit Log",
    storageType: "feed_timeseries",
    operation: "append",
    recordsAdded: 1,
    deltaSummary: "Added one replayable step log for this automation run.",
	    delta: { runSource: RUN_SOURCE, portfolioMode: snapshot.portfolioMode, positionCompleteness: snapshot.positionCompleteness, status: "completed", runAtHkt: hkt(runAtMs) },
    pointer: { path: feedDataPath("audit", "run_log", "@last/50"), runAtMs },
  });
  rows.push({
    fileKey: "audit.persist_delta",
    fileLabel: "Persist Delta",
    storageType: "feed_timeseries",
    operation: "append",
    recordsAdded: auditRowsPlanned,
    deltaSummary: "Added per-file delta rows for this run, including this audit file's own append.",
	    delta: { runSource: RUN_SOURCE, portfolioMode: snapshot.portfolioMode, positionCompleteness: snapshot.positionCompleteness, trackedFileCount: auditRowsPlanned },
    pointer: { path: feedDataPath("audit", "persist_delta", "@last/500"), runAtMs },
	  });
		  return rows.map((row) => ({
		    date: runAtMs,
		    accountId: snapshotAccountId(snapshot),
		    portfolioMode: snapshot.portfolioMode,
	    positionCompleteness: snapshot.positionCompleteness,
	    runSource: RUN_SOURCE,
    fileKey: row.fileKey,
    fileLabel: row.fileLabel,
    storageType: row.storageType,
    operation: row.operation,
    recordsAdded: row.recordsAdded,
    deltaSummary: row.deltaSummary,
    deltaJson: compactJson(row.delta, 16000),
    latestPointerJson: compactJson(row.pointer, 4000),
    runAtMs,
  }));
}

function buildRunAudit(input) {
  const snapshot = input.snapshot || {};
  const delta = input.delta || {};
  const rawEvents = input.rawEvents || input.rawEvent || [];
  const normalizedEvent = input.normalizedEvent || { records: [] };
  const eventRecords = normalizedEvent.records || [];
  const priceSignals = input.priceSignals || [];
  const eventCandidates = input.eventCandidates || [];
  const anomalies = input.anomalies || [];
  const candidates = input.candidates || eventCandidates.concat(anomalies.map(anomalyAsLegacyCandidate));
  const analyst = input.analyst || { findings: [], decision: buildFallbackDecision("unknown") };
  const decision = analyst.decision || {};
	  const laneArtifacts = input.laneArtifacts || buildLaneArtifacts(eventCandidates, anomalies, analyst, input.anomalyAttributionPackets || []);
	  const portfolioWatchPreferences = compactPortfolioWatchPreferencesForAudit(input.portfolioWatchPreferences || {});
	  const abnormalSignals = priceSignals
    .filter((signal) => signal && signal.abnormal)
    .map((signal) => ({
      symbol: signal.symbol,
      triggerKinds: signal.triggerKinds || [],
      reasons: signal.reasons || [],
      oneDayPct: signal.oneDayPct,
      fiveDayPct: signal.fiveDayPct,
      cumulativeVolumeMultiple: signal.cumulativeVolumeMultiple,
      currentCumulativeVolume: signal.currentCumulativeVolume,
      cumulativeVolumeMedian: signal.cumulativeVolumeMedian,
      sessionCumulativeRvol: signal.sessionCumulativeRvol,
      oneDayBasis: signal.oneDayBasis,
      latestPriceSource: signal.latestPriceSource,
      latestPriceInterval: signal.latestPriceInterval,
    }));
  const selectedFindings = (analyst.findings || []).filter((finding) => decision.selectedFindingIds && decision.selectedFindingIds.indexOf(finding.findingId) >= 0);
  const sourceCounts = countBy(rawEvents, "sourceType");
  const rawEventOriginCounts = countBy(rawEvents.map((row) => ({ sourceOrigin: sourceOriginFromEvent(row) })), "sourceOrigin");
  const eventStatusCounts = countBy(eventRecords, "dedupeStatus");
  const candidateLaneCounts = countBy(candidates, "lane");
  const candidateTypeCounts = countBy(candidates, "candidateType");
  const auditArtifacts = buildAuditArtifacts(eventCandidates, abnormalSignals, anomalies);
  const searchExpansionTrace = input.searchExpansionTrace || buildSearchExpansionTrace(input.breakingNewsSummary || {});
  const dataFetchSummary = {
    runSource: RUN_SOURCE,
    windowStartHkt: hkt(input.fetchStartMs),
    windowEndHkt: hkt(input.runAtMs),
    marketDataCoverage: input.marketDataCoverage || [],
    themeExtractionSummary: input.themeExtractionSummary || {},
    breakingNewsSummary: input.breakingNewsSummary || {},
    rateRepricingSummary: input.rateRepricingSummary || {},
    themeNewsSummary: input.themeNewsSummary || {},
    rawEventCount: rawEvents.length,
    rawEventSourceCounts: sourceCounts,
    rawEventSourceOriginCounts: rawEventOriginCounts,
    normalizedEventCount: eventRecords.length,
    normalizedEventDedupeCounts: eventStatusCounts,
    macroKeys: Object.keys(input.macro || {}).filter((key) => key !== "_meta"),
	    macroFreshness: macroFreshnessSummary(input.macro || {}),
	    searchExpansionTrace,
	    portfolioWatchPreferences,
	    warningCount: (input.warnings || []).length,
	  };
	  const llmDecision = {
	    portfolioReader: {
	      environment: "Code",
		      call: CONFIG.portfolioMode === "dynamic" ? "fetchPortfolioSummary(accountId) for each configured account id, then aggregate connected snapshots" : "alfs.readFile(staticPortfolioPath)",
	      toolLoop: false,
	      browsing: false,
	      contract: "Dynamic mode reads one or more connected portfolio snapshots each run and aggregates them before analysis. Static mode reads the configured static portfolio file each run. No LLM portfolio interpretation.",
		      output: {
		        accountId: snapshotAccountId(snapshot),
		        accountIds: snapshot.accountIds || [],
		        sourceAccountCount: (snapshot.sourceAccounts || []).length,
		        portfolioMode: snapshot.portfolioMode,
	        positionCompleteness: snapshot.positionCompleteness,
	        portfolioCapabilities: snapshot.portfolioCapabilities,
	        holdingCount: snapshot.holdingCount,
	        asOfHkt: hkt(snapshot.asOfMs),
	        topHoldings: (snapshot.holdings || []).slice(0, 8).map((h) => ({
	          symbol: h.symbol,
	          weight: canComputePortfolioSizing(snapshot) ? round(h.allocation, 4) : null,
	          positionSizeAvailable: canComputePortfolioSizing(snapshot),
	        })),
	      },
	    },
    themeExtractor: {
      environment: input.themeExtractionSummary ? (input.themeExtractionSummary.environment || "Pi Agent") : "not_called",
      call: input.themeExtractionSummary && input.themeExtractionSummary.call ? input.themeExtractionSummary.call : "skipped",
      toolLoop: false,
      browsing: false,
      suppliedJsonOnly: true,
      version: input.themeExtractionSummary ? input.themeExtractionSummary.version : "",
      holdingCount: input.themeExtractionSummary ? input.themeExtractionSummary.holdingCount : 0,
      themeCount: input.themeExtractionSummary ? input.themeExtractionSummary.themeCount : 0,
      fallbackUsed: input.themeExtractionSummary ? !!input.themeExtractionSummary.fallbackUsed : false,
      model: input.themeExtractionSummary ? input.themeExtractionSummary.model || "" : "",
      stopReason: input.themeExtractionSummary ? input.themeExtractionSummary.stopReason || "" : "",
      error: input.themeExtractionSummary ? input.themeExtractionSummary.error : "",
      rawTextPreview: input.themeExtractionSummary ? input.themeExtractionSummary.rawTextPreview : "",
    },
    analyst: {
      environment: input.analystCallMode === "alva_ask" ? "Alva Ask (LLM)" : "not_called",
      call: input.analystCallMode === "alva_ask" ? "ask(buildAnalystPrompt(analystInput))" : "skipped",
      skipReason: input.analystCallMode === "alva_ask" ? "" : (decision.skipReason || decision.reason || ""),
      toolLoop: false,
      browsing: false,
	      promptContract: input.analystPromptSummary || {},
	      promptCoverage: input.analystPromptCoverage || {},
	      portfolioWatchPreferences,
	      parsedDecision: decision,
      selectedFindings: selectedFindings.map((f) => ({ findingId: f.findingId, type: f.findingType, primaryAsset: f.primaryAsset, summary: f.summary })),
      eventCandidateStatuses: laneArtifacts.finalStatuses.eventCandidates,
      anomalyStatuses: laneArtifacts.finalStatuses.anomalies,
      rawAnalystJson: input.rawAnalystJson || "",
    },
    anomalyAttributionAgents: {
      environment: (input.anomalyAttributionPackets || []).length ? "Alva Ask (LLM)" : "not_called",
      call: (input.anomalyAttributionPackets || []).length ? "ask(buildAnomalyAttributionPrompt(anomalyInput)) once per computed asset anomaly" : "skipped",
      toolLoop: "alva_ask_managed_if_needed",
      browsing: "alva_ask_managed_if_needed",
      skillhubSkill: "carl-2/discord-why-the-move",
      version: CONFIG.anomalyAttributionVersion,
      promptContextCharCap: CONFIG.maxAnomalyAttributionPromptChars,
      packetCount: (input.anomalyAttributionPackets || []).length,
      packets: (input.anomalyAttributionPackets || []).map(compactAnomalyAttributionPacketForAudit),
    },
    breakingNews: {
      environment: input.breakingNewsSummary && input.breakingNewsSummary.sourceMode === "external_feed"
        ? "Alva feed read + Pi portfolio mapping review"
        : (input.breakingNewsSummary && input.breakingNewsSummary.agentCalled ? "Pi Agent" : "not_called_or_failed"),
      call: input.breakingNewsSummary && input.breakingNewsSummary.sourceMode === "external_feed"
        ? "alfs.readFile(external Breaking News events/current range) + agent.ask(buildExternalBreakingMappingPrompt(...))"
        : (input.breakingNewsSummary && input.breakingNewsSummary.agentCalled
          ? "agent.ask(buildBreakingNewsPrompt(...))"
          : "skipped_or_failed"),
      toolLoop: input.breakingNewsSummary && input.breakingNewsSummary.sourceMode === "external_feed" ? "mapping_review_only" : true,
      browsing: input.breakingNewsSummary && input.breakingNewsSummary.sourceMode === "external_feed" ? false : true,
	      tools: (input.breakingNewsSummary && input.breakingNewsSummary.tools) || [],
	      queries: (input.breakingNewsSummary && input.breakingNewsSummary.queries) || [],
	      queryPlanning: (input.breakingNewsSummary && input.breakingNewsSummary.queryPlanning) || "",
	      sourceMode: input.breakingNewsSummary ? input.breakingNewsSummary.sourceMode || "internal_pi" : "",
	      externalFeedPath: input.breakingNewsSummary ? input.breakingNewsSummary.feedReadPath || "" : "",
	      externalRowsRead: input.breakingNewsSummary ? input.breakingNewsSummary.externalRowsRead || 0 : 0,
	      deterministicMappedEventCount: input.breakingNewsSummary ? input.breakingNewsSummary.deterministicMappedEventCount || 0 : 0,
	      piReviewedEventCount: input.breakingNewsSummary ? input.breakingNewsSummary.piReviewedEventCount || 0 : 0,
	      holdingContextCount: input.breakingNewsSummary ? input.breakingNewsSummary.holdingContextCount : 0,
	      themeContextCount: input.breakingNewsSummary ? input.breakingNewsSummary.themeContextCount : 0,
	      promptContextCharCap: CONFIG.maxPiPromptContextChars,
	      toolCalls: (input.breakingNewsSummary && input.breakingNewsSummary.toolCalls) || [],
      parsedEventCount: input.breakingNewsSummary ? input.breakingNewsSummary.parsedEventCount : 0,
      rawEventRecords: input.breakingNewsSummary ? input.breakingNewsSummary.rawEventRecords : 0,
      error: input.breakingNewsSummary ? input.breakingNewsSummary.error : "",
    },
    rateRepricing: {
      environment: input.rateRepricingSummary && input.rateRepricingSummary.enabled ? "Code + Polymarket + Brave" : "disabled",
      call: input.rateRepricingSummary && input.rateRepricingSummary.enabled
        ? "fetchRateRepricingEvents(runAtMs)"
        : "skipped",
      toolLoop: false,
      browsing: true,
      source: input.rateRepricingSummary ? input.rateRepricingSummary.source : "",
      lookbackHours: input.rateRepricingSummary ? input.rateRepricingSummary.lookbackHours : RATE_REPRICING_LOOKBACK_HOURS,
      decisionMarketCount: input.rateRepricingSummary ? input.rateRepricingSummary.decisionMarketCount : RATE_REPRICING_DECISION_COUNT,
      probabilityChangeThresholdPct: input.rateRepricingSummary ? input.rateRepricingSummary.probabilityChangeThresholdPct : CONFIG.rateRepricingEvents.probabilityChangeThresholdPct,
      checkedMarkets: input.rateRepricingSummary ? input.rateRepricingSummary.checkedMarkets : 0,
      materialMoveCount: input.rateRepricingSummary ? input.rateRepricingSummary.materialMoveCount : 0,
      computedEventCount: input.rateRepricingSummary ? input.rateRepricingSummary.computedEventCount : 0,
      newsEventCount: input.rateRepricingSummary ? input.rateRepricingSummary.newsEventCount : 0,
      marketRows: input.rateRepricingSummary ? input.rateRepricingSummary.marketRows : [],
      error: input.rateRepricingSummary ? input.rateRepricingSummary.error : "",
    },
    themeNews: {
	      environment: input.themeNewsSummary && input.themeNewsSummary.agentCalled ? "Pi Agent" : "not_called_or_failed",
	      call: input.themeNewsSummary && input.themeNewsSummary.agentCalled
	        ? "agent.ask(buildBreakingNewsPrompt(...)) with theme-topic mapping and searchArraysMarketNewsTopic tool calls inside Pi"
	        : "skipped_or_failed",
      toolLoop: true,
      browsing: true,
      tools: (input.themeNewsSummary && input.themeNewsSummary.tools) || ["searchBrave"],
      queries: (input.themeNewsSummary && input.themeNewsSummary.queries) || [],
      themeTopicMappings: (input.themeNewsSummary && input.themeNewsSummary.themeTopicMappings) || [],
      topicNewsCalls: (input.themeNewsSummary && input.themeNewsSummary.topicNewsCalls) || [],
      topicNewsRecords: input.themeNewsSummary ? input.themeNewsSummary.topicNewsRecords : 0,
	      queryPlanning: (input.themeNewsSummary && input.themeNewsSummary.queryPlanning) || "",
	      holdingContextCount: input.themeNewsSummary ? input.themeNewsSummary.holdingContextCount : 0,
	      themeContextCount: input.themeNewsSummary ? input.themeNewsSummary.themeContextCount : 0,
	      promptContextCharCap: CONFIG.maxPiPromptContextChars,
      toolCalls: (input.themeNewsSummary && input.themeNewsSummary.toolCalls) || [],
      rawEventRecords: input.themeNewsSummary ? input.themeNewsSummary.rawEventRecords : 0,
      error: input.themeNewsSummary ? input.themeNewsSummary.error : "",
    },
  };
  const outputSummary = {
    runSource: RUN_SOURCE,
    alertDecision: input.shouldPush ? "push" : "no_push",
    urgency: input.shouldPush ? decision.urgency : "none",
    skipReason: input.shouldPush ? "" : (decision.skipReason || decision.reason || "quiet_run"),
    notificationTitle: input.notifyTitle,
    notificationPreview: clean(input.notifyBody === SKIP ? "SKIP_NOTIFICATION sentinel" : input.notifyBody, 1200),
    portfolioRows: 1,
    positionRows: (snapshot.holdings || []).length,
    eventRows: Math.min(eventRecords.length, 160),
    findingRows: (analyst.findings || []).length,
    eventCandidateCount: eventCandidates.length,
    qualifiedEventCount: laneArtifacts.qualifiedEvents.length,
    selectedEventCount: laneArtifacts.selectedEvents.length,
    anomalyCount: anomalies.length,
    anomalyAttributionPacketCount: (input.anomalyAttributionPackets || []).length,
    anomalyAttributionCount: laneArtifacts.anomalyAttributions.length,
    abnormalSignals,
    candidateLaneCounts,
    candidateTypeCounts,
    candidateAuditCount: auditArtifacts.candidateAudit.candidateCount,
    anomalySignalCount: auditArtifacts.anomalySignals.signalCount,
  };
  const persistSummary = {
    trackedFiles: (input.persistRows || []).map((row) => ({
      fileKey: row.fileKey,
      operation: row.operation,
      recordsAdded: row.recordsAdded,
      summary: row.deltaSummary,
    })),
    totalRecordsAdded: sumRecords(input.persistRows || []),
  };
	  const stepLog = [
	    {
	      step: 1,
	      node: "Portfolio source read",
	      environment: "Code",
	      input: { portfolioMode: CONFIG.portfolioMode, accountId: ACCOUNT_ID || "", accountIds: ACCOUNT_IDS, staticPortfolioPath: resolveAlfsPath(CONFIG.staticPortfolioPath) || "", runSource: RUN_SOURCE },
	      action: CONFIG.portfolioMode === "dynamic"
	        ? "Call fetchPortfolioSummary(accountId) for each configured account id, then aggregate holdings/cash into one portfolio snapshot using GET /api/v1/portfolio/summary with X-Alva-Api-Key auth."
	        : "Read the configured static portfolio JSON from ALFS.",
		      output: {
		        accountId: snapshotAccountId(snapshot),
		        accountIds: snapshot.accountIds || [],
		        sourceAccounts: (snapshot.sourceAccounts || []).map((row) => ({
		          accountId: row.accountId || "",
		          holdingCount: row.holdingCount,
		          asOfHkt: hkt(row.asOfMs),
		        })),
		        portfolioMode: snapshot.portfolioMode,
		        positionCompleteness: snapshot.positionCompleteness,
		        holdingCount: snapshot.holdingCount,
		        snapshotAsOfHkt: hkt(snapshot.asOfMs),
		        cash: snapshot.cash,
		      },
		      gate: "Portfolio state comes from the configured setup source only; no Alva Ask, memory, watchlists, or prior-run portfolio reconstruction.",
	    },
	    {
	      step: 2,
	      node: "Validate portfolio payload",
	      environment: "Code",
	      input: { portfolioMode: CONFIG.portfolioMode, requiredShape: ["holdings[] or tickers[]"], positionCompleteness: snapshot.positionCompleteness },
		      action: "Require at least one usable holding across the configured portfolio input before any market-data or event work starts. full_quantity requires usable quantities; ticker_only requires tickers.",
		      output: { holdingCount: snapshot.holdingCount, snapshotAsOfHkt: hkt(snapshot.asOfMs), cash: snapshot.cash },
		      gate: "If all configured portfolio sources are missing or empty, the run fails instead of fabricating a portfolio. If one dynamic connected account returns empty while another has holdings, the run continues with an explicit coverage warning.",
	    },
	    {
	      step: 3,
	      node: "Normalize portfolio",
	      environment: "Code",
	      input: { rawHoldings: snapshot.holdingCount },
	      action: "Normalize symbols, side, quantity when available, currency, and option metadata. Drop source current price, market value, cost, realized P&L, and unrealized P&L before context or persistence.",
	      output: {
	        priceBasis: snapshot.priceBasis,
	        positionCompleteness: snapshot.positionCompleteness,
	        portfolioCapabilities: snapshot.portfolioCapabilities,
	        topHoldings: (snapshot.holdings || []).slice(0, 8).map((h) => ({
	          symbol: h.symbol,
	          weight: canComputePortfolioSizing(snapshot) ? round(h.allocation, 4) : null,
	          marketValue: canComputePortfolioSizing(snapshot) ? round(h.marketValue, 2) : null,
	          positionSizeAvailable: canComputePortfolioSizing(snapshot),
	        })),
	      },
	      gate: "full_quantity mode can later compute current market value, weights, NAV delta, and exposure percentages from Arrays prices; ticker_only mode keeps only ticker/theme/event context.",
	    },
    {
      step: 4,
      node: "Prior state load",
      environment: "Code",
      input: { kvKeys: ["lastSnapshot", "lastRunAtMs", "eventIndex", "alertHistory", "findingHistory", "lastPriceSignals"] },
      action: "Load previous run state from feed KV and tolerate missing/corrupt values with empty baselines. Sanitize alertHistory into a past-7-day user-visible run timeline: empty runs keep only time/no-push state, pushed runs keep the user-visible message.",
      output: {
        hasPreviousSnapshot: !!input.previous,
        previousRunAtHkt: hkt(input.previousRunAtMs),
        priorAlertTimelineRows: input.priorAlertHistorySize || 0,
        findingHistoryRows: input.priorFindingHistorySize || 0,
      },
      gate: "If previous snapshot schema is incompatible, suppress one-run portfolio delta baseline.",
    },
    {
      step: 5,
      node: "Market data and event fetch",
      environment: "Code + Pi Agent",
      input: { holdings: (snapshot.holdings || []).map((h) => h.symbol), windowStartHkt: hkt(input.fetchStartMs), windowEndHkt: hkt(input.runAtMs) },
	      action: "For each holding, fetch daily bars, latest 1min extended-hours bars, hourly bars, market news, price-target news, earnings calendar, and optional computed technical_event rows. After price marking and current-theme extraction, fetch timestamped macro context, check Polymarket-implied Fed decision probability changes for the next three meetings, then read the external Breaking News feed for already source-expanded market-wide events. Code pre-maps direct ticker, option-underlying, theme, and macro/risk-bucket relevance; a Pi portfolio mapping agent reviews those mappings and cross-checks remaining events for source-grounded related holdings before final analyst review.",
      output: dataFetchSummary,
      gate: "If every holding lacks usable daily-bar price coverage, fail the run. Partial coverage gaps continue with warnings; unpriced holdings are excluded from marked valuation and exposure until coverage exists.",
    },
    {
      step: 6,
      node: "Price mark and anomaly metrics",
      environment: "Code",
      input: { priceSignalVersion: CONFIG.priceSignalVersion, volumeSignalVersion: CONFIG.volumeSignalVersion },
	      action: "Mark equity positions to Arrays latest 1min price when available; compute total value from cash plus priced positions; compute price metrics and hourly cumulative-volume anomaly metrics. Then call Alva Ask once to extract current holding themes for this run before external Breaking News mapping review and analyst context.",
      output: {
        abnormalSignals,
        priceCoverageFailures: input.priceFailures,
        totalValue: snapshot.totalValue,
        pricedHoldingCount: snapshot.pricedHoldingCount,
        unpricedHoldingCount: snapshot.unpricedHoldingCount,
        themeExtraction: input.themeExtractionSummary || {},
      },
      gate: "oneDayPct/currentMovePct use latest 1min extended-hours price versus previous regular-session close when 1min data is newer. Hourly/daily are fallback only and are marked as fallback. Broker currentPrice, broker marketValue, cost, and P&L are never used. Theme extraction uses supplied portfolio JSON only every run; if it fails, code records a warning and falls back to the prior snapshot or fallback config for continuity.",
    },
    {
      step: 7,
      node: "Context update and event-candidate build",
      environment: "Code",
      input: { previousSnapshot: !!input.previous, rawEventCount: rawEvents.length },
      action: "Compute portfolio delta and dynamic theme exposure for analyst context, dedupe event records, and build event_candidates from all non-duplicate source records, including portfolio-level macro/policy/risk/rate-repricing events that do not name a specific holding. Broad external feed or macro/risk events remain one event object with affectedSymbols[] and affectedThemes[] instead of being duplicated per holding.",
      output: {
        portfolioDelta: delta,
        themeExposure: input.currentThemes || [],
        eventDedupeCounts: eventStatusCounts,
        eventCandidateCount: eventCandidates.length,
      },
      gate: "Portfolio delta and theme exposure are context only, not standalone candidates. Event candidate code only drops same-run duplicates; missing exact symbol mapping is not a code-level rejection. Semantic relevance, exposure impact, freshness, novelty, qualification, and materiality are analyst responsibilities.",
    },
    {
      step: 8,
      node: "Asset anomaly build",
      environment: "Code",
      input: { abnormalSignals },
      action: "Build one computed asset_anomaly object for each current holding with price or volume anomaly triggers. If price and volume both trigger for the same holding, they stay merged into this single asset-level anomaly. Anomalies are facts from market data, not event candidates.",
      output: {
        anomalyCount: anomalies.length,
        anomalySymbols: anomalies.map((anomaly) => anomaly.symbol),
      },
      gate: "This step does not attribute the move and does not suppress an anomaly after the trigger fires. It only prepares one anomaly object per held asset.",
    },
    {
      step: 9,
      node: "Per-asset anomaly attribution agents",
      environment: (input.anomalyAttributionPackets || []).length ? "Alva Ask (LLM)" : "Code",
      input: { anomalyCount: anomalies.length, anomalySymbols: anomalies.map((anomaly) => anomaly.symbol) },
      action: (input.anomalyAttributionPackets || []).length
        ? "For each computed asset anomaly, call a dedicated Alva Ask attribution agent with the anomaly metrics, related event context, macro context, portfolio context, and prior user-visible alert timeline. The prompt instructs the agent to use the Skill Hub why-the-move methodology when available."
        : "Skip attribution-agent calls because no computed asset anomalies exist.",
      output: {
        packetCount: (input.anomalyAttributionPackets || []).length,
        packets: (input.anomalyAttributionPackets || []).map((packet) => ({
          symbol: packet.symbol,
          attributionStatus: packet.attributionStatus,
          confidence: packet.confidence,
          agentStatus: packet.agentStatus,
        })),
      },
      gate: "These packets are attribution research outputs, not final push decisions. If an agent fails, the packet is preserved as agent_error and the final analyst still receives the anomaly.",
    },
    {
      step: 10,
      node: "Analyst decision",
      environment: input.analystCallMode === "alva_ask" ? "Alva Ask (LLM)" : "Code",
      input: input.analystPromptSummary || { reason: "LLM skipped" },
      action: input.analystCallMode === "alva_ask"
        ? "Call ask(buildAnalystPrompt(analystInput)) with event candidates, computed anomalies, and per-asset anomaly attribution packets; then parse the JSON decision."
        : "Use deterministic fallback decision because this run did not need an analyst call.",
      output: llmDecision.analyst,
      gate: "The analyst handles two separate flows: event candidates -> qualified events with exposure impact, and computed anomalies plus attribution packets -> final anomaly attributions. Selection/suppression is the final decision state, recorded in the final status ledger, not a separate event-lane stage. prior_alert_history is a past-7-day user-visible run timeline; empty runs are not suppressed reasoning. Portfolio delta/theme exposure are context only. Alva Ask may use available tools if it needs to verify stale or suspicious submitted data, and must return JSON only.",
    },
    {
      step: 11,
      node: "Persist and notify",
      environment: "Code",
      input: { selectedFindingIds: decision.selectedFindingIds || [] },
      action: "Append feed outputs, write KV state, and emit either Telegram message or skip sentinel. Code does not override the analyst push/no-push decision with a separate repeat filter after the analyst returns.",
      output: { outputSummary, persistSummary },
      gate: "Quiet runs still persist decision, notification sentinel, run audit log, and per-file persist deltas.",
    },
  ];
  return { stepLog, dataFetchSummary, llmDecision, outputSummary, persistSummary, auditArtifacts, laneArtifacts, searchExpansionTrace };
}

(async () => {
  const runAtMs = Date.now();
  const ingestWarnings = [];
  let snapshot = await ingestPortfolio(runAtMs, ingestWarnings);
  if (!snapshot.holdings.length) throw new Error("Portfolio ingest returned zero holdings");

  await feed.run(async (ctx) => {
    let previous = null;
    let previousRunAtMs = 0;
    let eventIndex = {};
    let alertHistory = [];
    let findingHistory = [];
    let previousPriceSignals = {};
    let analystCallMode = "skipped";
    let analystPromptSummary = {};

    try {
      const raw = await ctx.kv.load("lastSnapshot");
      previous = raw ? JSON.parse(raw) : null;
    } catch (_) {
      previous = null;
    }
    previousRunAtMs = Number(await ctx.kv.load("lastRunAtMs")) || 0;
    try {
      const eventIndexRaw = await ctx.kv.load("eventIndex");
      const legacyEventIndexRaw = eventIndexRaw ? "" : await ctx.kv.load(["evid", "enceIndex"].join(""));
      eventIndex = normalizeEventTerminology(JSON.parse(eventIndexRaw || legacyEventIndexRaw || "{}"));
    } catch (_) {
      eventIndex = {};
    }
    try {
      alertHistory = normalizeEventTerminology(JSON.parse((await ctx.kv.load("alertHistory")) || "[]"));
    } catch (_) {
      alertHistory = [];
    }
    alertHistory = sanitizeAlertTimeline(alertHistory, runAtMs);
    const priorAlertTimeline = priorAlertTimelineForAnalyst(alertHistory, runAtMs);
    try {
      findingHistory = normalizeEventTerminology(JSON.parse((await ctx.kv.load("findingHistory")) || "[]"));
    } catch (_) {
      findingHistory = [];
    }
    try {
      previousPriceSignals = JSON.parse((await ctx.kv.load("lastPriceSignals")) || "{}");
    } catch (_) {
      previousPriceSignals = {};
    }
    const priorAlertHistorySize = priorAlertTimeline.length;
    const priorFindingHistorySize = findingHistory.length;

	    const warnings = [];
	    warnings.push.apply(warnings, ingestWarnings);
	    if (snapshot.asOfMsEstimated) {
	      warnings.push({ source: "portfolio:asOfMs", error: "portfolio snapshot did not provide asOfMs; runAtMs used for audit only" });
		    } else if (Number.isFinite(snapshot.asOfMs)) {
		      const snapshotAgeHours = (runAtMs - snapshot.asOfMs) / 3600000;
		      if (snapshotAgeHours > CONFIG.portfolioSnapshotStaleWarningHours) {
		        warnings.push({
		          source: "portfolio:asOfMs",
		          error: "portfolio snapshot is " + round(snapshotAgeHours, 1) + "h old; configured holdings/cash may lag recent changes",
		        });
		      }
		    }
		    const portfolioWatchPreferences = await readPortfolioWatchPreferences(warnings);
    if (previous && previous.markVersion !== CONFIG.snapshotMarkVersion) {
      warnings.push({ source: "lastSnapshot", error: "previous snapshot schema migrated; suppressing one-run portfolio delta baseline" });
      previous = null;
    }
    const fetchStartMs = previousRunAtMs
      ? Math.min(runAtMs - CONFIG.defaultWindowMinutes * 60 * 1000, previousRunAtMs - CONFIG.eventOverlapMinutes * 60 * 1000)
      : runAtMs - CONFIG.firstRunWindowHours * 60 * 60 * 1000;
    const fetchStartSec = Math.floor(fetchStartMs / 1000);
    const fetchEndSec = Math.floor(runAtMs / 1000);

    const rawEvents = [];
    const marketDataCoverage = [];
    let priceSignals = [];
    let priceFailures = 0;
    for (const holding of snapshot.holdings) {
      const marketDataSymbol = marketDataSymbolForHolding(holding);
      const usesUnderlying = marketDataSymbol && marketDataSymbol !== holding.symbol;
      const marketDataBasis = usesUnderlying ? "underlying_equity" : "holding_symbol";
      const dailyBars = await fetchDailyBars(marketDataSymbol, warnings);
      const minuteBars = await fetchMinuteBars(marketDataSymbol, warnings);
      const hourlyBars = await fetchHourlyBars(marketDataSymbol, warnings);
      const lastDaily = dailyBars.length ? dailyBars[dailyBars.length - 1] : null;
      const lastMinute = minuteBars.length ? minuteBars[minuteBars.length - 1] : null;
      const lastHourly = hourlyBars.length ? hourlyBars[hourlyBars.length - 1] : null;
      marketDataCoverage.push({
        symbol: holding.symbol,
        marketDataSymbol,
        underlyingSymbol: usesUnderlying ? marketDataSymbol : "",
        marketDataBasis,
        dailyBars: dailyBars.length,
        minuteBars: minuteBars.length,
        hourlyBars: hourlyBars.length,
        latestDailyBarHkt: lastDaily ? hkt(barTimeSec(lastDaily) * 1000) : "n/a",
        latestMinuteBarHkt: lastMinute ? hkt(barTimeSec(lastMinute) * 1000) : "n/a",
        latestHourlyBarHkt: lastHourly ? hkt(barTimeSec(lastHourly) * 1000) : "n/a",
      });
      const priceSignal = analyzePrice(holding.symbol, holding, dailyBars, hourlyBars, minuteBars, hourlyBars, marketDataSymbol);
      if (!priceSignal.available) priceFailures += 1;
      priceSignals.push(priceSignal);
      rawEvents.push.apply(rawEvents, buildTechnicalEvents(holding, marketDataSymbol, dailyBars, hourlyBars, minuteBars, priceSignal, runAtMs));
      rawEvents.push.apply(rawEvents, await fetchNews(marketDataSymbol, fetchStartSec, fetchEndSec, warnings, holding.symbol));
      rawEvents.push.apply(rawEvents, await fetchPriceTargetNews(marketDataSymbol, fetchStartSec - 5 * 86400, fetchEndSec, warnings, holding.symbol));
      rawEvents.push.apply(rawEvents, await fetchEarnings(marketDataSymbol, fetchEndSec, warnings, holding.symbol));
    }
    if (priceFailures >= snapshot.holdings.length) {
      throw new Error("Price coverage blocker: all " + snapshot.holdings.length + " holdings lacked usable daily bars");
    }
    if (priceFailures > 0 && priceFailures / snapshot.holdings.length > 0.2) {
      warnings.push({
        source: "price-coverage",
        error: priceFailures + " of " + snapshot.holdings.length + " holdings lacked usable daily bars; continuing with covered holdings and excluding unpriced holdings from marked valuation/exposure",
      });
    }
    snapshot = markSnapshotToLatest(snapshot, priceSignals, warnings);
    priceSignals = refreshSignalContributions(priceSignals, snapshot);
    snapshot = await extractPortfolioThemes(snapshot, previous, warnings, runAtMs);
    const delta = computePortfolioDelta(snapshot, previous);
    const currentThemes = themeExposure(snapshot);
    const previousThemes = previous ? themeExposure(previous) : [];

    const macro = await fetchMacro(warnings);
    const rateRepricing = await fetchRateRepricingEvents(runAtMs, warnings);
    rawEvents.push.apply(rawEvents, rateRepricing.records);
    const breakingNews = await fetchBreakingNews(snapshot, currentThemes, fetchStartMs, runAtMs, warnings);
    rawEvents.push.apply(rawEvents, breakingNews.records);
    if (previous && !priceSignalSchemaCompatible(previousPriceSignals)) {
      warnings.push({ source: "lastPriceSignals", error: "previous asset anomaly signal schema migrated; suppressing one-run anomaly delta baseline" });
      previousPriceSignals = priceSignalMap(priceSignals);
    }
    const normalizedEvent = normalizeEvent(rawEvents, eventIndex, runAtMs);
    const eventCandidates = buildEventCandidates(snapshot, normalizedEvent.records);
    const anomalies = buildAnomalies(snapshot, priceSignals);
    const anomalyAttributionPackets = runAnomalyAttributionAgents(anomalies, {
      runAtMs,
      runAtHkt: hkt(runAtMs),
      snapshot,
      eventRecords: normalizedEvent.records,
      eventCandidates,
      macro,
      priorAlertHistory: priorAlertTimeline,
      warnings,
    });
    const candidates = eventCandidates.concat(anomalies.map(anomalyAsLegacyCandidate));
    const reviewItemCount = eventCandidates.length + anomalies.length;
    let analyst = { findings: [], decision: buildFallbackDecision("no_material_candidates") };
    let rawAnalystJson = "";
    let analystParseStatus = "not_called";
    let analystPromptCoverage = {
      totalEventCandidates: eventCandidates.length,
      promptEventCandidates: 0,
      outsidePromptCapEventCandidates: eventCandidates.length,
      maxPromptCandidates: CONFIG.maxPromptCandidates,
      sortPolicy: "stable_original_order_except_seen_before_after_non_seen_before",
	      promptCandidateIds: [],
	      portfolioWatchPreferences: compactPortfolioWatchPreferencesForAudit(portfolioWatchPreferences),
	    };
    if (!reviewItemCount) {
      analyst.decision = buildFallbackDecision("no event candidate or asset anomaly was built");
    } else {
      const analystEventCandidates = orderEventCandidatesForAnalystPrompt(eventCandidates).slice(0, CONFIG.maxPromptCandidates);
      const analystPromptCandidateIds = analystEventCandidates.map((candidate) => candidate && candidate.candidateId).filter(Boolean);
      analystPromptCoverage = {
        totalEventCandidates: eventCandidates.length,
        promptEventCandidates: analystEventCandidates.length,
        outsidePromptCapEventCandidates: Math.max(0, eventCandidates.length - analystEventCandidates.length),
        maxPromptCandidates: CONFIG.maxPromptCandidates,
        sortPolicy: "stable_original_order_except_seen_before_after_non_seen_before",
	        seenBeforePromptCandidates: analystEventCandidates.filter(candidateSeenBefore).length,
	        seenBeforeTotalEventCandidates: eventCandidates.filter(candidateSeenBefore).length,
	        promptCandidateIds: analystPromptCandidateIds,
	        portfolioWatchPreferences: compactPortfolioWatchPreferencesForAudit(portfolioWatchPreferences),
	      };
		      const analystInput = {
		        account_id: snapshotAccountId(snapshot),
		        account_ids: snapshot.accountIds || [],
		        portfolio_mode: snapshot.portfolioMode,
		        position_completeness: snapshot.positionCompleteness,
		        portfolio_capabilities: snapshot.portfolioCapabilities,
		        run_at_hkt: hkt(runAtMs),
		        portfolio_watch_preferences_note: portfolioWatchPreferences.text || "",
		        portfolio_watch_preferences_source: compactPortfolioWatchPreferencesForAudit(portfolioWatchPreferences),
	        event_candidates_to_review: analystEventCandidates.map(compactEventCandidateForAnalyst),
        event_candidate_prompt_coverage: {
          total_event_candidates: analystPromptCoverage.totalEventCandidates,
          prompt_event_candidates: analystPromptCoverage.promptEventCandidates,
          outside_prompt_cap_event_candidates: analystPromptCoverage.outsidePromptCapEventCandidates,
          max_prompt_candidates: CONFIG.maxPromptCandidates,
          sort_policy: analystPromptCoverage.sortPolicy,
        },
        asset_anomalies: anomalies,
        anomaly_attribution_packets: anomalyAttributionPackets.map(compactAnomalyAttributionPacketForAnalyst),
        asset_anomaly_metrics: priceSignals
          .filter((signal) => signal && (signal.abnormal || anomalies.some((anomaly) => anomaly.symbol === signal.symbol)))
          .map(compactPriceSignalForAnalyst),
        event_records: normalizedEvent.records
          .filter((item) => {
            if (item.dedupeStatus === "duplicate") return false;
            return eventCandidates.some((candidate) => (candidate.eventRefs || []).indexOf(item.eventKey) >= 0);
          })
          .slice(0, CONFIG.maxPromptEvents)
          .map(compactRawEventForAnalyst),
        prior_alert_history: priorAlertTimeline,
		        portfolio_snapshot: {
		          portfolioMode: snapshot.portfolioMode,
		          accountId: snapshotAccountId(snapshot),
		          accountIds: snapshot.accountIds || [],
		          sourceAccounts: (snapshot.sourceAccounts || []).map((row) => ({
		            accountId: row.accountId || "",
		            holdingCount: row.holdingCount,
		            cash: row.cash,
		            asOfHkt: hkt(row.asOfMs),
		          })),
		          sourceAccountCount: (snapshot.sourceAccounts || []).length,
		          sourceCoverageStatus: (snapshot.sourceAccounts || []).some((row) => Number(row.holdingCount) <= 0)
		            ? "degraded_source_account_empty"
		            : "loaded_sources_complete",
		          ingestSource: snapshot.ingestSource,
	          positionCompleteness: snapshot.positionCompleteness,
	          portfolioCapabilities: snapshot.portfolioCapabilities,
	          totalValue: snapshot.totalValue,
	          cash: snapshot.cash,
          cashAllocation: snapshot.cashAllocation,
          valuationBasis: snapshot.priceBasis,
          valuationPolicy: snapshot.valuationPolicy,
          pricedHoldingCount: snapshot.pricedHoldingCount,
          unpricedHoldingCount: snapshot.unpricedHoldingCount,
          brokerSnapshotAsOfHkt: hkt(snapshot.asOfMs),
          latestPriceAsOfHkt: hkt(snapshot.priceAsOfMs),
	          holdings: snapshot.holdings.map((h) => compactHoldingForAnalystInput(snapshot, h)),
	        },
	        portfolio_context: {
	          current_portfolio_delta: delta,
	          theme_exposure: currentThemes,
		          note: (snapshot.sourceAccounts || []).some((row) => Number(row.holdingCount) <= 0)
		            ? "Portfolio delta and theme exposure are context only. One or more dynamic source accounts returned zero holdings, so sizing/exposure numbers describe the loaded snapshot only, not the full aggregate."
		            : (canComputePortfolioSizing(snapshot)
		              ? "Portfolio delta and theme exposure are context only, not standalone candidates or required alert sections."
		              : "Portfolio delta and theme exposure are context only. Position sizing is unavailable, so do not state true exposure percentages, NAV impact, market value, or portfolio-weight contribution."),
        },
        macro_context: macro,
        coverage_warnings: warningItemsForAnalystInput(warnings),
      };
      analystCallMode = "alva_ask";
      analystPromptSummary = {
        promptName: "buildAnalystPrompt",
        environment: "Alva Ask (LLM)",
        toolLoop: "alva_ask_managed_if_needed",
        browsing: "alva_ask_managed_if_needed",
        suppliedJsonOnly: false,
		        requiredInputs: ["portfolio_mode", "position_completeness", "portfolio_capabilities", "prior_alert_history", "event_candidates_to_review", "asset_anomalies", "anomaly_attribution_packets", "asset_anomaly_metrics", "portfolio_context"],
		        optionalInputs: ["portfolio_watch_preferences_note"],
	        inputCounts: {
          eventCandidates: eventCandidates.length,
          eventCandidatesInPrompt: analystEventCandidates.length,
          eventCandidatesOutsidePromptCap: analystPromptCoverage.outsidePromptCapEventCandidates,
          seenBeforeEventCandidatesInPrompt: analystPromptCoverage.seenBeforePromptCandidates,
          assetAnomalies: anomalies.length,
          anomalyAttributionPackets: anomalyAttributionPackets.length,
          totalReviewItems: reviewItemCount,
          eventRecords: analystInput.event_records.length,
          priorAlertHistoryRows: analystInput.prior_alert_history.length,
	          rateRepricingComputedEvents: (rateRepricing.summary && rateRepricing.summary.computedEventCount) || 0,
	          rateRepricingNewsEvents: (rateRepricing.summary && rateRepricing.summary.newsEventCount) || 0,
	          portfolioWatchPreferencesLoaded: !!portfolioWatchPreferences.loaded,
	          portfolioWatchPreferencesChars: portfolioWatchPreferences.chars || 0,
	        },
	        caps: {
          eventRecords: CONFIG.maxPromptEvents,
          eventCandidates: CONFIG.maxPromptCandidates,
          eventCandidateSortPolicy: analystPromptCoverage.sortPolicy,
          analystPromptChars: CONFIG.maxAnalystPromptChars,
          anomalyAttributionPromptChars: CONFIG.maxAnomalyAttributionPromptChars,
	          timeouts: CONFIG.timeouts,
	          priorAlertTimelineDays: CONFIG.priorAlertTimelineDays,
	          priorAlertTimelineRows: CONFIG.maxPriorAlertTimelineRows,
	          portfolioWatchPreferencesChars: CONFIG.portfolioWatchPreferencesMaxChars,
	        },
        outputSchema: ["eventCandidateStatuses[]", "eventImpactFindings[] with exposure_impact and decision_lens", "anomalyAttributionFindings[] with decision_lens", "decision.message_sections.event_exposure_impacts/anomaly_attributions", "decision.notification_message as chat-readable PM note"],
      };
      const analystText = String(ask(buildAnalystPrompt(analystInput), { timeoutMs: CONFIG.timeouts.analystMs }).text || "");
      let parsedAnalyst = parseJsonLenient(analystText);
      analystParseStatus = parsedAnalyst ? "parsed_initial" : "initial_parse_failed";
      if (!parsedAnalyst) {
        warnings.push({ source: "analyst-json-parse", error: "Initial analyst response was not parseable JSON; attempting JSON repair.", rawTextPreview: cleanMultiline(analystText, 1200) });
        try {
          const repairText = String(ask(buildAnalystJsonRepairPrompt(analystText), { timeoutMs: CONFIG.timeouts.analystRepairMs }).text || "");
          parsedAnalyst = parseJsonLenient(repairText);
          analystParseStatus = parsedAnalyst ? "repaired" : "repair_parse_failed";
          if (!parsedAnalyst) warnings.push({ source: "analyst-json-repair", error: "Analyst JSON repair response was still not parseable.", rawTextPreview: cleanMultiline(repairText, 1200) });
        } catch (err) {
          analystParseStatus = "repair_error";
          warnings.push({ source: "analyst-json-repair", error: String(err && err.message ? err.message : err).slice(0, 260) });
        }
      }
      if (parsedAnalyst) {
        const parsedAnalystClean = normalizeEventTerminology(parsedAnalyst);
        parsedAnalystClean._parse_status = analystParseStatus;
        rawAnalystJson = compactJson(parsedAnalystClean, 60000);
        analyst = normalizeAnalyst(parsedAnalystClean, candidates, runAtMs);
      } else {
        const reason = "analyst_parse_error: final analyst output was not parseable JSON";
        rawAnalystJson = compactJson({ _parse_status: analystParseStatus, error: reason, rawTextPreview: cleanMultiline(analystText, 6000) }, 12000);
        analyst = { findings: [], decision: buildFallbackDecision(reason), eventCandidateStatuses: [] };
        warnings.push({ source: "analyst-json-parse", error: reason });
      }
      analyst.promptCandidateIds = analystPromptCandidateIds;
      analystPromptCoverage.analystParseStatus = analystParseStatus;
    }

    const selectedFindings = analyst.findings.filter((f) => analyst.decision.selectedFindingIds.indexOf(f.findingId) >= 0);
    const laneArtifacts = buildLaneArtifacts(eventCandidates, anomalies, analyst, anomalyAttributionPackets);

    function enforceChatReadableBullets(text) {
      return String(text || "")
        .replace(/[ \t]+/g, " ")
        .replace(/\s+-\s+(?=[A-Za-z0-9$][^\n:]{0,42}:\s)/g, "\n- ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    function capMarkdownLinkAnchors(text, maxLen) {
      return String(text || "").replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label, url) => {
        const cleanLabel = String(label || "").replace(/\s+/g, " ").trim();
        if (!cleanLabel) return "[link](" + url + ")";
        const capped = cleanLabel.length > maxLen ? cleanLabel.slice(0, Math.max(1, maxLen - 3)).trim() + "..." : cleanLabel;
        return "[" + capped + "](" + url + ")";
      });
    }
	    const shouldPush = analyst.decision.alertDecision === "push" && analyst.decision.notificationMessage && selectedFindings.length > 0;
	    const pmNotificationMessage = shouldPush ? capMarkdownLinkAnchors(enforceChatReadableBullets(analyst.decision.notificationMessage), 60) : "";
	    const notifyBody = shouldPush ? pmNotificationMessage : SKIP;
	    const notifyTitle = shouldPush ? "Portfolio Watch" : "Portfolio Watch Quiet";

	    await ctx.self.ts("portfolio", "snapshot").append([{
	      date: runAtMs,
	      accountId: snapshotAccountId(snapshot),
	      portfolioMode: snapshot.portfolioMode,
	      positionCompleteness: snapshot.positionCompleteness,
	      ingestSource: snapshot.ingestSource,
	      totalValue: snapshot.totalValue,
      cash: snapshot.cash,
      cashAllocation: snapshot.cashAllocation,
      holdingCount: snapshot.holdingCount,
	      topHoldings: topHoldingsSummary(snapshot, 8),
      portfolioDeltaJson: compactJson(delta, 12000),
      themeExposureJson: compactJson(currentThemes, 8000),
      coverageWarningsJson: compactJson(warnings, 8000),
      rawJson: compactJson(snapshot, 24000),
      asOfMs: snapshot.asOfMs,
      runAtMs,
    }]);

	    await ctx.self.ts("portfolio", "positions").append(snapshot.holdings.map((h) => ({
	      date: runAtMs,
	      accountId: snapshotAccountId(snapshot),
	      portfolioMode: snapshot.portfolioMode,
	      positionCompleteness: snapshot.positionCompleteness,
	      instrumentId: h.instrumentId,
      symbol: h.symbol,
      assetClass: h.assetClass,
      side: h.side,
      quantity: h.quantity,
      currentPrice: h.currentPrice,
      marketValue: h.marketValue,
      weight: h.allocation,
	      currency: h.currency,
	      instrumentDetailsJson: compactJson(h.instrumentDetails || {}),
	      themesJson: compactJson(themesForHolding(snapshot, h)),
	      positionSizeAvailable: canComputePortfolioSizing(snapshot) ? "true" : "false",
	      runAtMs,
	    })));

	    if (normalizedEvent.records.length) {
	      await ctx.self.ts("event", "items").append(normalizedEvent.records.slice(0, 160).map((item) => ({
	        date: item.publishedAtMs || (item.metadata && item.metadata.eventAtMs) || item.firstSeenAtMs || runAtMs,
        eventKey: item.eventKey,
        sourceType: item.sourceType,
        symbol: item.symbol,
        title: item.title,
        summary: item.summary,
        url: item.url,
        source: item.source,
        dedupeStatus: item.dedupeStatus,
        metadataJson: compactJson(item.metadata || {}, 6000),
	        publishedAtMs: item.publishedAtMs,
        firstSeenAtMs: item.firstSeenAtMs,
        lastSeenAtMs: item.lastSeenAtMs,
        runAtMs,
      })));
    }

    if (analyst.findings.length) {
      await ctx.self.ts("finding", "records").append(analyst.findings.map((finding) => ({
        date: runAtMs,
        findingId: finding.findingId,
        findingType: finding.findingType,
        primaryAsset: finding.primaryAsset,
        summary: finding.summary,
        dedupeKey: finding.dedupeKey,
        selected: finding.selected,
        suppressionReason: finding.suppressionReason,
        payloadJson: compactJson(finding.payload || {}, 10000),
        runAtMs,
      })));
    }

    const normalizedEventAuditRows = normalizedEvent.records.map(compactRawEventForAudit);
    const decisionAuditArtifacts = buildAuditArtifacts(eventCandidates, priceSignals.filter((signal) => signal && signal.abnormal), anomalies);
    const searchExpansionTrace = buildSearchExpansionTrace(breakingNews.summary);

	    await ctx.self.ts("analysis", "decision").append([{
	      date: runAtMs,
	      accountId: snapshotAccountId(snapshot),
	      portfolioMode: snapshot.portfolioMode,
	      positionCompleteness: snapshot.positionCompleteness,
	      runSource: RUN_SOURCE,
      alertDecision: shouldPush ? "push" : "no_push",
      urgency: shouldPush ? analyst.decision.urgency : "none",
      reason: analyst.decision.reason || analyst.decision.skipReason || "",
      skipReason: shouldPush ? "" : (analyst.decision.skipReason || analyst.decision.reason || "quiet_run"),
      notificationMessage: shouldPush ? pmNotificationMessage : "",
      selectedFindingIdsJson: compactJson(analyst.decision.selectedFindingIds || []),
      suppressedFindingIdsJson: compactJson(analyst.decision.suppressedFindingIds || []),
      messageSectionsJson: compactJson(analyst.decision.messageSections || {}, 6000),
      currentPortfolioDeltaJson: compactJson(delta, 12000),
      priorAlertHistoryJson: compactJson(priorAlertTimeline, 50000),
      rawEventsJson: compactJson(normalizedEventAuditRows, 250000),
      eventCandidatesJson: compactJson(laneArtifacts.eventCandidates, 160000),
      qualifiedEventsJson: compactJson(laneArtifacts.qualifiedEvents, 80000),
      selectedEventsJson: compactJson(laneArtifacts.selectedEvents, 60000),
      anomaliesJson: compactJson(laneArtifacts.anomalies, 60000),
      anomalyAttributionPacketsJson: compactJson(anomalyAttributionPackets.map(compactAnomalyAttributionPacketForAudit), 120000),
      anomalyAttributionsJson: compactJson(laneArtifacts.anomalyAttributions, 90000),
      finalStatusesJson: compactJson(laneArtifacts.finalStatuses, 160000),
      searchExpansionTraceJson: compactJson(searchExpansionTrace, 120000),
      candidateSummaryJson: compactJson({ eventCandidates, qualifiedEvents: laneArtifacts.qualifiedEvents, selectedEvents: laneArtifacts.selectedEvents, anomalies, anomalyAttributionPackets, anomalyAttributions: laneArtifacts.anomalyAttributions, finalStatuses: laneArtifacts.finalStatuses, candidates, priceSignals }, 160000),
      candidateAuditJson: compactJson(decisionAuditArtifacts.candidateAudit),
      anomalySignalsJson: compactJson(decisionAuditArtifacts.anomalySignals),
	      rawAnalystJson,
	      analystDecisionJson: compactJson(analyst.decision || {}, 60000),
	      analystPromptCoverageJson: compactJson(analystPromptCoverage, 40000),
	      portfolioWatchPreferencesJson: compactJson(compactPortfolioWatchPreferencesForAudit(portfolioWatchPreferences), 4000),
	      runAtMs,
	    }]);

    await ctx.self.ts("notify", "message").append([{
      date: runAtMs,
      title: notifyTitle,
      body: notifyBody,
    }]);

    const alertEntry = sanitizeAlertTimelineRow({
      runAtMs,
      runAtHkt: hkt(runAtMs),
      runSource: RUN_SOURCE,
      alertDecision: shouldPush ? "push" : "no_push",
      userReceivedPush: !!shouldPush,
      summary: shouldPush ? (analyst.decision.reason || "") : "",
      notificationMessage: shouldPush ? pmNotificationMessage : "",
      selectedFindingIds: analyst.decision.selectedFindingIds || [],
      selectedDedupeKeys: selectedFindings.map((f) => f.dedupeKey),
      tickers: selectedFindings.map((f) => f.primaryAsset).filter((symbol) => symbol && symbol !== "PORTFOLIO"),
    });
    if (alertEntry) alertHistory.push(alertEntry);
    alertHistory = sanitizeAlertTimeline(alertHistory, runAtMs);

    const findingEntries = (analyst.findings || []).map((f) => ({
      runAtMs,
      findingId: f.findingId,
      findingType: f.findingType,
      primaryAsset: f.primaryAsset,
      summary: f.summary,
      dedupeKey: f.dedupeKey,
      selected: f.selected,
      suppressionReason: f.suppressionReason,
    }));
    findingHistory = findingHistory.concat(findingEntries).slice(-160);

    await ctx.kv.put("lastSnapshot", compactJson(snapshot));
    await ctx.kv.put("lastRunAtMs", String(runAtMs));
    await ctx.kv.put("lastPriceSignals", compactJson(priceSignalMap(priceSignals)));
    await ctx.kv.put("eventIndex", compactJson(normalizedEvent.index));
    await ctx.kv.put("alertHistory", compactJson(alertHistory));
    await ctx.kv.put("findingHistory", compactJson(findingHistory));
    await ctx.kv.put("lastDecision", compactJson(alertEntry));
    await ctx.kv.put("nextRunContext", compactJson({
      runAtMs,
      portfolioDeltaSummary: delta.summary,
      selectedDedupeKeys: alertEntry.selectedDedupeKeys,
      nextContextHints: analyst.decision.nextContextHints || [],
      coverageWarnings: warnings.slice(0, 12),
    }));

    const persistRows = buildPersistDeltaRows({
      runAtMs,
      snapshot,
      delta,
      normalizedEvent,
      analyst,
      priceSignals,
      eventCandidates,
      anomalies,
      anomalyAttributionPackets,
      candidates,
      laneArtifacts,
      warnings,
      shouldPush,
      notifyTitle,
      notifyBody,
      alertEntry,
	      alertHistorySize: alertHistory.length,
	      findingHistorySize: findingHistory.length,
	      portfolioWatchPreferences,
	    });
    const runCompletedAtMs = Date.now();
    const audit = buildRunAudit({
      runAtMs,
      previous,
      previousRunAtMs,
      priorAlertHistorySize,
      priorFindingHistorySize,
      fetchStartMs,
      marketDataCoverage,
      themeExtractionSummary: snapshot.themeExtractionSummary || {},
      breakingNewsSummary: breakingNews.summary,
      rateRepricingSummary: rateRepricing.summary,
      themeNewsSummary: breakingNews.summary.themeNewsSummary,
      rawEvents,
      normalizedEvent,
      priceSignals,
      eventCandidates,
      anomalies,
      anomalyAttributionPackets,
      priceFailures,
      macro,
      snapshot,
      delta,
      currentThemes,
      searchExpansionTrace,
      laneArtifacts,
      candidates,
      analyst,
      analystCallMode,
	      analystPromptSummary,
	      analystPromptCoverage,
	      portfolioWatchPreferences,
	      rawAnalystJson,
      shouldPush,
      notifyTitle,
      notifyBody,
      warnings,
      persistRows,
    });
	    await ctx.self.ts("audit", "run_log").append([{
	      date: runAtMs,
	      accountId: snapshotAccountId(snapshot),
	      portfolioMode: snapshot.portfolioMode,
	      positionCompleteness: snapshot.positionCompleteness,
	      runSource: RUN_SOURCE,
      status: "completed",
      alertDecision: shouldPush ? "push" : "no_push",
      shouldPush: shouldPush ? "true" : "false",
      skipReason: shouldPush ? "" : (analyst.decision.skipReason || analyst.decision.reason || "quiet_run"),
      stepLogJson: compactJson(audit.stepLog, 60000),
      dataFetchSummaryJson: compactJson(audit.dataFetchSummary, 90000),
      llmDecisionJson: compactJson(audit.llmDecision, 60000),
      outputSummaryJson: compactJson(audit.outputSummary, 60000),
      persistSummaryJson: compactJson(audit.persistSummary, 60000),
      rawEventsJson: compactJson(normalizedEventAuditRows, 250000),
      eventCandidatesJson: compactJson(laneArtifacts.eventCandidates, 160000),
      qualifiedEventsJson: compactJson(laneArtifacts.qualifiedEvents, 80000),
      selectedEventsJson: compactJson(laneArtifacts.selectedEvents, 60000),
      anomaliesJson: compactJson(laneArtifacts.anomalies, 60000),
      anomalyAttributionPacketsJson: compactJson(anomalyAttributionPackets.map(compactAnomalyAttributionPacketForAudit), 120000),
      anomalyAttributionsJson: compactJson(laneArtifacts.anomalyAttributions, 90000),
      finalStatusesJson: compactJson(laneArtifacts.finalStatuses, 160000),
      searchExpansionTraceJson: compactJson(audit.searchExpansionTrace, 120000),
      candidateAuditJson: compactJson(audit.auditArtifacts.candidateAudit),
      anomalySignalsJson: compactJson(audit.auditArtifacts.anomalySignals),
	      analystDecisionJson: compactJson(analyst.decision || {}, 60000),
	      analystPromptCoverageJson: compactJson(analystPromptCoverage, 40000),
	      portfolioWatchPreferencesJson: compactJson(compactPortfolioWatchPreferencesForAudit(portfolioWatchPreferences), 4000),
	      notificationPreview: clean(notifyBody === SKIP ? "SKIP_NOTIFICATION sentinel" : notifyBody, 1600),
      warningsJson: compactJson(warnings, 12000),
      runStartedAtMs: runAtMs,
      runCompletedAtMs,
      durationMs: runCompletedAtMs - runAtMs,
      runAtMs,
    }]);
    await ctx.self.ts("audit", "persist_delta").append(persistRows);
  });
})();
