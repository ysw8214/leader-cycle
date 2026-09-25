/* =========================================================
   LEADER CYCLE - SECTOR SCANNER V3

   HAN + EARLY + SECTOR EXHAUSTION

   목적
   ---------------------------------------------------------
   1. market-snapshot 전체 종목 수신
   2. sector-map 분류
   3. 종목수 Coverage + 거래대금 Coverage 계산
   4. 섹터 Breadth / Momentum / Liquidity 계산
   5. HAN / EARLY / EXHAUSTION 점수 계산
   6. LEADER / EMERGING / WATCH / MATURE / WEAK 분류
   7. 현재 주도섹터 + 차기 주도섹터 + 공세종료 위험 반환

   IMPORTANT
   ---------------------------------------------------------
   market-snapshot.js 건드리지 않음
   sector-map.js 건드리지 않음
========================================================= */

const {
  classifyStocks,
  getClassificationStats
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


    function clamp(value, min = 0, max = 100) {

      return Math.max(
        min,
        Math.min(max, value)
      );
    }


    function round(value, digits = 2) {

      const n = num(value);

      return Number(
        n.toFixed(digits)
      );
    }


    function average(values) {

      if (
        !Array.isArray(values) ||
        !values.length
      ) {
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


    function sum(values) {

      if (!Array.isArray(values)) {
        return 0;
      }

      return values.reduce(
        (total, value) =>
          total + num(value),
        0
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
        version:
          "SECTOR_SCAN_V3_HAN_EARLY_EXHAUSTION",
        error:
          "host 정보를 확인할 수 없습니다."
      });
    }


    const baseUrl =
      `${protocol}://${host}`;


    /* =====================================================
       REQUEST DATE
    ===================================================== */

    const requestedDate =
      String(
        req.query.date || ""
      )
        .replace(/-/g, "")
        .trim();


    let snapshotUrl =
      `${baseUrl}/api/market-snapshot`;


    if (/^\d{8}$/.test(requestedDate)) {

      snapshotUrl +=
        `?date=${encodeURIComponent(
          requestedDate
        )}`;
    }


    /* =====================================================
       MARKET SNAPSHOT
    ===================================================== */

    let response;

    try {

      response =
        await fetch(
          snapshotUrl,
          {
            headers: {
              Accept:
                "application/json"
            }
          }
        );

    } catch (error) {

      return res.status(502).json({

        ok: false,

        version:
          "SECTOR_SCAN_V3_HAN_EARLY_EXHAUSTION",

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

        version:
          "SECTOR_SCAN_V3_HAN_EARLY_EXHAUSTION",

        error:
          "market-snapshot JSON 파싱 실패",

        snapshotHttpStatus:
          response.status
      });
    }


    if (
      !response.ok ||
      !snapshot ||
      snapshot.ok !== true
    ) {

      return res.status(502).json({

        ok: false,

        version:
          "SECTOR_SCAN_V3_HAN_EARLY_EXHAUSTION",

        error:
          "market-snapshot 응답 실패",

        snapshotHttpStatus:
          response.status,

        snapshot:
          snapshot || null
      });
    }


    /* =====================================================
       NORMALIZE STOCKS
    ===================================================== */

    const rawStocks =
      Array.isArray(snapshot.stocks)
        ? snapshot.stocks
        : [];


    const stocks =
      rawStocks
        .filter(
          stock =>
            /^\d{6}$/.test(
              String(
                stock?.code || ""
              ).trim()
            )
        )
        .filter(
          stock =>
            String(
              stock?.name || ""
            ).trim()
        )
        .filter(
          stock =>
            num(
              stock?.close
            ) > 0
        )
        .map(
          stock => ({

            ...stock,

            code:
              String(
                stock.code
              ).trim(),

            name:
              String(
                stock.name
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


    if (!stocks.length) {

      return res.status(502).json({

        ok: false,

        version:
          "SECTOR_SCAN_V3_HAN_EARLY_EXHAUSTION",

        error:
          "사용 가능한 시장 종목이 없습니다.",

        snapshotStocks:
          rawStocks.length
      });
    }


    /* =====================================================
       CLASSIFY
    ===================================================== */

    const classifiedStocks =
      classifyStocks(
        stocks
      );


    const classification =
      getClassificationStats(
        stocks
      );


    const knownStocks =
      classifiedStocks.filter(
        stock =>
          stock.sectorClassified === true
      );


    const unknownStocks =
      classifiedStocks.filter(
        stock =>
          stock.sectorClassified !== true
      );


    /* =====================================================
       MARKET TOTALS
    ===================================================== */

    const marketTradingValue =
      sum(
        stocks.map(
          stock =>
            stock.tradingValue
        )
      );


    const classifiedTradingValue =
      sum(
        knownStocks.map(
          stock =>
            stock.tradingValue
        )
      );


    const unknownTradingValue =
      sum(
        unknownStocks.map(
          stock =>
            stock.tradingValue
        )
      );


    const stockCoverage =
      stocks.length > 0
        ? (
            knownStocks.length /
            stocks.length
          ) * 100
        : 0;


    const tradingValueCoverage =
      marketTradingValue > 0
        ? (
            classifiedTradingValue /
            marketTradingValue
          ) * 100
        : 0;


    /* =====================================================
       GROUP CLASSIFIED STOCKS
    ===================================================== */

    const groupMap = {};


    for (
      const stock of knownStocks
    ) {

      const sectorId =
        stock.sectorId;


      if (!sectorId) {
        continue;
      }


      if (!groupMap[sectorId]) {

        groupMap[sectorId] = {

          id:
            sectorId,

          name:
            stock.sector ||
            sectorId,

          stocks: []
        };
      }


      groupMap[sectorId]
        .stocks
        .push(stock);
    }


    /* =====================================================
       SECTOR RAW DATA
    ===================================================== */

    const sectors = [];


    for (
      const group of
      Object.values(groupMap)
    ) {

      const sectorStocks =
        group.stocks;


      if (!sectorStocks.length) {
        continue;
      }


      const rising =
        sectorStocks.filter(
          stock =>
            num(
              stock.changeRate
            ) > 0
        );


      const falling =
        sectorStocks.filter(
          stock =>
            num(
              stock.changeRate
            ) < 0
        );


      const flat =
        sectorStocks.filter(
          stock =>
            num(
              stock.changeRate
            ) === 0
        );


      const advanceRatio =
        (
          rising.length /
          sectorStocks.length
        ) * 100;


      const averageChangeRate =
        average(
          sectorStocks.map(
            stock =>
              stock.changeRate
          )
        );


      const positiveAverage =
        average(
          rising.map(
            stock =>
              stock.changeRate
          )
        );


      const sectorTradingValue =
        sum(
          sectorStocks.map(
            stock =>
              stock.tradingValue
          )
        );


      const sectorMarketCap =
        sum(
          sectorStocks.map(
            stock =>
              stock.marketCap
          )
        );


      const tradingShare =
        marketTradingValue > 0
          ? (
              sectorTradingValue /
              marketTradingValue
            ) * 100
          : 0;


      /* ===================================================
         LEADERS
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
                round(
                  stock.changeRate
                ),

              tradingValue:
                stock.tradingValue,

              marketCap:
                stock.marketCap,

              sectorSource:
                stock.sectorSource
            })
          );


      sectors.push({

        id:
          group.id,

        name:
          group.name,

        stockCount:
          sectorStocks.length,

        rising:
          rising.length,

        falling:
          falling.length,

        flat:
          flat.length,

        advanceRatio:
          round(
            advanceRatio
          ),

        averageChangeRate:
          round(
            averageChangeRate
          ),

        positiveAverage:
          round(
            positiveAverage
          ),

        tradingValue:
          sectorTradingValue,

        marketCap:
          sectorMarketCap,

        tradingShare:
          round(
            tradingShare
          ),

        leaders
      });
    }


    /* =====================================================
       SCORE ENGINE

       HAN
       -----------------------------------------------------
       현재 주도력

       EARLY
       -----------------------------------------------------
       초기 확산 가능성

       EXHAUSTION
       -----------------------------------------------------
       공세 종료 / 분배 위험

       V1은 당일 snapshot 기반.
       향후 history 기반으로 V2 고도화 가능.
    ===================================================== */

    for (
      const sector of sectors
    ) {

      /* ---------------------------------------------------
         BREADTH
      --------------------------------------------------- */

      const breadthScore =
        clamp(
          sector.advanceRatio
        );


      /* ---------------------------------------------------
         MOMENTUM
      --------------------------------------------------- */

      const momentumScore =
        clamp(
          (
            sector.averageChangeRate +
            1
          ) /
          6 *
          100
        );


      /* ---------------------------------------------------
         LIQUIDITY
      --------------------------------------------------- */

      const liquidityScore =
        clamp(
          (
            sector.tradingShare /
            10
          ) *
          100
        );


      /* ---------------------------------------------------
         HAN SCORE
      --------------------------------------------------- */

      const hanScore =
        clamp(

          breadthScore *
          0.30

          +

          momentumScore *
          0.30

          +

          liquidityScore *
          0.40
        );


      /* ---------------------------------------------------
         EARLY SCORE
      --------------------------------------------------- */

      const earlyScore =
        clamp(

          breadthScore *
          0.35

          +

          momentumScore *
          0.40

          +

          liquidityScore *
          0.25
        );


      /* ===================================================
         EXHAUSTION ENGINE

         핵심 아이디어

         단순히 약한 섹터가 아니라

         "거래대금/주도력이 있었는데
          내부 확산과 모멘텀이 약해지는 섹터"

         를 잡는다.
      =================================================== */


      /* ---------------------------------------------------
         BREADTH WEAKNESS

         상승 종목 비율이 낮을수록 증가
      --------------------------------------------------- */

      const breadthWeakness =
        clamp(
          100 -
          sector.advanceRatio
        );


      /* ---------------------------------------------------
         MOMENTUM WEAKNESS

         현재 가격 모멘텀이 낮을수록 증가
      --------------------------------------------------- */

      const momentumWeakness =
        clamp(
          100 -
          momentumScore
        );


      /* ---------------------------------------------------
         DISTRIBUTION

         거래대금은 몰려있는데
         상승 확산이 약한 경우

         분배 가능성을 높게 본다.
      --------------------------------------------------- */

      const distributionScore =
        clamp(

          liquidityScore *

          (
            breadthWeakness /
            100
          )
        );


      /* ---------------------------------------------------
         EXHAUSTION SCORE

         HAN              20%
         LIQUIDITY        20%
         BREADTH WEAK     25%
         MOMENTUM WEAK    20%
         DISTRIBUTION     15%
      --------------------------------------------------- */

      const exhaustionScore =
        clamp(

          hanScore *
          0.20

          +

          liquidityScore *
          0.20

          +

          breadthWeakness *
          0.25

          +

          momentumWeakness *
          0.20

          +

          distributionScore *
          0.15
        );


      /* ===================================================
         SCORES
      =================================================== */

      sector.scores = {

        han:
          Math.round(
            hanScore
          ),

        early:
          Math.round(
            earlyScore
          ),

        exhaustion:
          Math.round(
            exhaustionScore
          ),

        breadth:
          Math.round(
            breadthScore
          ),

        momentum:
          Math.round(
            momentumScore
          ),

        liquidity:
          Math.round(
            liquidityScore
          ),

        breadthWeakness:
          Math.round(
            breadthWeakness
          ),

        momentumWeakness:
          Math.round(
            momentumWeakness
          ),

        distribution:
          Math.round(
            distributionScore
          )
      };


      /* ===================================================
         STAGE ENGINE
      =================================================== */

      let stage =
        "WATCH";


      if (
        hanScore >= 75 &&
        sector.advanceRatio >= 55
      ) {

        stage =
          "LEADER";

      } else if (
        earlyScore >= 65 &&
        hanScore < 75
      ) {

        stage =
          "EMERGING";

      } else if (
        hanScore >= 55
      ) {

        stage =
          "STRONG";

      } else if (
        sector.averageChangeRate < 0 &&
        sector.advanceRatio < 40
      ) {

        stage =
          "WEAK";
      }


      /* ---------------------------------------------------
         MATURE

         거래대금은 큰데
         확산이 약해지는 상태
      --------------------------------------------------- */

      if (
        sector.tradingShare >= 5 &&
        sector.advanceRatio < 45 &&
        hanScore >= 50
      ) {

        stage =
          "MATURE";
      }


      sector.stage =
        stage;
    }


    /* =====================================================
       SORT BY HAN
    ===================================================== */

    sectors.sort(
      (a, b) => {

        if (
          b.scores.han !==
          a.scores.han
        ) {

          return (
            b.scores.han -
            a.scores.han
          );
        }

        return (
          b.tradingValue -
          a.tradingValue
        );
      }
    );


    /* =====================================================
       CURRENT LEADERS
    ===================================================== */

    const currentLeaders =
      sectors
        .filter(
          sector =>
            sector.stage ===
              "LEADER" ||
            sector.stage ===
              "STRONG"
        )
        .slice(
          0,
          10
        );


    /* =====================================================
       NEXT LEADER RADAR
    ===================================================== */

    const nextLeaderRadar =
      [...sectors]
        .filter(
          sector =>
            sector.stage !==
            "LEADER"
        )
        .sort(
          (a, b) =>
            b.scores.early -
            a.scores.early
        )
        .slice(
          0,
          10
        );


    /* =====================================================
       EXHAUSTION SECTORS

       공세 종료 위험 섹터

       중요한 점:
       그냥 하락하는 약한 섹터를 뽑지 않는다.

       1. 일정 수준의 HAN 또는 Liquidity 존재
       2. Breadth / Momentum 약화
       3. 최소 거래대금 비중 존재
    ===================================================== */

    const exhaustionSectors =
      [...sectors]

        .filter(
          sector => {

            const hadStrength =
              sector.scores.han >= 40 ||
              sector.scores.liquidity >= 35;


            const weakening =
              sector.advanceRatio < 55 ||
              sector.averageChangeRate < 0.5;


            const meaningfulLiquidity =
              sector.tradingShare >= 0.5;


            return (
              hadStrength &&
              weakening &&
              meaningfulLiquidity
            );
          }
        )

        .sort(
          (a, b) =>
            b.scores.exhaustion -
            a.scores.exhaustion
        )

        .slice(
          0,
          10
        );


    /* =====================================================
       PRODUCTION READINESS
    ===================================================== */

    const MIN_STOCK_COVERAGE =
      20;


    const MIN_TRADING_VALUE_COVERAGE =
      60;


    const productionReady =
      stockCoverage >=
        MIN_STOCK_COVERAGE

      &&

      tradingValueCoverage >=
        MIN_TRADING_VALUE_COVERAGE;


    /* =====================================================
       CACHE
    ===================================================== */

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=1800"
    );


    /* =====================================================
       RESPONSE
    ===================================================== */

    return res.status(200).json({

      ok: true,

      version:
        "SECTOR_SCAN_V3_HAN_EARLY_EXHAUSTION",

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


      productionReady,


      coverage: {

        stockCoverage:
          round(
            stockCoverage
          ),

        tradingValueCoverage:
          round(
            tradingValueCoverage
          ),

        minimumStockCoverage:
          MIN_STOCK_COVERAGE,

        minimumTradingValueCoverage:
          MIN_TRADING_VALUE_COVERAGE
      },


      classification: {

        ...classification,

        classifiedTradingValue,

        unclassifiedTradingValue:
          unknownTradingValue
      },


      market: {

        stocks:
          stocks.length,

        classifiedStocks:
          knownStocks.length,

        unclassifiedStocks:
          unknownStocks.length,

        tradingValue:
          marketTradingValue,

        classifiedTradingValue,

        sectors:
          sectors.length
      },


      /* ===================================================
         CURRENT LEADERS
      =================================================== */

      currentLeaders:
        currentLeaders.map(
          sector => ({

            id:
              sector.id,

            name:
              sector.name,

            stage:
              sector.stage,

            han:
              sector.scores.han,

            early:
              sector.scores.early,

            exhaustion:
              sector.scores.exhaustion,

            stockCount:
              sector.stockCount,

            advanceRatio:
              sector.advanceRatio,

            averageChangeRate:
              sector.averageChangeRate,

            tradingShare:
              sector.tradingShare,

            leaders:
              sector.leaders
          })
        ),


      /* ===================================================
         NEXT LEADER RADAR
      =================================================== */

      nextLeaderRadar:
        nextLeaderRadar.map(
          sector => ({

            id:
              sector.id,

            name:
              sector.name,

            stage:
              sector.stage,

            han:
              sector.scores.han,

            early:
              sector.scores.early,

            exhaustion:
              sector.scores.exhaustion,

            stockCount:
              sector.stockCount,

            advanceRatio:
              sector.advanceRatio,

            averageChangeRate:
              sector.averageChangeRate,

            tradingShare:
              sector.tradingShare,

            leaders:
              sector.leaders
          })
        ),


      /* ===================================================
         EXHAUSTION SECTORS
      =================================================== */

      exhaustionSectors:
        exhaustionSectors.map(
          sector => ({

            id:
              sector.id,

            name:
              sector.name,

            stage:
              sector.stage,

            exhaustion:
              sector.scores.exhaustion,

            han:
              sector.scores.han,

            early:
              sector.scores.early,

            breadth:
              sector.scores.breadth,

            momentum:
              sector.scores.momentum,

            liquidity:
              sector.scores.liquidity,

            breadthWeakness:
              sector.scores.breadthWeakness,

            momentumWeakness:
              sector.scores.momentumWeakness,

            distribution:
              sector.scores.distribution,

            stockCount:
              sector.stockCount,

            rising:
              sector.rising,

            falling:
              sector.falling,

            advanceRatio:
              sector.advanceRatio,

            averageChangeRate:
              sector.averageChangeRate,

            tradingShare:
              sector.tradingShare,

            tradingValue:
              sector.tradingValue,

            leaders:
              sector.leaders
          })
        ),


      /* ===================================================
         ALL SECTORS
      =================================================== */

      sectors,


      /* ===================================================
         UNCLASSIFIED
      =================================================== */

      unclassified: {

        count:
          unknownStocks.length,

        tradingValue:
          unknownTradingValue,

        sample:
          unknownStocks
            .slice(
              0,
              30
            )
            .map(
              stock => ({

                code:
                  stock.code,

                name:
                  stock.name,

                market:
                  stock.market,

                tradingValue:
                  stock.tradingValue
              })
            )
      },


      /* ===================================================
         PERFORMANCE
      =================================================== */

      performance: {

        elapsedMs:
          Date.now() -
          startedAt,

        source:
          "MARKET_SNAPSHOT",

        sectorMap:
          "MASTER_PLUS_SAFE_NAME_INFERENCE",

        ranking:
          "HAN_EARLY_EXHAUSTION_V1"
      }
    });


  } catch (error) {

    console.error(
      "SECTOR SCAN V3 ERROR",
      error
    );


    return res.status(500).json({

      ok: false,

      version:
        "SECTOR_SCAN_V3_HAN_EARLY_EXHAUSTION",

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
