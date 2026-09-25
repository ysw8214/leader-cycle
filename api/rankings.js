/* =========================================================
   LEADER CYCLE - RANKINGS V13
   60D CHART + MOVING AVERAGE ALIGNMENT

   기존 V12 STATIC HISTORY OBJECT FIX 유지

   추가 기능
   ---------------------------------------------------------
   1. 최근 60거래일 차트
   2. CLOSE / MA5 / MA10 / MA20 / MA40
   3. 정배열 상태 자동 판정
      PERFECT
      BULLISH
      FORMING
      MIXED
      BROKEN
   4. 프론트 차트용 chart[] 반환
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
      String(
        req.headers["x-forwarded-proto"] ||
        "https"
      )
        .split(",")[0]
        .trim();

    const host =
      String(
        req.headers["x-forwarded-host"] ||
        req.headers.host ||
        ""
      )
        .split(",")[0]
        .trim();

    if (!host) {
      throw new Error(
        "host 정보를 확인할 수 없습니다."
      );
    }

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

      const timer =
        setTimeout(
          () => controller.abort(),
          timeoutMs
        );

      try {
        const response =
          await fetch(
            url,
            {
              signal:
                controller.signal,

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

      for (const candidate of candidatePaths) {
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
            `원인: ${error?.message || error}`
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
        String(value ?? "")
          .trim();

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
      if (
        !row ||
        typeof row !== "object"
      ) {
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
        !/^\d{8}$/.test(
          normalized.date
        ) ||
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
       ACTUAL STATIC HISTORY FORMAT
    ===================================================== */

    function parseStockObject(obj) {
      if (
        !obj ||
        Array.isArray(obj) ||
        typeof obj !== "object"
      ) {
        return;
      }

      for (
        const [keyCode, stock]
        of Object.entries(obj)
      ) {
        const code =
          cleanStockCode(
            stock?.code ??
            keyCode
          );

        if (!code) {
          continue;
        }

        /*
          현재 구조:

          "005930": {
            code,
            name,
            market,
            history: [...]
          }
        */

        if (
          stock &&
          typeof stock === "object" &&
          !Array.isArray(stock) &&
          Array.isArray(stock.history)
        ) {
          for (
            const row
            of stock.history
          ) {
            pushHistory(
              code,
              row
            );
          }

          continue;
        }

        /*
          구형 구조:

          "005930": [...]
        */

        if (Array.isArray(stock)) {
          for (
            const row
            of stock
          ) {
            pushHistory(
              code,
              row
            );
          }
        }
      }
    }

    parseStockObject(
      historyJSON?.stocks
    );

    parseStockObject(
      historyJSON?.history
    );

    parseStockObject(
      historyJSON?.data
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
       DATE OBJECT
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
       DATE BLOCK ARRAY
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

        if (!Array.isArray(rows)) {
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
       SORT + DEDUP

       분석 엔진에서는
       과거 → 최신 순서
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
              cleanStockCode(
                stock.code
              )
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

            code:
              cleanStockCode(
                stock.code
              ),

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
       MOVING AVERAGE HELPER FOR CHART
    ===================================================== */

    function movingAverageAt(
      rows,
      index,
      period
    ) {
      if (
        index + 1 <
        period
      ) {
        return null;
      }

      const values =
        rows
          .slice(
            index - period + 1,
            index + 1
          )
          .map(
            row =>
              num(row.close)
          )
          .filter(
            value =>
              value > 0
          );

      if (
        values.length !==
        period
      ) {
        return null;
      }

      return round(
        average(values)
      );
    }

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
         CURRENT MOVING AVERAGES
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
         60 DAY CHART

         history 최대 105일을 사용해서
         MA40을 먼저 계산한 뒤
         마지막 60일만 전달.

         따라서 차트 첫날부터도
         가능한 경우 MA40 표시 가능.
      =================================================== */

      const chartSource =
        history.slice(-105);

      const fullChart =
        chartSource.map(
          (row, index) => ({
            date:
              row.date,

            close:
              round(
                row.close
              ),

            ma5:
              movingAverageAt(
                chartSource,
                index,
                5
              ),

            ma10:
              movingAverageAt(
                chartSource,
                index,
                10
              ),

            ma20:
              movingAverageAt(
                chartSource,
                index,
                20
              ),

            ma40:
              movingAverageAt(
                chartSource,
                index,
                40
              )
          })
        );

      const chart =
        fullChart.slice(-60);

      /* ===================================================
         ALIGNMENT STATUS

         PERFECT
         현재가 > MA5 > MA10 > MA20 > MA40

         BULLISH
         MA5 > MA10 > MA20 > MA40

         FORMING
         단기선이 장기선 위로 올라오는 중

         BROKEN
         현재가 MA20 아래 + MA5 < MA10

         MIXED
         나머지
      =================================================== */

      let alignment =
        "MIXED";

      let alignmentLabel =
        "혼조";

      if (
        current > ma5 &&
        ma5 > ma10 &&
        ma10 > ma20 &&
        ma20 > ma40
      ) {
        alignment =
          "PERFECT";

        alignmentLabel =
          "완전 정배열";

      } else if (
        ma5 > ma10 &&
        ma10 > ma20 &&
        ma20 > ma40
      ) {
        alignment =
          "BULLISH";

        alignmentLabel =
          "상승 정배열";

      } else if (
        ma5 > ma20 &&
        ma20 >= ma40
      ) {
        alignment =
          "FORMING";

        alignmentLabel =
          "정배열 형성중";

      } else if (
        current < ma20 &&
        ma5 < ma10
      ) {
        alignment =
          "BROKEN";

        alignmentLabel =
          "정배열 붕괴";
      }

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
          ? Math.max(
              ...prev20
            )
          : current;

      const low20 =
        prev20.length
          ? Math.min(
              ...prev20
            )
          : current;

      /* ===================================================
         VOLUME / VALUE
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

      if (
        current > ma5
      ) {
        trendScore += 20;
      }

      if (
        ma5 > ma10
      ) {
        trendScore += 20;
      }

      if (
        ma10 > ma20
      ) {
        trendScore += 25;
      }

      if (
        ma20 > ma40
      ) {
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
         MOMENTUM
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
         ENERGY
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
         BREAKOUT
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
         OVERHEAT
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

      if (
        return5 > 15
      ) {
        overheatScore +=
          (
            return5 -
            15
          ) * 2;
      }

      if (
        return20 > 35
      ) {
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
         LEADER
      =================================================== */

      const leaderScore =
        clamp(
          trendScore * 0.35 +
          momentumScore * 0.25 +
          energyScore * 0.2 +
          breakoutScore * 0.2 -
          overheatScore * 0.15,
          0,
          100
        );

      /* ===================================================
         EARLY
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
          ) * 500,
          0,
          100
        );

      const earlyScore =
        clamp(
          earlyTrend * 0.3 +
          energyScore * 0.3 +
          breakoutScore * 0.2 +
          momentumScore * 0.2 -
          overheatScore * 0.3,
          0,
          100
        );

      /* ===================================================
         ENTRY
      =================================================== */

      const alignmentScore =
        (
          current > ma5
            ? 20
            : 0
        ) +
        (
          ma5 > ma10
            ? 25
            : 0
        ) +
        (
          ma10 > ma20
            ? 30
            : 0
        ) +
        (
          ma20 > ma40
            ? 25
            : 0
        );

      const entryScore =
        clamp(
          alignmentScore * 0.3 +
          breakoutScore * 0.3 +
          energyScore * 0.25 +
          momentumScore * 0.15 -
          overheatScore * 0.35,
          0,
          100
        );

      /* ===================================================
         EXHAUSTION
      =================================================== */

      const exhaustionScore =
        clamp(
          overheatScore * 0.5 +
          Math.max(
            0,
            return20 - 20
          ) * 1.2 +
          Math.max(
            0,
            distanceMa20 - 10
          ) * 2 +
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

        /* -----------------------------------------------
           정배열 정보
        ----------------------------------------------- */

        alignment,

        alignmentLabel,

        scores: {
          entry:
            round(
              entryScore
            ),

          leader:
            round(
              leaderScore
            ),

          early:
            round(
              earlyScore
            ),

          exhaustion:
            round(
              exhaustionScore
            )
        },

        indicators: {
          ma5:
            round(
              ma5
            ),

          ma10:
            round(
              ma10
            ),

          ma20:
            round(
              ma20
            ),

          ma40:
            round(
              ma40
            ),

          return5:
            round(
              return5
            ),

          return20:
            round(
              return20
            ),

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
        },

        /* -----------------------------------------------
           프론트 60일 차트
        ----------------------------------------------- */

        chart
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
        .slice(
          0,
          limit
        )
        .map(
          (stock, index) => ({
            rank:
              index + 1,

            ...stock
          })
        );
    }

    const entryRanking =
      makeRanking(
        "entry"
      );

    const leaderRanking =
      makeRanking(
        "leader"
      );

    const earlyRanking =
      makeRanking(
        "early"
      );

    const exhaustionRanking =
      makeRanking(
        "exhaustion"
      );

    /* =====================================================
       DIAGNOSTIC
    ===================================================== */

    const historyLengths =
      [...historyMap.values()]
        .map(
          rows =>
            rows.length
        );

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

    const stocksWith60Days =
      historyLengths.filter(
        length =>
          length >= 60
      ).length;

    /* =====================================================
       ALIGNMENT DIAGNOSTIC
    ===================================================== */

    const alignmentStats = {
      PERFECT:
        analyzed.filter(
          stock =>
            stock.alignment ===
            "PERFECT"
        ).length,

      BULLISH:
        analyzed.filter(
          stock =>
            stock.alignment ===
            "BULLISH"
        ).length,

      FORMING:
        analyzed.filter(
          stock =>
            stock.alignment ===
            "FORMING"
        ).length,

      MIXED:
        analyzed.filter(
          stock =>
            stock.alignment ===
            "MIXED"
        ).length,

      BROKEN:
        analyzed.filter(
          stock =>
            stock.alignment ===
            "BROKEN"
        ).length
    };

    /* =====================================================
       RESPONSE
    ===================================================== */

    return res
      .status(200)
      .json({
        ok:
          true,

        version:
          "LEADER_CYCLE_RANKINGS_V13_60D_CHART",

        date:
          snapshot.date,

        architecture:
          "MARKET_SNAPSHOT + STATIC_HISTORY + 60D_MA_CHART",

        chartConfig: {
          days:
            60,

          lines: [
            "close",
            "ma5",
            "ma10",
            "ma20",
            "ma40"
          ],

          alignmentOrder:
            "PRICE > MA5 > MA10 > MA20 > MA40"
        },

        historyMeta: {
          fileVersion:
            historyJSON?.version ||
            null,

          updatedAt:
            historyJSON?.updatedAt ||
            null,

          latestTradingDate:
            historyJSON?.latestTradingDate ||
            null,

          tradingDaysCollected:
            num(
              historyJSON?.tradingDaysCollected
            ),

          declaredStockCount:
            num(
              historyJSON?.stockCount
            )
        },

        historyDiagnostic: {
          source:
            historyLoad.source,

          location:
            historyLoad.location,

          historyFileStocks:
            historyMap.size,

          totalHistoryRows,

          stocksWith20Days,

          stocksWith60Days,

          minHistoryDays,

          maxHistoryDays
        },

        alignmentStats,

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
          skipped.slice(
            0,
            30
          )
      });

  } catch (error) {
    console.error(
      "RANKINGS V13 ERROR",
      error
    );

    return res
      .status(500)
      .json({
        ok:
          false,

        version:
          "LEADER_CYCLE_RANKINGS_V13_60D_CHART",

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
