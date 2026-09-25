/* =========================================================
   LEADER CYCLE - RANKINGS V11
   ROBUST MARKET HISTORY LOADER

   핵심
   ---------------------------------------------------------
   1. market-snapshot 호출
   2. market-history.json 로컬 파일 탐색
   3. Vercel 경로 차이 자동 대응
   4. 로컬 실패 시 /data/market-history.json HTTP fallback
   5. 다양한 history JSON 구조 자동 인식
========================================================= */

const fs = require("fs");
const path = require("path");

module.exports = async function handler(req, res) {
  const startedAt = Date.now();

  try {
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=1800"
    );

    /* =====================================================
       HELPERS
    ===================================================== */

    const num = value => {
      const n = Number(
        String(value ?? 0)
          .replace(/,/g, "")
          .trim()
      );

      return Number.isFinite(n) ? n : 0;
    };

    const clamp = (value, min, max) =>
      Math.max(min, Math.min(max, value));

    const round = (value, digits = 2) => {
      const p = Math.pow(10, digits);

      return Math.round(num(value) * p) / p;
    };

    const average = values => {
      const valid = values
        .map(Number)
        .filter(Number.isFinite);

      if (!valid.length) {
        return 0;
      }

      return (
        valid.reduce(
          (sum, value) => sum + value,
          0
        ) / valid.length
      );
    };

    /* =====================================================
       BASE URL
    ===================================================== */

    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host = req.headers.host;

    const baseUrl =
      `${protocol}://${host}`;

    /* =====================================================
       FETCH JSON
    ===================================================== */

    async function fetchJSON(
      url,
      timeoutMs = 20000
    ) {
      const controller =
        new AbortController();

      const timer = setTimeout(
        () => controller.abort(),
        timeoutMs
      );

      try {
        const response = await fetch(
          url,
          {
            signal: controller.signal,

            headers: {
              Accept:
                "application/json"
            }
          }
        );

        const text =
          await response.text();

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}: ${text.slice(
              0,
              200
            )}`
          );
        }

        return JSON.parse(text);
      } finally {
        clearTimeout(timer);
      }
    }

    /* =====================================================
       MARKET SNAPSHOT
    ===================================================== */

    const snapshot =
      await fetchJSON(
        `${baseUrl}/api/market-snapshot`
      );

    if (
      !snapshot ||
      snapshot.ok === false
    ) {
      throw new Error(
        snapshot?.error ||
          "market-snapshot 호출 실패"
      );
    }

    const marketStocks =
      Array.isArray(snapshot.stocks)
        ? snapshot.stocks
        : [];

    if (!marketStocks.length) {
      throw new Error(
        "market-snapshot 종목이 없습니다."
      );
    }

    /* =====================================================
       MARKET HISTORY LOADER

       Vercel에서는 process.cwd()만 믿으면
       파일 경로 문제가 생길 수 있으므로
       여러 후보 경로를 검사한다.

       마지막에는 사이트 자체의
       /data/market-history.json 을 HTTP로 읽는다.
    ===================================================== */

    async function loadMarketHistory() {
      const candidatePaths = [
        path.join(
          process.cwd(),
          "data",
          "market-history.json"
        ),

        path.resolve(
          process.cwd(),
          "data",
          "market-history.json"
        ),

        path.join(
          __dirname,
          "..",
          "data",
          "market-history.json"
        ),

        path.resolve(
          __dirname,
          "..",
          "data",
          "market-history.json"
        )
      ];

      const checkedPaths = [];

      for (
        const candidate of candidatePaths
      ) {
        try {
          checkedPaths.push(candidate);

          if (!fs.existsSync(candidate)) {
            continue;
          }

          const raw =
            fs.readFileSync(
              candidate,
              "utf8"
            );

          if (
            !raw ||
            !raw.trim()
          ) {
            continue;
          }

          const json =
            JSON.parse(raw);

          return {
            json,

            source:
              "filesystem",

            location:
              candidate,

            checkedPaths
          };
        } catch (error) {
          console.error(
            "HISTORY FILE LOAD FAILED",
            candidate,
            error?.message
          );
        }
      }

      /*
        filesystem에서 못 찾으면
        정적 파일 URL로 fallback
      */

      const historyUrl =
        `${baseUrl}/data/market-history.json`;

      try {
        const json =
          await fetchJSON(
            historyUrl,
            30000
          );

        return {
          json,

          source:
            "http",

          location:
            historyUrl,

          checkedPaths
        };
      } catch (error) {
        throw new Error(
          [
            "market-history.json 로드 실패",
            `HTTP fallback: ${historyUrl}`,
            `원인: ${
              error?.message || error
            }`
          ].join(" | ")
        );
      }
    }

    const historyLoad =
      await loadMarketHistory();

    const historyJSON =
      historyLoad.json;

    /* =====================================================
       HISTORY NORMALIZER
    ===================================================== */

    const historyMap =
      new Map();

    function cleanStockCode(value) {
      const text =
        String(value ?? "").trim();

      const match =
        text.match(/(\d{6})/);

      return match
        ? match[1]
        : "";
    }

    function normalizeDate(value) {
      return String(
        value ?? ""
      )
        .replace(/-/g, "")
        .replace(/\./g, "")
        .replace(/\//g, "")
        .trim();
    }

    function pushHistory(
      code,
      row,
      fallbackDate = ""
    ) {
      if (!row) {
        return;
      }

      const cleanCode =
        cleanStockCode(code);

      if (!cleanCode) {
        return;
      }

      const normalized = {
        date:
          normalizeDate(
            row.date ??
              row.BAS_DD ??
              row.basDd ??
              row.tradeDate ??
              fallbackDate
          ),

        open:
          num(
            row.open ??
              row.TDD_OPNPRC ??
              row.OPNPRC ??
              row.OPEN
          ),

        high:
          num(
            row.high ??
              row.TDD_HGPRC ??
              row.HGPRC ??
              row.HIGH
          ),

        low:
          num(
            row.low ??
              row.TDD_LWPRC ??
              row.LWPRC ??
              row.LOW
          ),

        close:
          num(
            row.close ??
              row.TDD_CLSPRC ??
              row.CLSPRC ??
              row.CLOSE
          ),

        volume:
          num(
            row.volume ??
              row.ACC_TRDVOL ??
              row.TRDVOL ??
              row.VOLUME
          ),

        tradingValue:
          num(
            row.tradingValue ??
              row.ACC_TRDVAL ??
              row.TRDVAL ??
              row.TRADING_VALUE
          ),

        changeRate:
          num(
            row.changeRate ??
              row.FLUC_RT ??
              row.CHG_RT ??
              row.CHANGE_RATE
          )
      };

      if (
        !normalized.date ||
        normalized.close <= 0
      ) {
        return;
      }

      if (
        !historyMap.has(cleanCode)
      ) {
        historyMap.set(
          cleanCode,
          []
        );
      }

      historyMap
        .get(cleanCode)
        .push(normalized);
    }

    /* =====================================================
       PARSER 1
       stocks = object keyed by stock code
    ===================================================== */

    function parseCodeObject(obj) {
      if (
        !obj ||
        Array.isArray(obj) ||
        typeof obj !== "object"
      ) {
        return;
      }

      for (
        const [code, rows]
        of Object.entries(obj)
      ) {
        if (
          /^\d{6}$/.test(code) &&
          Array.isArray(rows)
        ) {
          for (const row of rows) {
            pushHistory(
              code,
              row
            );
          }
        }
      }
    }

    parseCodeObject(
      historyJSON?.stocks
    );

    parseCodeObject(
      historyJSON?.history
    );

    parseCodeObject(
      historyJSON?.data
    );

    parseCodeObject(
      historyJSON
    );

    /* =====================================================
       PARSER 2
       FLAT ARRAY
    ===================================================== */

    function parseFlatArray(arr) {
      if (!Array.isArray(arr)) {
        return;
      }

      for (const row of arr) {
        if (
          !row ||
          typeof row !== "object"
        ) {
          continue;
        }

        const code =
          row.code ??
          row.stockCode ??
          row.ISU_SRT_CD ??
          row.SRT_CD ??
          row.ISU_CD;

        pushHistory(
          code,
          row
        );
      }
    }

    parseFlatArray(
      historyJSON
    );

    parseFlatArray(
      historyJSON?.stocks
    );

    parseFlatArray(
      historyJSON?.history
    );

    parseFlatArray(
      historyJSON?.data
    );

    parseFlatArray(
      historyJSON?.rows
    );

    /* =====================================================
       PARSER 3
       날짜별 구조

       예:
       {
         dates: {
           "20260901": [
             { code:"005930", ... }
           ]
         }
       }

       또는

       {
         "20260901": [
           { code:"005930", ... }
         ]
       }
    ===================================================== */

    function parseDateObject(obj) {
      if (
        !obj ||
        Array.isArray(obj) ||
        typeof obj !== "object"
      ) {
        return;
      }

      for (
        const [date, rows]
        of Object.entries(obj)
      ) {
        const cleanDate =
          normalizeDate(date);

        if (
          !/^\d{8}$/.test(
            cleanDate
          ) ||
          !Array.isArray(rows)
        ) {
          continue;
        }

        for (const row of rows) {
          const code =
            row?.code ??
            row?.stockCode ??
            row?.ISU_SRT_CD ??
            row?.SRT_CD ??
            row?.ISU_CD;

          pushHistory(
            code,
            row,
            cleanDate
          );
        }
      }
    }

    parseDateObject(
      historyJSON
    );

    parseDateObject(
      historyJSON?.dates
    );

    parseDateObject(
      historyJSON?.history
    );

    parseDateObject(
      historyJSON?.data
    );

    /* =====================================================
       PARSER 4
       날짜별 객체 안에 stocks 배열

       예:
       {
         history: [
           {
             date:"20260901",
             stocks:[...]
           }
         ]
       }
    ===================================================== */

    function parseDateBlocks(arr) {
      if (!Array.isArray(arr)) {
        return;
      }

      for (const block of arr) {
        if (
          !block ||
          typeof block !== "object"
        ) {
          continue;
        }

        const date =
          normalizeDate(
            block.date ??
              block.BAS_DD ??
              block.basDd
          );

        const rows =
          block.stocks ??
          block.rows ??
          block.data;

        if (
          !Array.isArray(rows)
        ) {
          continue;
        }

        for (const row of rows) {
          const code =
            row?.code ??
            row?.stockCode ??
            row?.ISU_SRT_CD ??
            row?.SRT_CD ??
            row?.ISU_CD;

          pushHistory(
            code,
            row,
            date
          );
        }
      }
    }

    parseDateBlocks(
      historyJSON?.history
    );

    parseDateBlocks(
      historyJSON?.dates
    );

    parseDateBlocks(
      historyJSON?.data
    );

    parseDateBlocks(
      historyJSON?.rows
    );

    /* =====================================================
       SORT + DEDUP HISTORY
    ===================================================== */

    let totalHistoryRows = 0;

    for (
      const [code, rows]
      of historyMap.entries()
    ) {
      const byDate =
        new Map();

      for (const row of rows) {
        byDate.set(
          row.date,
          row
        );
      }

      const sorted =
        [...byDate.values()]
          .sort(
            (a, b) =>
              a.date.localeCompare(
                b.date
              )
          );

      historyMap.set(
        code,
        sorted
      );

      totalHistoryRows +=
        sorted.length;
    }

    /* =====================================================
       INVESTABLE STOCKS
    ===================================================== */

    const investableStocks =
      marketStocks.filter(
        stock => {
          const close =
            num(stock.close);

          const tradingValue =
            num(
              stock.tradingValue
            );

          const marketCap =
            num(
              stock.marketCap
            );

          return (
            /^\d{6}$/.test(
              String(stock.code)
            ) &&
            close >= 1000 &&
            tradingValue >=
              500000000 &&
            marketCap >=
              30000000000
          );
        }
      );

    /* =====================================================
       DISCOVERY SCORE
    ===================================================== */

    const discoveryCandidates =
      investableStocks
        .map(stock => {
          const changeRate =
            num(
              stock.changeRate
            );

          const tradingValue =
            num(
              stock.tradingValue
            );

          const marketCap =
            num(
              stock.marketCap
            );

          const liquidityScore =
            clamp(
              Math.log10(
                Math.max(
                  tradingValue,
                  1
                )
              ) * 8,
              0,
              100
            );

          const momentumScore =
            clamp(
              50 +
                changeRate * 5,
              0,
              100
            );

          const sizeScore =
            clamp(
              Math.log10(
                Math.max(
                  marketCap,
                  1
                )
              ) * 5,
              0,
              100
            );

          const discoveryScore =
            liquidityScore * 0.5 +
            momentumScore * 0.35 +
            sizeScore * 0.15;

          return {
            ...stock,

            discoveryScore:
              round(
                discoveryScore
              )
          };
        })
        .sort(
          (a, b) =>
            b.discoveryScore -
            a.discoveryScore
        )
        .slice(0, 80);

    /* =====================================================
       STOCK ANALYSIS
    ===================================================== */

    const analyzed = [];
    const skipped = [];

    for (
      const stock
      of discoveryCandidates
    ) {
      const code =
        cleanStockCode(
          stock.code
        );

      const history =
        historyMap.get(code) ||
        [];

      if (
        history.length < 20
      ) {
        skipped.push({
          code,

          name:
            stock.name,

          market:
            stock.market,

          reason:
            `history 부족 (${history.length}일)`
        });

        continue;
      }

      const recent =
        history.slice(-60);

      const closes =
        recent.map(
          row =>
            num(row.close)
        );

      const volumes =
        recent.map(
          row =>
            num(row.volume)
        );

      const tradingValues =
        recent.map(
          row =>
            num(
              row.tradingValue
            )
        );

      const current =
        num(stock.close) ||
        closes[
          closes.length - 1
        ];

      /* ===================================================
         MOVING AVERAGES
      =================================================== */

      const ma5 =
        average(
          closes.slice(-5)
        );

      const ma10 =
        average(
          closes.slice(-10)
        );

      const ma20 =
        average(
          closes.slice(-20)
        );

      const ma40 =
        closes.length >= 40
          ? average(
              closes.slice(-40)
            )
          : ma20;

      /* ===================================================
         20 DAY RANGE
      =================================================== */

      const prev20 =
        closes.slice(
          -21,
          -1
        );

      const high20 =
        prev20.length
          ? Math.max(...prev20)
          : current;

      const low20 =
        prev20.length
          ? Math.min(...prev20)
          : current;

      /* ===================================================
         VOLUME / TRADING VALUE
      =================================================== */

      const avgVolume20 =
        average(
          volumes.slice(-20)
        );

      const avgTradingValue20 =
        average(
          tradingValues.slice(
            -20
          )
        );

      const latestVolume =
        num(stock.volume) ||
        volumes[
          volumes.length - 1
        ];

      const latestTradingValue =
        num(
          stock.tradingValue
        ) ||
        tradingValues[
          tradingValues.length -
            1
        ];

      const volumeRatio =
        avgVolume20 > 0
          ? latestVolume /
            avgVolume20
          : 0;

      const valueRatio =
        avgTradingValue20 > 0
          ? latestTradingValue /
            avgTradingValue20
          : 0;

      /* ===================================================
         RETURNS
      =================================================== */

      const return5 =
        closes.length >= 6
          ? (
              current /
                closes[
                  closes.length -
                    6
                ] -
              1
            ) * 100
          : 0;

      const return20 =
        closes.length >= 21
          ? (
              current /
                closes[
                  closes.length -
                    21
                ] -
              1
            ) * 100
          : 0;

      const distanceMa20 =
        ma20 > 0
          ? (
              current / ma20 -
              1
            ) * 100
          : 0;

      const breakoutPct =
        high20 > 0
          ? (
              current / high20 -
              1
            ) * 100
          : 0;

      const rangePosition =
        high20 > low20
          ? (
              (current - low20) /
              (high20 - low20)
            ) * 100
          : 50;

      /* ===================================================
         TREND SCORE
      =================================================== */

      let trendScore = 0;

      if (current > ma5) {
        trendScore += 20;
      }

      if (ma5 > ma10) {
        trendScore += 20;
      }

      if (ma10 > ma20) {
        trendScore += 25;
      }

      if (ma20 > ma40) {
        trendScore += 20;
      }

      trendScore +=
        clamp(
          return20,
          -10,
          15
        );

      trendScore =
        clamp(
          trendScore,
          0,
          100
        );

      /* ===================================================
         MOMENTUM SCORE
      =================================================== */

      const momentumScore =
        clamp(
          45 +
            return5 * 2 +
            return20 * 0.8,
          0,
          100
        );

      /* ===================================================
         ENERGY SCORE
      =================================================== */

      const energyScore =
        clamp(
          30 +
            Math.min(
              volumeRatio,
              5
            ) * 15 +
            Math.min(
              valueRatio,
              5
            ) * 10,
          0,
          100
        );

      /* ===================================================
         BREAKOUT SCORE
      =================================================== */

      const breakoutScore =
        clamp(
          55 +
            breakoutPct * 8 +
            (
              rangePosition -
              70
            ) * 0.5,
          0,
          100
        );

      /* ===================================================
         OVERHEAT SCORE
      =================================================== */

      let overheatScore = 0;

      if (
        distanceMa20 > 8
      ) {
        overheatScore +=
          (
            distanceMa20 -
            8
          ) * 3;
      }

      if (return5 > 15) {
        overheatScore +=
          (
            return5 -
            15
          ) * 2;
      }

      if (return20 > 35) {
        overheatScore +=
          (
            return20 -
            35
          ) * 1.5;
      }

      overheatScore =
        clamp(
          overheatScore,
          0,
          100
        );

      /* ===================================================
         LEADER SCORE
      =================================================== */

      const leaderScore =
        clamp(
          trendScore * 0.35 +
            momentumScore *
              0.25 +
            energyScore * 0.2 +
            breakoutScore *
              0.2 -
            overheatScore *
              0.15,
          0,
          100
        );

      /* ===================================================
         EARLY SCORE
      =================================================== */

      const earlyTrend =
        clamp(
          50 +
            (
              ma5 /
                Math.max(
                  ma20,
                  1
                ) -
              1
            ) *
              500,
          0,
          100
        );

      const earlyScore =
        clamp(
          earlyTrend * 0.3 +
            energyScore * 0.3 +
            breakoutScore *
              0.2 +
            momentumScore *
              0.2 -
            overheatScore *
              0.3,
          0,
          100
        );

      /* ===================================================
         ENTRY SCORE
      =================================================== */

      const alignmentScore =
        (current > ma5
          ? 20
          : 0) +
        (ma5 > ma10
          ? 25
          : 0) +
        (ma10 > ma20
          ? 30
          : 0) +
        (ma20 > ma40
          ? 25
          : 0);

      const entryScore =
        clamp(
          alignmentScore *
            0.3 +
            breakoutScore *
              0.3 +
            energyScore *
              0.25 +
            momentumScore *
              0.15 -
            overheatScore *
              0.35,
          0,
          100
        );

      /* ===================================================
         EXHAUSTION SCORE
      =================================================== */

      const exhaustionScore =
        clamp(
          overheatScore * 0.5 +
            Math.max(
              0,
              return20 - 20
            ) *
              1.2 +
            Math.max(
              0,
              distanceMa20 -
                10
            ) *
              2 +
            (
              volumeRatio > 3
                ? 15
                : 0
            ),
          0,
          100
        );

      /* ===================================================
         RESULT
      =================================================== */

      analyzed.push({
        code,

        name:
          stock.name,

        market:
          stock.market,

        close:
          current,

        changeRate:
          round(
            stock.changeRate
          ),

        volume:
          latestVolume,

        tradingValue:
          latestTradingValue,

        marketCap:
          num(
            stock.marketCap
          ),

        historyDays:
          history.length,

        discoveryScore:
          stock.discoveryScore,

        scores: {
          entry:
            round(entryScore),

          leader:
            round(
              leaderScore
            ),

          early:
            round(earlyScore),

          exhaustion:
            round(
              exhaustionScore
            )
        },

        indicators: {
          ma5:
            round(ma5),

          ma10:
            round(ma10),

          ma20:
            round(ma20),

          ma40:
            round(ma40),

          return5:
            round(return5),

          return20:
            round(return20),

          distanceMa20:
            round(
              distanceMa20
            ),

          breakoutPct:
            round(
              breakoutPct
            ),

          rangePosition:
            round(
              rangePosition
            ),

          volumeRatio:
            round(
              volumeRatio
            ),

          tradingValueRatio:
            round(
              valueRatio
            )
        }
      });
    }

    /* =====================================================
       RANKINGS
    ===================================================== */

    function makeRanking(
      type,
      limit = 10
    ) {
      return analyzed
        .slice()
        .sort(
          (a, b) =>
            b.scores[type] -
            a.scores[type]
        )
        .slice(0, limit)
        .map(
          (stock, index) => ({
            rank:
              index + 1,

            ...stock
          })
        );
    }

    const entryRanking =
      makeRanking("entry");

    const leaderRanking =
      makeRanking("leader");

    const earlyRanking =
      makeRanking("early");

    const exhaustionRanking =
      makeRanking(
        "exhaustion"
      );

    /* =====================================================
       HISTORY DIAGNOSTIC
    ===================================================== */

    const historyLengths =
      [...historyMap.values()]
        .map(rows => rows.length);

    const maxHistoryDays =
      historyLengths.length
        ? Math.max(
            ...historyLengths
          )
        : 0;

    const minHistoryDays =
      historyLengths.length
        ? Math.min(
            ...historyLengths
          )
        : 0;

    const stocksWith20Days =
      historyLengths.filter(
        length =>
          length >= 20
      ).length;

    /* =====================================================
       RESPONSE
    ===================================================== */

    return res.status(200).json({
      ok: true,

      version:
        "LEADER_CYCLE_RANKINGS_V11_ROBUST_HISTORY",

      date:
        snapshot.date,

      philosophy: {
        leader:
          "현재 시장을 실제로 이끄는 종목",

        early:
          "차기 주도주로 전환될 가능성이 높은 종목",

        exhaustion:
          "기존 공세의 상승 에너지가 소진되는 위험",

        entry:
          "정배열 형성·돌파·거래에너지가 동시에 나타나는 공세 시작 구간"
      },

      architecture:
        "MARKET_SNAPSHOT + ROBUST_STATIC_MARKET_HISTORY",

      historyDiagnostic: {
        source:
          historyLoad.source,

        location:
          historyLoad.location,

        historyFileStocks:
          historyMap.size,

        totalHistoryRows,

        stocksWith20Days,

        minHistoryDays,

        maxHistoryDays
      },

      performance: {
        elapsedMs:
          Date.now() -
          startedAt,

        krxHistoryRequests:
          0,

        historyFileStocks:
          historyMap.size
      },

      stats: {
        marketStocks:
          marketStocks.length,

        investableStocks:
          investableStocks.length,

        discoveryCandidates:
          discoveryCandidates.length,

        analyzed:
          analyzed.length,

        skipped:
          skipped.length
      },

      topPicks: {
        entry:
          entryRanking[0] ||
          null,

        leader:
          leaderRanking[0] ||
          null,

        early:
          earlyRanking[0] ||
          null,

        exhaustion:
          exhaustionRanking[0] ||
          null
      },

      entryRanking,

      leaderRanking,

      earlyRanking,

      exhaustionRanking,

      skipped:
        skipped.slice(0, 30)
    });
  } catch (error) {
    console.error(
      "RANKINGS V11 ERROR",
      error
    );

    return res
      .status(500)
      .json({
        ok: false,

        version:
          "LEADER_CYCLE_RANKINGS_V11_ROBUST_HISTORY",

        error:
          String(
            error?.message ||
              error
          ),

        elapsedMs:
          Date.now() -
          startedAt
      });
  }
};
