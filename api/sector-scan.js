/* =========================================================
   LEADER CYCLE - SECTOR SCANNER V1.1 DIAGNOSTIC

   목적
   ---------------------------------------------------------
   1. market-snapshot 전체 종목 수신
   2. 종목 validation 단계별 진단
   3. sector-map 분류
   4. 섹터별 집계
   5. 어디서 데이터가 소실되는지 명확히 확인

========================================================= */

const {
  groupBySector,
  getClassificationStats,
  getUnclassifiedStocks
} = require("./sector-map");


module.exports = async function handler(req, res) {

  const startedAt = Date.now();

  try {

    /* =====================================================
       HELPERS
    ===================================================== */

    function num(value) {

      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        return 0;
      }

      const n = Number(
        String(value)
          .replace(/,/g, "")
          .trim()
      );

      return Number.isFinite(n)
        ? n
        : 0;
    }


    function clamp(value, min, max) {

      return Math.max(
        min,
        Math.min(max, value)
      );
    }


    function average(values) {

      if (!Array.isArray(values) || !values.length) {
        return 0;
      }

      const valid =
        values
          .map(num)
          .filter(Number.isFinite);

      if (!valid.length) {
        return 0;
      }

      return (
        valid.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        valid.length
      );
    }


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

      return res.status(500).json({
        ok: false,
        version: "SECTOR_SCAN_V1_1_DIAGNOSTIC",
        error: "host 정보를 확인할 수 없습니다."
      });
    }


    const baseUrl =
      `${protocol}://${host}`;


    /* =====================================================
       REQUESTED DATE
    ===================================================== */

    const requestedDate =
      String(
        req.query.date || ""
      )
        .replace(/-/g, "")
        .trim();


    /* =====================================================
       MARKET SNAPSHOT URL
    ===================================================== */

    let snapshotUrl =
      `${baseUrl}/api/market-snapshot`;


    if (/^\d{8}$/.test(requestedDate)) {

      snapshotUrl +=
        `?date=${encodeURIComponent(
          requestedDate
        )}`;
    }


    /* =====================================================
       FETCH MARKET SNAPSHOT
    ===================================================== */

    let response;

    try {

      response =
        await fetch(
          snapshotUrl,
          {
            headers: {
              Accept: "application/json"
            }
          }
        );

    } catch (error) {

      return res.status(502).json({

        ok: false,

        version:
          "SECTOR_SCAN_V1_1_DIAGNOSTIC",

        error:
          "market-snapshot 호출 실패",

        snapshotUrl,

        detail:
          String(
            error?.message ||
            error
          )
      });
    }


    let snapshot;

    try {

      snapshot =
        await response.json();

    } catch (error) {

      return res.status(502).json({

        ok: false,

        version:
          "SECTOR_SCAN_V1_1_DIAGNOSTIC",

        error:
          "market-snapshot JSON 파싱 실패",

        snapshotHttpStatus:
          response.status,

        snapshotUrl
      });
    }


    /* =====================================================
       SNAPSHOT VALIDATION
    ===================================================== */

    if (
      !response.ok ||
      !snapshot ||
      snapshot.ok !== true
    ) {

      return res.status(502).json({

        ok: false,

        version:
          "SECTOR_SCAN_V1_1_DIAGNOSTIC",

        error:
          "market-snapshot 응답 실패",

        snapshotHttpStatus:
          response.status,

        snapshotUrl,

        snapshot:
          snapshot || null
      });
    }


    const rawStocks =
      Array.isArray(
        snapshot.stocks
      )
        ? snapshot.stocks
        : [];


    /* =====================================================
       DIAGNOSTIC PIPELINE

       중요:
       각 단계의 종목수를 따로 계산한다.
    ===================================================== */

    const validCodeStocks =
      rawStocks.filter(
        stock =>
          /^\d{6}$/.test(
            String(
              stock?.code || ""
            ).trim()
          )
      );


    const validNameStocks =
      validCodeStocks.filter(
        stock =>
          String(
            stock?.name || ""
          ).trim().length > 0
      );


    const validPriceStocks =
      validNameStocks.filter(
        stock =>
          num(
            stock?.close
          ) > 0
      );


    /* =====================================================
       NORMALIZE

       validation 후 실제 scanner가 사용할 데이터
    ===================================================== */

    const stocks =
      validPriceStocks.map(
        stock => ({

          ...stock,

          code:
            String(
              stock.code || ""
            ).trim(),

          name:
            String(
              stock.name || ""
            ).trim(),

          market:
            String(
              stock.market || ""
            ).trim(),

          close:
            num(
              stock.close
            ),

          open:
            num(
              stock.open
            ),

          high:
            num(
              stock.high
            ),

          low:
            num(
              stock.low
            ),

          changeRate:
            num(
              stock.changeRate
            ),

          volume:
            num(
              stock.volume
            ),

          tradingValue:
            num(
              stock.tradingValue
            ),

          marketCap:
            num(
              stock.marketCap
            )
        })
      );


    /* =====================================================
       DIAGNOSTICS
    ===================================================== */

    const diagnostics = {

      snapshotVersion:
        snapshot.version ||
        null,

      snapshotDate:
        snapshot.date ||
        null,

      requestedDate:
        snapshot.requestedDate ||
        requestedDate ||
        null,

      fallbackUsed:
        Boolean(
          snapshot.fallbackUsed
        ),

      snapshotStocks:
        rawStocks.length,

      validCodeStocks:
        validCodeStocks.length,

      validNameStocks:
        validNameStocks.length,

      validPriceStocks:
        validPriceStocks.length,

      finalStocks:
        stocks.length,

      snapshotMarketCount:
        snapshot.marketCount ||
        null,

      sampleRaw:
        rawStocks
          .slice(0, 3)
          .map(
            stock => ({
              code:
                stock?.code,

              name:
                stock?.name,

              close:
                stock?.close,

              market:
                stock?.market
            })
          ),

      sampleFinal:
        stocks
          .slice(0, 3)
          .map(
            stock => ({
              code:
                stock.code,

              name:
                stock.name,

              close:
                stock.close,

              market:
                stock.market
            })
          )
    };


    /* =====================================================
       SAFETY CHECK

       snapshot이 0이면 섹터 계산 자체를 하지 않는다.
    ===================================================== */

    if (!rawStocks.length) {

      return res.status(502).json({

        ok: false,

        version:
          "SECTOR_SCAN_V1_1_DIAGNOSTIC",

        error:
          "market-snapshot에서 stocks가 0개 반환되었습니다.",

        diagnostics,

        elapsedMs:
          Date.now() -
          startedAt
      });
    }


    if (!stocks.length) {

      return res.status(500).json({

        ok: false,

        version:
          "SECTOR_SCAN_V1_1_DIAGNOSTIC",

        error:
          "종목 validation 이후 stocks가 0개가 되었습니다.",

        diagnostics,

        elapsedMs:
          Date.now() -
          startedAt
      });
    }


    /* =====================================================
       CLASSIFICATION
    ===================================================== */

    const classification =
      getClassificationStats(
        stocks
      );


    const unclassified =
      getUnclassifiedStocks(
        stocks
      );


    const MINIMUM_COVERAGE =
      90;


    const productionReady =
      classification.coverage >=
      MINIMUM_COVERAGE;


    /* =====================================================
       GROUP BY SECTOR
    ===================================================== */

    const groups =
      groupBySector(
        stocks
      );


    const sectors = [];


    /* =====================================================
       SECTOR AGGREGATION
    ===================================================== */

    for (
      const [
        sectorId,
        group
      ] of Object.entries(
        groups
      )
    ) {

      if (
        sectorId ===
        "UNKNOWN"
      ) {
        continue;
      }


      const sectorStocks =
        Array.isArray(
          group?.stocks
        )
          ? group.stocks
          : [];


      if (!sectorStocks.length) {
        continue;
      }


      const risingStocks =
        sectorStocks.filter(
          stock =>
            num(
              stock.changeRate
            ) > 0
        );


      const fallingStocks =
        sectorStocks.filter(
          stock =>
            num(
              stock.changeRate
            ) < 0
        );


      const flatStocks =
        sectorStocks.filter(
          stock =>
            num(
              stock.changeRate
            ) === 0
        );


      const advanceRatio =
        (
          risingStocks.length /
          sectorStocks.length
        ) * 100;


      const averageChangeRate =
        average(
          sectorStocks.map(
            stock =>
              stock.changeRate
          )
        );


      const totalTradingValue =
        sectorStocks.reduce(
          (sum, stock) =>
            sum +
            num(
              stock.tradingValue
            ),
          0
        );


      const totalMarketCap =
        sectorStocks.reduce(
          (sum, stock) =>
            sum +
            num(
              stock.marketCap
            ),
          0
        );


      /* ===================================================
         SECTOR LEADERS
      =================================================== */

      const leaders =
        [...sectorStocks]
          .sort(
            (a, b) =>
              num(
                b.tradingValue
              ) -
              num(
                a.tradingValue
              )
          )
          .slice(
            0,
            5
          )
          .map(
            stock => ({

              code:
                stock.code,

              name:
                stock.name,

              market:
                stock.market,

              close:
                stock.close,

              changeRate:
                stock.changeRate,

              tradingValue:
                stock.tradingValue,

              marketCap:
                stock.marketCap
            })
          );


      sectors.push({

        id:
          sectorId,

        name:
          group.name,

        stockCount:
          sectorStocks.length,

        rising:
          risingStocks.length,

        falling:
          fallingStocks.length,

        flat:
          flatStocks.length,

        advanceRatio:
          Number(
            advanceRatio.toFixed(2)
          ),

        averageChangeRate:
          Number(
            averageChangeRate.toFixed(2)
          ),

        tradingValue:
          totalTradingValue,

        marketCap:
          totalMarketCap,

        leaders
      });
    }


    /* =====================================================
       MARKET TRADING VALUE
    ===================================================== */

    const marketTradingValue =
      stocks.reduce(
        (sum, stock) =>
          sum +
          num(
            stock.tradingValue
          ),
        0
      );


    /* =====================================================
       TEMPORARY SCORE

       검증용 점수.
       최종 HAN/EARLY 점수가 아님.
    ===================================================== */

    for (
      const sector of sectors
    ) {

      const breadthScore =
        clamp(
          (
            sector.advanceRatio /
            100
          ) * 40,
          0,
          40
        );


      const priceScore =
        clamp(
          (
            sector.averageChangeRate /
            5
          ) * 30,
          0,
          30
        );


      const tradingShare =
        marketTradingValue > 0
          ? (
              sector.tradingValue /
              marketTradingValue
            ) * 100
          : 0;


      const liquidityScore =
        clamp(
          (
            tradingShare /
            10
          ) * 30,
          0,
          30
        );


      sector.tradingShare =
        Number(
          tradingShare.toFixed(2)
        );


      sector.temporaryScore =
        Math.round(
          breadthScore +
          priceScore +
          liquidityScore
        );
    }


    /* =====================================================
       SORT
    ===================================================== */

    sectors.sort(
      (a, b) =>
        b.temporaryScore -
        a.temporaryScore
    );


    /* =====================================================
       CACHE

       진단 중이므로 cache 끔.
    ===================================================== */

    res.setHeader(
      "Cache-Control",
      "no-store"
    );


    /* =====================================================
       RESPONSE
    ===================================================== */

    return res.status(200).json({

      ok: true,

      version:
        "SECTOR_SCAN_V1_1_DIAGNOSTIC",

      date:
        snapshot.date ||
        null,

      requestedDate:
        snapshot.requestedDate ||
        requestedDate ||
        null,

      fallbackUsed:
        Boolean(
          snapshot.fallbackUsed
        ),


      /*
        여기부터 먼저 확인하면 됨.
      */

      diagnostics,


      productionReady,

      warning:
        productionReady
          ? null
          : "sector-map 분류율이 낮아 현재 섹터 순위는 검증용입니다.",


      classification: {

        ...classification,

        minimumCoverage:
          MINIMUM_COVERAGE
      },


      market: {

        stocks:
          stocks.length,

        tradingValue:
          marketTradingValue,

        sectors:
          sectors.length
      },


      unclassified: {

        count:
          unclassified.length,

        sample:
          unclassified
            .slice(
              0,
              50
            )
            .map(
              stock => ({

                code:
                  stock.code,

                name:
                  stock.name,

                market:
                  stock.market
              })
            )
      },


      sectors:
        sectors.slice(
          0,
          50
        ),


      performance: {

        elapsedMs:
          Date.now() -
          startedAt,

        source:
          "MARKET_SNAPSHOT",

        sectorMap:
          "STATIC_PRIMARY_SECTOR"
      }
    });


  } catch (error) {

    console.error(
      "SECTOR SCAN ERROR",
      error
    );


    return res.status(500).json({

      ok: false,

      version:
        "SECTOR_SCAN_V1_1_DIAGNOSTIC",

      elapsedMs:
        Date.now() -
        startedAt,

      error:
        String(
          error?.message ||
          error
        )
    });
  }
};
