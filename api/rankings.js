/* =========================================================
   LEADER CYCLE - RANKINGS V13 ACTION ENGINE

   기존 V13 60D CHART 구조 유지

   추가 기능
   ---------------------------------------------------------
   1. ACTION ENGINE

      🟢 BUY ZONE
      🔵 PULLBACK BUY
      🟡 HOLD
      🟠 NO CHASE
      🔴 REDUCE
      ⛔ EXIT

   2. ACTION CONFIDENCE

   3. ACTION REASONS

   4. ATR 기반 가격 영역

      buyZone.low
      buyZone.high
      chasePrice
      trendStop

   5. RISK

      LOW
      NORMAL
      HIGH
      EXTREME

   핵심 원칙
   ---------------------------------------------------------
   ENTRY 점수 ≠ 최종 매수판정

   우선순위:

   추세 붕괴
      ↓
   EXIT

   추세 약화 / 소진
      ↓
   REDUCE

   과열 / 과도한 이격
      ↓
   NO CHASE

   정배열 눌림
      ↓
   PULLBACK BUY

   초기 주도 + 돌파 + 거래에너지
      ↓
   BUY ZONE

   그 외 상승 추세
      ↓
   HOLD
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
            source: "filesystem",
            location: candidate,
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
          source: "http",
          location: historyUrl,
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
       STATIC STOCK OBJECT
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
       MOVING AVERAGE HELPER
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
       ATR HELPER

       14일 Average True Range

       TR =
       max(
         HIGH - LOW,
         |HIGH - PREV CLOSE|,
         |LOW - PREV CLOSE|
       )
    ===================================================== */

    function calculateATR(
      rows,
      period = 14
    ) {
      if (
        !Array.isArray(rows) ||
        rows.length < 2
      ) {
        return 0;
      }

      const trueRanges = [];

      for (
        let i = 1;
        i < rows.length;
        i++
      ) {
        const high =
          num(rows[i].high);

        const low =
          num(rows[i].low);

        const prevClose =
          num(
            rows[i - 1].close
          );

        if (
          high <= 0 ||
          low <= 0 ||
          prevClose <= 0
        ) {
          continue;
        }

        const tr =
          Math.max(
            high - low,
            Math.abs(
              high -
              prevClose
            ),
            Math.abs(
              low -
              prevClose
            )
          );

        if (
          Number.isFinite(tr) &&
          tr >= 0
        ) {
          trueRanges.push(tr);
        }
      }

      if (!trueRanges.length) {
        return 0;
      }

      return average(
        trueRanges.slice(
          -period
        )
      );
    }

    /* =====================================================
       PRICE ROUNDING

       KRX 호가단위를 완전히 재현하려는 목적이 아니라
       투자 판단용 가격 영역을 보기 좋게 표시하기 위한
       안전한 가격 라운딩.
    ===================================================== */

    function priceRound(value) {
      const price =
        Math.max(
          0,
          num(value)
        );

      if (
        price >= 500000
      ) {
        return (
          Math.round(
            price / 1000
          ) * 1000
        );
      }

      if (
        price >= 100000
      ) {
        return (
          Math.round(
            price / 500
          ) * 500
        );
      }

      if (
        price >= 50000
      ) {
        return (
          Math.round(
            price / 100
          ) * 100
        );
      }

      if (
        price >= 10000
      ) {
        return (
          Math.round(
            price / 50
          ) * 50
        );
      }

      if (
        price >= 5000
      ) {
        return (
          Math.round(
            price / 10
          ) * 10
        );
      }

      return Math.round(price);
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
         ATR
      =================================================== */

      const atr =
        calculateATR(
          history.slice(-30),
          14
        );

      const atrPct =
        current > 0
          ? (
              atr /
              current
            ) * 100
          : 0;

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
         ACTION PRICE ENGINE
      =================================================== */

      /*
        변동성 안전장치.

        일부 종목의 ATR 데이터가 부족하거나
        비정상적으로 작을 경우 현재가의 1.5%를
        최소 변동폭으로 사용.
      */

      const effectiveATR =
        Math.max(
          atr,
          current * 0.015
        );

      /*
        눌림 관심 영역의 중심.

        강한 상승추세에서는 MA5~MA10 부근을
        우선적인 관심 영역으로 사용한다.

        추세가 아직 형성중이면 MA10 비중을 높인다.
      */

      let buyCenter;

      if (
        alignment === "PERFECT" ||
        alignment === "BULLISH"
      ) {
        buyCenter =
          ma5 * 0.45 +
          ma10 * 0.55;

      } else {
        buyCenter =
          ma10 * 0.4 +
          ma20 * 0.6;
      }

      /*
        BUY ZONE 폭.

        ATR을 사용하여 종목별 변동성 차이를 반영.
      */

      let buyZoneLow =
        buyCenter -
        effectiveATR * 0.55;

      let buyZoneHigh =
        buyCenter +
        effectiveATR * 0.35;

      /*
        강한 돌파 초기 종목은
        과거 고점 자체도 매수 관심 기준이 된다.
      */

      if (
        breakoutPct >= -1 &&
        breakoutPct <= 4 &&
        (
          alignment === "PERFECT" ||
          alignment === "BULLISH"
        )
      ) {
        const breakoutZoneLow =
          high20 -
          effectiveATR * 0.35;

        const breakoutZoneHigh =
          high20 +
          effectiveATR * 0.45;

        buyZoneLow =
          Math.max(
            buyZoneLow,
            breakoutZoneLow
          );

        buyZoneHigh =
          Math.max(
            buyZoneHigh,
            breakoutZoneHigh
          );
      }

      /*
        잘못된 역전 방지
      */

      if (
        buyZoneLow >
        buyZoneHigh
      ) {
        const temp =
          buyZoneLow;

        buyZoneLow =
          buyZoneHigh;

        buyZoneHigh =
          temp;
      }

      /*
        추격주의 가격.

        20일 고점 + ATR 또는
        MA20 이격이 과열권에 진입하는 가격 중
        현실적인 상단값 사용.
      */

      const chaseFromBreakout =
        high20 +
        effectiveATR * 1.15;

      const chaseFromMa20 =
        ma20 * 1.10;

      let chasePrice =
        Math.max(
          chaseFromBreakout,
          chaseFromMa20
        );

      /*
        추세 방어선.

        MA20과 최근 변동성을 함께 사용.

        지나치게 촘촘한 stop을 피하기 위해
        MA20 - 0.8 ATR.
      */

      let trendStop =
        ma20 -
        effectiveATR * 0.8;

      /*
        MA40이 존재하고
        MA20과 매우 가까우면
        장기 추세 구조도 고려.
      */

      if (
        ma40 > 0 &&
        ma40 < ma20 &&
        (
          ma20 - ma40
        ) <
        effectiveATR
      ) {
        trendStop =
          Math.min(
            trendStop,
            ma40 -
            effectiveATR * 0.25
          );
      }

      buyZoneLow =
        priceRound(
          Math.max(
            buyZoneLow,
            1
          )
        );

      buyZoneHigh =
        priceRound(
          Math.max(
            buyZoneHigh,
            buyZoneLow
          )
        );

      chasePrice =
        priceRound(
          Math.max(
            chasePrice,
            current
          )
        );

      trendStop =
        priceRound(
          Math.max(
            trendStop,
            1
          )
        );

      /* ===================================================
         ACTION CONDITIONS
      =================================================== */

      const trendBroken =
        alignment === "BROKEN" ||
        (
          current < ma20 &&
          ma5 < ma10 &&
          ma10 <= ma20
        );

      const severeTrendBroken =
        (
          current <
          ma20 -
          effectiveATR * 0.5
        ) &&
        ma5 < ma10;

      const trendWeakening =
        !trendBroken &&
        (
          current < ma10 ||
          ma5 < ma10 ||
          exhaustionScore >= 65
        );

      /*
        과열 조건.

        ENTRY가 아무리 높아도
        아래 조건이면 신규 추격매수를 제한.
      */

      const extremeOverheat =
        distanceMa20 >= 15 ||
        return5 >= 20 ||
        overheatScore >= 70;

      const overheat =
        distanceMa20 >= 10 ||
        return5 >= 15 ||
        overheatScore >= 45 ||
        current >= chasePrice;

      /*
        돌파.

        고점 바로 아래 -0.5%까지도
        실전에서는 돌파 시도 구간으로 인정.
      */

      const breakout =
        breakoutPct >= -0.5 &&
        rangePosition >= 90;

      const strongBreakout =
        breakoutPct >= 0 &&
        rangePosition >= 95;

      /*
        거래 에너지.
      */

      const energyHealthy =
        valueRatio >= 1.15 ||
        volumeRatio >= 1.20;

      const energyStrong =
        valueRatio >= 1.5 ||
        volumeRatio >= 1.5;

      /*
        상승 추세.
      */

      const bullishTrend =
        alignment === "PERFECT" ||
        alignment === "BULLISH";

      const trendForming =
        alignment === "FORMING";

      /*
        눌림 조건.

        현재가가 MA5 / MA10 근처로 내려왔지만
        MA20 위 상승 구조를 유지.
      */

      const distanceMa5 =
        ma5 > 0
          ? (
              current / ma5 -
              1
            ) * 100
          : 0;

      const distanceMa10 =
        ma10 > 0
          ? (
              current / ma10 -
              1
            ) * 100
          : 0;

      const nearShortMA =
        (
          Math.abs(
            distanceMa5
          ) <=
          Math.max(
            3,
            atrPct * 1.2
          )
        ) ||
        (
          Math.abs(
            distanceMa10
          ) <=
          Math.max(
            3,
            atrPct * 1.2
          )
        );

      const pullback =
        bullishTrend &&
        current > ma20 &&
        nearShortMA &&
        return5 < 12 &&
        distanceMa20 < 10;

      /*
        BUY ZONE은 단순 ENTRY 점수 기준이 아니다.

        추세 + 돌파 + 에너지 + 과열 부재가
        동시에 확인되어야 한다.
      */

      const buyZoneCandidate =
        (
          bullishTrend ||
          trendForming
        ) &&
        breakout &&
        energyHealthy &&
        entryScore >= 55 &&
        overheatScore < 45 &&
        distanceMa20 < 10 &&
        return5 < 15;

      const strongBuyZone =
        bullishTrend &&
        strongBreakout &&
        energyStrong &&
        entryScore >= 65 &&
        overheatScore < 40 &&
        distanceMa20 < 8 &&
        return5 < 12;

      const pullbackCandidate =
        pullback &&
        valueRatio >= 0.75 &&
        entryScore >= 45 &&
        exhaustionScore < 55;

      /* ===================================================
         ACTION SIGNAL
      =================================================== */

      let actionSignal =
        "HOLD";

      /*
        우선순위 1
        EXIT
      */

      if (
        severeTrendBroken ||
        (
          trendBroken &&
          current < ma20
        )
      ) {
        actionSignal =
          "EXIT";

      /*
        우선순위 2
        REDUCE
      */

      } else if (
        trendWeakening &&
        (
          exhaustionScore >= 60 ||
          current < ma10
        )
      ) {
        actionSignal =
          "REDUCE";

      /*
        우선순위 3
        NO CHASE

        ENTRY가 90이어도
        과열이면 여기서 차단.
      */

      } else if (
        extremeOverheat ||
        (
          overheat &&
          bullishTrend
        )
      ) {
        actionSignal =
          "NO_CHASE";

      /*
        우선순위 4
        PULLBACK BUY
      */

      } else if (
        pullbackCandidate
      ) {
        actionSignal =
          "PULLBACK_BUY";

      /*
        우선순위 5
        BUY ZONE
      */

      } else if (
        buyZoneCandidate ||
        strongBuyZone
      ) {
        actionSignal =
          "BUY_ZONE";

      /*
        나머지
        HOLD
      */

      } else {
        actionSignal =
          "HOLD";
      }

      /* ===================================================
         ACTION LABEL
      =================================================== */

      const actionLabels = {
        BUY_ZONE:
          "🟢 BUY ZONE",

        PULLBACK_BUY:
          "🔵 PULLBACK BUY",

        HOLD:
          "🟡 HOLD",

        NO_CHASE:
          "🟠 NO CHASE",

        REDUCE:
          "🔴 REDUCE",

        EXIT:
          "⛔ EXIT"
      };

      /* ===================================================
         RISK
      =================================================== */

      let risk =
        "NORMAL";

      if (
        extremeOverheat ||
        severeTrendBroken ||
        exhaustionScore >= 80
      ) {
        risk =
          "EXTREME";

      } else if (
        overheat ||
        trendBroken ||
        exhaustionScore >= 60
      ) {
        risk =
          "HIGH";

      } else if (
        bullishTrend &&
        overheatScore < 20 &&
        exhaustionScore < 25 &&
        atrPct < 5
      ) {
        risk =
          "LOW";
      }

      /* ===================================================
         CONFIDENCE ENGINE

         ENTRY 점수와 별개.

         신호를 구성하는 조건들이
         서로 얼마나 같은 방향을 가리키는지 측정.
      =================================================== */

      let confidence = 50;

      if (
        alignment === "PERFECT"
      ) {
        confidence += 14;

      } else if (
        alignment === "BULLISH"
      ) {
        confidence += 10;

      } else if (
        alignment === "FORMING"
      ) {
        confidence += 5;

      } else if (
        alignment === "BROKEN"
      ) {
        confidence +=
          actionSignal === "EXIT"
            ? 15
            : -10;
      }

      /*
        각 ACTION과 실제 데이터의 일치도
      */

      if (
        actionSignal === "BUY_ZONE"
      ) {
        if (breakout) {
          confidence += 10;
        }

        if (energyHealthy) {
          confidence += 10;
        }

        if (strongBreakout) {
          confidence += 5;
        }

        if (energyStrong) {
          confidence += 5;
        }

        if (
          overheatScore < 20
        ) {
          confidence += 5;
        }

        if (
          exhaustionScore > 45
        ) {
          confidence -= 10;
        }
      }

      if (
        actionSignal ===
        "PULLBACK_BUY"
      ) {
        if (pullback) {
          confidence += 15;
        }

        if (
          valueRatio >= 1
        ) {
          confidence += 8;
        }

        if (
          current > ma20
        ) {
          confidence += 7;
        }

        if (
          exhaustionScore < 35
        ) {
          confidence += 5;
        }
      }

      if (
        actionSignal ===
        "NO_CHASE"
      ) {
        if (overheat) {
          confidence += 12;
        }

        if (
          extremeOverheat
        ) {
          confidence += 12;
        }

        if (
          distanceMa20 >= 15
        ) {
          confidence += 5;
        }

        if (
          return5 >= 20
        ) {
          confidence += 5;
        }
      }

      if (
        actionSignal ===
        "REDUCE"
      ) {
        if (
          trendWeakening
        ) {
          confidence += 12;
        }

        if (
          exhaustionScore >= 60
        ) {
          confidence += 10;
        }

        if (
          current < ma10
        ) {
          confidence += 8;
        }
      }

      if (
        actionSignal === "EXIT"
      ) {
        if (
          trendBroken
        ) {
          confidence += 12;
        }

        if (
          severeTrendBroken
        ) {
          confidence += 15;
        }

        if (
          current < ma20
        ) {
          confidence += 8;
        }
      }

      if (
        actionSignal === "HOLD"
      ) {
        if (
          current > ma20
        ) {
          confidence += 8;
        }

        if (
          alignment !== "BROKEN"
        ) {
          confidence += 5;
        }

        /*
          HOLD는 적극적 매매신호보다
          본질적으로 확신도를 조금 낮춘다.
        */

        confidence -= 5;
      }

      confidence =
        Math.round(
          clamp(
            confidence,
            40,
            98
          )
        );

      /* ===================================================
         ACTION REASONS
      =================================================== */

      const reasons = [];

      if (
        alignment === "PERFECT"
      ) {
        reasons.push(
          "완전 정배열"
        );

      } else if (
        alignment === "BULLISH"
      ) {
        reasons.push(
          "상승 정배열"
        );

      } else if (
        alignment === "FORMING"
      ) {
        reasons.push(
          "정배열 형성중"
        );

      } else if (
        alignment === "BROKEN"
      ) {
        reasons.push(
          "단기 추세 붕괴"
        );
      }

      if (
        strongBreakout
      ) {
        reasons.push(
          "20일 고점 돌파"
        );

      } else if (
        breakout
      ) {
        reasons.push(
          "20일 고점 돌파 시도"
        );
      }

      if (
        valueRatio >= 1.5
      ) {
        reasons.push(
          `거래대금 ${round(
            valueRatio,
            1
          )}x 증가`
        );

      } else if (
        valueRatio >= 1.15
      ) {
        reasons.push(
          "거래대금 증가"
        );
      }

      if (
        volumeRatio >= 1.5
      ) {
        reasons.push(
          `거래량 ${round(
            volumeRatio,
            1
          )}x 증가`
        );
      }

      if (
        pullbackCandidate
      ) {
        reasons.push(
          "MA5·MA10 눌림 구간"
        );
      }

      if (
        current > ma20 &&
        actionSignal ===
          "PULLBACK_BUY"
      ) {
        reasons.push(
          "MA20 상승추세 유지"
        );
      }

      if (
        overheatScore < 20 &&
        (
          actionSignal ===
            "BUY_ZONE" ||
          actionSignal ===
            "PULLBACK_BUY"
        )
      ) {
        reasons.push(
          "단기 과열 낮음"
        );
      }

      if (
        distanceMa20 >= 10
      ) {
        reasons.push(
          `MA20 이격 +${round(
            distanceMa20,
            1
          )}%`
        );
      }

      if (
        return5 >= 15
      ) {
        reasons.push(
          `5일 +${round(
            return5,
            1
          )}% 급등`
        );
      }

      if (
        exhaustionScore >= 60
      ) {
        reasons.push(
          "상승 에너지 소진 위험"
        );
      }

      if (
        current < ma10
      ) {
        reasons.push(
          "MA10 하향 이탈"
        );
      }

      if (
        current < ma20
      ) {
        reasons.push(
          "MA20 추세선 이탈"
        );
      }

      /*
        이유가 너무 많으면
        UI 가독성이 떨어지므로
        핵심 5개까지만 전달.
      */

      const finalReasons =
        reasons.slice(0, 5);

      if (
        !finalReasons.length
      ) {
        if (
          actionSignal === "HOLD"
        ) {
          finalReasons.push(
            "추세 확인 구간"
          );
        } else {
          finalReasons.push(
            "복합 기술 신호"
          );
        }
      }

      /* ===================================================
         ACTION OBJECT
      =================================================== */

      const action = {
        signal:
          actionSignal,

        label:
          actionLabels[
            actionSignal
          ],

        confidence,

        reasons:
          finalReasons,

        buyZone: {
          low:
            buyZoneLow,

          high:
            buyZoneHigh
        },

        chasePrice,

        trendStop,

        risk
      };

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

        alignment,

        alignmentLabel,

        action,

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
            ),

          atr14:
            round(
              atr
            ),

          atrPct:
            round(
              atrPct
            ),

          overheat:
            round(
              overheatScore
            )
        },

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
       ACTION RANKINGS

       BUY 계열은 confidence + ENTRY를 함께 고려.

       위험 계열은 confidence + exhaustion을 고려.
    ===================================================== */

    function makeActionRanking(
      signal,
      limit = 20
    ) {
      return analyzed
        .filter(
          stock =>
            stock.action.signal ===
            signal
        )
        .slice()
        .sort(
          (a, b) => {
            const aScore =
              a.action.confidence *
                0.6 +
              a.scores.entry *
                0.4;

            const bScore =
              b.action.confidence *
                0.6 +
              b.scores.entry *
                0.4;

            return (
              bScore -
              aScore
            );
          }
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

    const buyZoneRanking =
      makeActionRanking(
        "BUY_ZONE"
      );

    const pullbackBuyRanking =
      makeActionRanking(
        "PULLBACK_BUY"
      );

    const holdRanking =
      makeActionRanking(
        "HOLD"
      );

    const noChaseRanking =
      makeActionRanking(
        "NO_CHASE"
      );

    const reduceRanking =
      makeActionRanking(
        "REDUCE"
      );

    const exitRanking =
      makeActionRanking(
        "EXIT"
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
       ALIGNMENT STATS
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
       ACTION BOARD
    ===================================================== */

    const actionStats = {
      BUY_ZONE:
        analyzed.filter(
          stock =>
            stock.action.signal ===
            "BUY_ZONE"
        ).length,

      PULLBACK_BUY:
        analyzed.filter(
          stock =>
            stock.action.signal ===
            "PULLBACK_BUY"
        ).length,

      HOLD:
        analyzed.filter(
          stock =>
            stock.action.signal ===
            "HOLD"
        ).length,

      NO_CHASE:
        analyzed.filter(
          stock =>
            stock.action.signal ===
            "NO_CHASE"
        ).length,

      REDUCE:
        analyzed.filter(
          stock =>
            stock.action.signal ===
            "REDUCE"
        ).length,

      EXIT:
        analyzed.filter(
          stock =>
            stock.action.signal ===
            "EXIT"
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
          "LEADER_CYCLE_RANKINGS_V13_ACTION_ENGINE",

        date:
          snapshot.date,

        architecture:
          "MARKET_SNAPSHOT + STATIC_HISTORY + 60D_MA_CHART + ACTION_ENGINE",

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

        actionConfig: {
          signals: [
            "BUY_ZONE",
            "PULLBACK_BUY",
            "HOLD",
            "NO_CHASE",
            "REDUCE",
            "EXIT"
          ],

          priority: [
            "EXIT",
            "REDUCE",
            "NO_CHASE",
            "PULLBACK_BUY",
            "BUY_ZONE",
            "HOLD"
          ],

          priceEngine:
            "MA5 + MA10 + MA20 + 20D_HIGH + ATR14",

          confidence:
            "SIGNAL_CONFLUENCE"
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

        actionStats,

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
            null,

          buyZone:
            buyZoneRanking[0] ||
            null,

          pullbackBuy:
            pullbackBuyRanking[0] ||
            null
        },

        actionBoard: {
          buyZone:
            buyZoneRanking,

          pullbackBuy:
            pullbackBuyRanking,

          hold:
            holdRanking,

          noChase:
            noChaseRanking,

          reduce:
            reduceRanking,

          exit:
            exitRanking
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
      "RANKINGS V13 ACTION ENGINE ERROR",
      error
    );

    return res
      .status(500)
      .json({
        ok:
          false,

        version:
          "LEADER_CYCLE_RANKINGS_V13_ACTION_ENGINE",

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
