/* =========================================================
   LEADER CYCLE - SECTOR SCANNER V4
   SECTOR CYCLE ENGINE

   FLOW
   ---------------------------------------------------------
   MARKET SNAPSHOT
      ↓
   SECTOR MAP
      ↓
   HAN / EARLY / EXHAUST
      ↓
   7-STAGE SECTOR CYCLE
      ↓
   CURRENT / NEXT / EXHAUSTION

   CYCLE
   ---------------------------------------------------------
   🌱 초기 포착
   🚀 주도 진입
   🔥 주도 확산
   👑 주도 정점
   ⚠️ 소진 경고
   🔻 주도 이탈
   ⚪ 관망

   IMPORTANT
   ---------------------------------------------------------
   market-snapshot.js 수정 없음
   sector-map.js 수정 없음
   rankings.js 수정 없음
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


    function clamp(
      value,
      min = 0,
      max = 100
    ) {

      return Math.max(
        min,
        Math.min(
          max,
          num(value)
        )
      );
    }


    function round(
      value,
      digits = 2
    ) {

      const n =
        num(value);

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
          .filter(
            Number.isFinite
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
        req.headers[
          "x-forwarded-proto"
        ] ||
        "https"
      )
        .split(",")[0]
        .trim();


    const host =
      String(
        req.headers[
          "x-forwarded-host"
        ] ||
        req.headers.host ||
        ""
      )
        .split(",")[0]
        .trim();


    if (!host) {

      return res
        .status(500)
        .json({

          ok: false,

          version:
            "SECTOR_SCAN_V4_CYCLE",

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


    if (
      /^\d{8}$/.test(
        requestedDate
      )
    ) {

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

      return res
        .status(502)
        .json({

          ok: false,

          version:
            "SECTOR_SCAN_V4_CYCLE",

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

      return res
        .status(502)
        .json({

          ok: false,

          version:
            "SECTOR_SCAN_V4_CYCLE",

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

      return res
        .status(502)
        .json({

          ok: false,

          version:
            "SECTOR_SCAN_V4_CYCLE",

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
      Array.isArray(
        snapshot.stocks
      )
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

      return res
        .status(502)
        .json({

          ok: false,

          version:
            "SECTOR_SCAN_V4_CYCLE",

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
          stock.sectorClassified ===
          true
      );


    const unknownStocks =
      classifiedStocks.filter(
        stock =>
          stock.sectorClassified !==
          true
      );


    /* =====================================================
       MARKET TOTAL
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
       GROUP STOCKS
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


      groupMap[
        sectorId
      ].stocks.push(
        stock
      );
    }


    /* =====================================================
       BUILD SECTORS
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
       SCORE + CYCLE ENGINE
    ===================================================== */

    for (
      const sector of sectors
    ) {

      /* ===================================================
         BREADTH
      =================================================== */

      const breadthScore =
        clamp(
          sector.advanceRatio
        );


      /* ===================================================
         MOMENTUM
      =================================================== */

      const momentumScore =
        clamp(
          (
            sector.averageChangeRate +
            1
          ) /
          6 *
          100
        );


      /* ===================================================
         LIQUIDITY

         시장 거래대금 10% = 100점
      =================================================== */

      const liquidityScore =
        clamp(
          (
            sector.tradingShare /
            10
          ) *
          100
        );


      /* ===================================================
         HAN
         현재 주도력
      =================================================== */

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


      /* ===================================================
         EARLY
         선행 확산 신호
      =================================================== */

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
         EXHAUSTION

         중요:
         단순히 HAN이 높다고 소진이 아니다.

         1. 거래대금 집중
         2. breadth 둔화
         3. 평균 상승률 과열
         4. 소수 종목 집중

         을 조합한다.
      =================================================== */

      const breadthWeakness =
        clamp(
          (
            60 -
            sector.advanceRatio
          ) * 2
        );


      const momentumHeat =
        clamp(
          Math.max(
            0,
            sector.averageChangeRate -
            1
          ) * 20
        );


      const liquidityHeat =
        clamp(
          sector.tradingShare *
          2
        );


      const concentrationScore =
        sector.stockCount > 0
          ? clamp(
              (
                5 /
                sector.stockCount
              ) * 100
            )
          : 0;


      const exhaustionScore =
        clamp(

          breadthWeakness *
          0.35

          +

          momentumHeat *
          0.20

          +

          liquidityHeat *
          0.30

          +

          concentrationScore *
          0.15
        );


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
          )
      };


      /* ===================================================
         7-STAGE CYCLE ENGINE

         stageCode는 프론트/UI 안정성을 위해
         영문 고정값.

         stageLabel은 사람이 보는 문구.
      =================================================== */

      let stageCode =
        "WATCH";

      let stageLabel =
        "⚪ 관망";

      let stageDescription =
        "뚜렷한 주도 신호가 아직 없습니다.";

      let cycleProgress =
        10;


      /* ---------------------------------------------------
         1. LEADERSHIP EXIT

         이미 힘이 꺾인 상태.
      --------------------------------------------------- */

      if (
        exhaustionScore >= 70 &&
        (
          sector.advanceRatio < 40 ||
          sector.averageChangeRate < 0
        )
      ) {

        stageCode =
          "EXIT";

        stageLabel =
          "🔻 주도 이탈";

        stageDescription =
          "주도력이 약화되고 상승 확산이 무너지는 구간입니다.";

        cycleProgress =
          100;
      }


      /* ---------------------------------------------------
         2. EXHAUSTION WARNING

         아직 상승하고 있을 수도 있지만
         위험도가 높은 상태.
      --------------------------------------------------- */

      else if (
        exhaustionScore >= 65 &&
        hanScore >= 50
      ) {

        stageCode =
          "EXHAUSTION";

        stageLabel =
          "⚠️ 소진 경고";

        stageDescription =
          "주도력은 남아 있지만 과열·집중 위험이 높아지고 있습니다.";

        cycleProgress =
          88;
      }


      /* ---------------------------------------------------
         3. LEADERSHIP PEAK
      --------------------------------------------------- */

      else if (
        hanScore >= 65 &&
        exhaustionScore >= 45
      ) {

        stageCode =
          "PEAK";

        stageLabel =
          "👑 주도 정점";

        stageDescription =
          "강한 주도 구간이지만 소진 신호가 점차 증가하고 있습니다.";

        cycleProgress =
          74;
      }


      /* ---------------------------------------------------
         4. LEADERSHIP EXPANSION
      --------------------------------------------------- */

      else if (
        hanScore >= 65 &&
        sector.advanceRatio >= 55
      ) {

        stageCode =
          "EXPANSION";

        stageLabel =
          "🔥 주도 확산";

        stageDescription =
          "거래대금과 상승 종목이 함께 확산되는 핵심 주도 구간입니다.";

        cycleProgress =
          58;
      }


      /* ---------------------------------------------------
         5. LEADERSHIP ENTRY
      --------------------------------------------------- */

      else if (
        hanScore >= 55 &&
        earlyScore >= 55
      ) {

        stageCode =
          "LEADERSHIP_ENTRY";

        stageLabel =
          "🚀 주도 진입";

        stageDescription =
          "선행 신호가 실제 주도력으로 연결되기 시작하고 있습니다.";

        cycleProgress =
          42;
      }


      /* ---------------------------------------------------
         6. EARLY DETECTION
      --------------------------------------------------- */

      else if (
        earlyScore >= 50 &&
        sector.advanceRatio >= 45
      ) {

        stageCode =
          "EARLY";

        stageLabel =
          "🌱 초기 포착";

        stageDescription =
          "상승 확산과 모멘텀이 생기기 시작한 차기 주도 후보입니다.";

        cycleProgress =
          25;
      }


      /* ---------------------------------------------------
         7. WATCH
      --------------------------------------------------- */

      else {

        stageCode =
          "WATCH";

        stageLabel =
          "⚪ 관망";

        stageDescription =
          "아직 주도 사이클 진입 조건이 충분하지 않습니다.";

        cycleProgress =
          10;
      }


      /* ===================================================
         CYCLE STRENGTH

         0~100
         현재 섹터 자체의 매력도.

         cycleProgress와 다른 값이다.

         progress = 사이클 어디쯤인가
         strength = 지금 얼마나 강한가
      =================================================== */

      const cycleStrength =
        clamp(

          hanScore *
          0.45

          +

          earlyScore *
          0.30

          +

          breadthScore *
          0.15

          +

          momentumScore *
          0.10

          -

          exhaustionScore *
          0.20
        );


      /* ===================================================
         ACTION LABEL
      =================================================== */

      let action =
        "관망";


      if (
        stageCode ===
        "EARLY"
      ) {

        action =
          "선행 관찰";

      } else if (
        stageCode ===
        "LEADERSHIP_ENTRY"
      ) {

        action =
          "적극 관찰";

      } else if (
        stageCode ===
        "EXPANSION"
      ) {

        action =
          "핵심 주도";

      } else if (
        stageCode ===
        "PEAK"
      ) {

        action =
          "추격 주의";

      } else if (
        stageCode ===
        "EXHAUSTION"
      ) {

        action =
          "신규 진입 주의";

      } else if (
        stageCode ===
        "EXIT"
      ) {

        action =
          "회피";
      }


      sector.stage =
        stageCode;

      sector.stageCode =
        stageCode;

      sector.stageLabel =
        stageLabel;

      sector.stageDescription =
        stageDescription;

      sector.action =
        action;

      sector.cycleProgress =
        Math.round(
          cycleProgress
        );

      sector.cycleStrength =
        Math.round(
          cycleStrength
        );
    }


    /* =====================================================
       MAIN SORT
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

       주도 진입 ~ 정점
       소진 경고는 별도 분리
    ===================================================== */

    const currentLeaders =
      sectors
        .filter(
          sector =>
            [
              "LEADERSHIP_ENTRY",
              "EXPANSION",
              "PEAK"
            ].includes(
              sector.stageCode
            )
        )
        .sort(
          (a, b) => {

            if (
              b.cycleStrength !==
              a.cycleStrength
            ) {

              return (
                b.cycleStrength -
                a.cycleStrength
              );
            }

            return (
              b.scores.han -
              a.scores.han
            );
          }
        )
        .slice(
          0,
          10
        );


    /* =====================================================
       NEXT LEADER RADAR

       아직 주도 정점/소진에 간 섹터 제외.
    ===================================================== */

    const nextLeaderRadar =
      sectors
        .filter(
          sector =>
            [
              "EARLY",
              "LEADERSHIP_ENTRY",
              "WATCH"
            ].includes(
              sector.stageCode
            )
        )
        .sort(
          (a, b) => {

            if (
              b.scores.early !==
              a.scores.early
            ) {

              return (
                b.scores.early -
                a.scores.early
              );
            }

            return (
              b.cycleStrength -
              a.cycleStrength
            );
          }
        )
        .slice(
          0,
          10
        );


    /* =====================================================
       EXHAUSTION WATCH

       이번 버전 핵심.

       단순 EXHAUSTION 점수순이 아니라
       실제 후반 사이클만 보여준다.
    ===================================================== */

    const exhaustionRadar =
      sectors
        .filter(
          sector =>
            [
              "PEAK",
              "EXHAUSTION",
              "EXIT"
            ].includes(
              sector.stageCode
            )
        )
        .sort(
          (a, b) => {

            if (
              b.scores.exhaustion !==
              a.scores.exhaustion
            ) {

              return (
                b.scores.exhaustion -
                a.scores.exhaustion
              );
            }

            return (
              b.scores.han -
              a.scores.han
            );
          }
        )
        .slice(
          0,
          10
        );


    /* =====================================================
       COUNTS
    ===================================================== */

    const cycleCounts = {

      early:
        sectors.filter(
          sector =>
            sector.stageCode ===
            "EARLY"
        ).length,

      leadershipEntry:
        sectors.filter(
          sector =>
            sector.stageCode ===
            "LEADERSHIP_ENTRY"
        ).length,

      expansion:
        sectors.filter(
          sector =>
            sector.stageCode ===
            "EXPANSION"
        ).length,

      peak:
        sectors.filter(
          sector =>
            sector.stageCode ===
            "PEAK"
        ).length,

      exhaustion:
        sectors.filter(
          sector =>
            sector.stageCode ===
            "EXHAUSTION"
        ).length,

      exit:
        sectors.filter(
          sector =>
            sector.stageCode ===
            "EXIT"
        ).length,

      watch:
        sectors.filter(
          sector =>
            sector.stageCode ===
            "WATCH"
        ).length
    };


    /* =====================================================
       RESPONSE MAPPER
    ===================================================== */

    function publicSector(
      sector
    ) {

      return {

        id:
          sector.id,

        name:
          sector.name,

        stage:
          sector.stage,

        stageCode:
          sector.stageCode,

        stageLabel:
          sector.stageLabel,

        stageDescription:
          sector.stageDescription,

        action:
          sector.action,

        cycleProgress:
          sector.cycleProgress,

        cycleStrength:
          sector.cycleStrength,

        han:
          sector.scores.han,

        early:
          sector.scores.early,

        exhaustion:
          sector.scores.exhaustion,

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

        tradingValue:
          sector.tradingValue,

        tradingShare:
          sector.tradingShare,

        leaders:
          sector.leaders
      };
    }


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

    return res
      .status(200)
      .json({

        ok: true,

        version:
          "SECTOR_SCAN_V4_7_STAGE_CYCLE",

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


        cycleConfig: {

          stages: [

            {
              code:
                "EARLY",

              label:
                "🌱 초기 포착",

              progress:
                25
            },

            {
              code:
                "LEADERSHIP_ENTRY",

              label:
                "🚀 주도 진입",

              progress:
                42
            },

            {
              code:
                "EXPANSION",

              label:
                "🔥 주도 확산",

              progress:
                58
            },

            {
              code:
                "PEAK",

              label:
                "👑 주도 정점",

              progress:
                74
            },

            {
              code:
                "EXHAUSTION",

              label:
                "⚠️ 소진 경고",

              progress:
                88
            },

            {
              code:
                "EXIT",

              label:
                "🔻 주도 이탈",

              progress:
                100
            }
          ]
        },


        cycleCounts,


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


        currentLeaders:
          currentLeaders.map(
            publicSector
          ),


        nextLeaderRadar:
          nextLeaderRadar.map(
            publicSector
          ),


        exhaustionRadar:
          exhaustionRadar.map(
            publicSector
          ),


        sectors:
          sectors.map(
            publicSector
          ),


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


        performance: {

          elapsedMs:
            Date.now() -
            startedAt,

          source:
            "MARKET_SNAPSHOT",

          sectorMap:
            "MASTER_PLUS_SAFE_NAME_INFERENCE",

          ranking:
            "HAN_EARLY_EXHAUSTION_7_STAGE_CYCLE"
        }
      });


  } catch (error) {

    console.error(
      "SECTOR SCAN V4 ERROR",
      error
    );


    return res
      .status(500)
      .json({

        ok: false,

        version:
          "SECTOR_SCAN_V4_CYCLE",

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
