/* =========================================================
   LEADER CYCLE - SECTOR SCANNER V1

   역할
   ---------------------------------------------------------
   1. market-snapshot에서 KOSPI + KOSDAQ 전체 종목 수집
   2. sector-map.js로 종목 산업분류
   3. 분류 커버리지 검사
   4. 섹터별 시장 데이터 집계
   5. 아직 coverage가 낮으면 랭킹 사용을 차단

   IMPORTANT
   ---------------------------------------------------------
   sector-map이 충분히 채워지기 전까지는
   실제 섹터 랭킹으로 사용하지 않는다.
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

      if (!Array.isArray(values)) {
        return 0;
      }

      const valid =
        values
          .map(num)
          .filter(
            value =>
              Number.isFinite(value)
          );

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
      req.headers["x-forwarded-proto"] ||
      "https";

    const host =
      req.headers.host;

    if (!host) {

      return res.status(500).json({
        ok: false,
        error:
          "host 정보를 확인할 수 없습니다."
      });
    }

    const baseUrl =
      `${protocol}://${host}`;


    /* =====================================================
       DATE
    ===================================================== */

    const requestedDate =
      String(
        req.query.date || ""
      ).trim();


    /* =====================================================
       MARKET SNAPSHOT

       date를 지정하지 않으면 market-snapshot이
       현재 날짜를 사용한다.

       주말/휴일 fallback은 이후 scanner 최종버전에서
       추가한다.
    ===================================================== */

    let snapshotUrl =
      `${baseUrl}/api/market-snapshot`;

    if (/^\d{8}$/.test(requestedDate)) {

      snapshotUrl +=
        `?date=${encodeURIComponent(
          requestedDate
        )}`;
    }


    let response;

    try {

      response =
        await fetch(
          snapshotUrl
        );

    } catch (error) {

      return res.status(502).json({
        ok: false,

        error:
          "market-snapshot 호출 실패",

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

    } catch {

      return res.status(502).json({
        ok: false,
        error:
          "market-snapshot 응답 JSON 파싱 실패"
      });
    }


    if (
      !response.ok ||
      !snapshot ||
      !snapshot.ok ||
      !Array.isArray(
        snapshot.stocks
      )
    ) {

      return res.status(502).json({
        ok: false,

        error:
          "market-snapshot 데이터 조회 실패",

        detail:
          snapshot
      });
    }


    /* =====================================================
       VALID STOCKS
    ===================================================== */

    const stocks =
      snapshot.stocks
        .map(
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

            close:
              num(
                stock.close
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
        )
        .filter(
          stock =>
            /^\d{6}$/.test(
              stock.code
            ) &&
            stock.name &&
            stock.close > 0
        );


    /* =====================================================
       CLASSIFICATION COVERAGE
    ===================================================== */

    const classification =
      getClassificationStats(
        stocks
      );


    const unclassified =
      getUnclassifiedStocks(
        stocks
      );


    /*
      현재는 sector-map이 완성되기 전이므로
      90% 미만이면 productionReady = false

      최종적으로는 95% 이상을 목표.
    */

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

      /*
        UNKNOWN은 실제 랭킹에서 제외
      */

      if (
        sectorId ===
        "UNKNOWN"
      ) {
        continue;
      }


      const sectorStocks =
        Array.isArray(
          group.stocks
        )
          ? group.stocks
          : [];


      if (!sectorStocks.length) {
        continue;
      }


      /* -------------------------------------------------
         상승 / 하락 종목
      ------------------------------------------------- */

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
        sectorStocks.length > 0
          ? (
              risingStocks.length /
              sectorStocks.length
            ) * 100
          : 0;


      /* -------------------------------------------------
         평균 상승률
      ------------------------------------------------- */

      const averageChangeRate =
        average(
          sectorStocks.map(
            stock =>
              stock.changeRate
          )
        );


      /* -------------------------------------------------
         섹터 전체 거래대금
      ------------------------------------------------- */

      const totalTradingValue =
        sectorStocks.reduce(
          (sum, stock) =>
            sum +
            num(
              stock.tradingValue
            ),
          0
        );


      /* -------------------------------------------------
         섹터 전체 시총
      ------------------------------------------------- */

      const totalMarketCap =
        sectorStocks.reduce(
          (sum, stock) =>
            sum +
            num(
              stock.marketCap
            ),
          0
        );


      /* -------------------------------------------------
         거래대금 기준 내부 주도종목

         현재는 당일 데이터만 있으므로
         단순 거래대금 순위.

         이후 historical sector scan에서
         거래대금 증가율까지 추가한다.
      ------------------------------------------------- */

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
                num(
                  stock.close
                ),

              changeRate:
                num(
                  stock.changeRate
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
            advanceRatio.toFixed(
              2
            )
          ),

        averageChangeRate:
          Number(
            averageChangeRate.toFixed(
              2
            )
          ),

        tradingValue:
          totalTradingValue,

        marketCap:
          totalMarketCap,

        leaders
      });
    }


    /* =====================================================
       시장 거래대금 계산

       각 섹터가 전체 시장 거래대금에서
       차지하는 비율을 계산한다.
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
       TEMPORARY SECTOR SCORE

       아직 historical 데이터가 없으므로
       "최종 HAN / EARLY SCORE"가 아니다.

       현재 목적:
       sector-map 검증 + 기본 데이터 파이프라인 확인

       구성
       -------------------------------------------------
       상승종목 비율    40
       평균 상승률      30
       시장 거래대금비중 30
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


      /*
        평균 +5% 이상이면
        가격강도 최대점수
      */

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


      /*
        시장 거래대금의 10%면
        최대 30점
      */

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
          tradingShare.toFixed(
            2
          )
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

       현재는 임시점수 기준
    ===================================================== */

    sectors.sort(
      (a, b) =>
        b.temporaryScore -
        a.temporaryScore
    );


    /* =====================================================
       CACHE
    ===================================================== */

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=1800, stale-while-revalidate=3600"
    );


    /* =====================================================
       RESPONSE
    ===================================================== */

    return res.status(200).json({

      ok: true,

      version:
        "SECTOR_SCAN_V1_VALIDATION",

      date:
        snapshot.date ||
        requestedDate ||
        null,

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


      /*
        미분류 전체를 반환하면 응답이 너무 커지므로
        앞 100개만 보여준다.
      */

      unclassified: {

        count:
          unclassified.length,

        sample:
          unclassified
            .slice(
              0,
              100
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


      /*
        productionReady가 false여도
        디버깅을 위해 계산 결과는 보여준다.

        단 사이트에는 아직 연결하지 않는다.
      */

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
        "SECTOR_SCAN_V1_VALIDATION",

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
