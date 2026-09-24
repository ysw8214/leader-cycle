module.exports = async function handler(req, res) {
  try {

    /* ==========================================
       LEADER CYCLE - RANKINGS V3 FAST

       MARKET SCAN
          ↓
       후보 10개
          ↓
       STOCK DETAIL 정밀 분석
          ↓
       ENTRY / LEADER / EARLY / EXHAUSTION

       속도 안정화 버전
       기본 10종목
       5개씩 병렬 처리
    ========================================== */


    /* ==========================================
       BASE URL
    ========================================== */

    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host =
      req.headers.host;

    if (!host) {
      return res.status(500).json({
        ok: false,
        error: "host 정보를 확인할 수 없습니다."
      });
    }

    const baseUrl =
      `${protocol}://${host}`;


    /* ==========================================
       HELPERS
    ========================================== */

    const num = value => {
      const n = Number(value);

      return Number.isFinite(n)
        ? n
        : 0;
    };


    const clamp = (
      value,
      min,
      max
    ) => {
      return Math.max(
        min,
        Math.min(max, value)
      );
    };


    /* ==========================================
       요청 옵션

       기본 = 10개
       최소 = 10개
       최대 = 20개

       일단 안정성을 위해 10개 권장
    ========================================== */

    const requestedLimit =
      parseInt(
        req.query.limit || "10",
        10
      );


    const limit =
      clamp(
        Number.isFinite(requestedLimit)
          ? requestedLimit
          : 10,
        10,
        20
      );


    const requestedDate =
      String(
        req.query.date || ""
      ).trim();


    /* ==========================================
       1. MARKET SCAN
    ========================================== */

    let scanUrl =
      `${baseUrl}/api/market-scan?limit=${limit}`;


    if (
      /^\d{8}$/.test(
        requestedDate
      )
    ) {
      scanUrl +=
        `&date=${encodeURIComponent(
          requestedDate
        )}`;
    }


    const scanResponse =
      await fetch(scanUrl);


    let scan;


    try {

      scan =
        await scanResponse.json();

    } catch (error) {

      return res.status(500).json({
        ok: false,

        error:
          "market-scan 응답을 읽지 못했습니다."
      });

    }


    if (
      !scanResponse.ok ||
      !scan.ok ||
      !Array.isArray(
        scan.candidates
      )
    ) {

      return res.status(500).json({
        ok: false,

        error:
          "market-scan 호출 실패",

        detail:
          scan
      });

    }


    const analysisDate =
      String(
        scan.date ||
        requestedDate ||
        ""
      );


    const candidates =
      scan.candidates.slice(
        0,
        limit
      );


    if (
      candidates.length === 0
    ) {

      return res.status(404).json({
        ok: false,

        error:
          "정밀분석할 후보 종목이 없습니다."
      });

    }


    /* ==========================================
       2. STOCK DETAIL

       후보 종목 하나를
       정밀 분석
    ========================================== */

    async function analyze(
      candidate
    ) {

      try {

        let url =
          `${baseUrl}/api/stock-detail` +
          `?code=${encodeURIComponent(
            candidate.code
          )}`;


        /*
          stock-detail에서 date를
          지원하는 경우를 대비해서 전달

          지원하지 않아도 문제 없음
        */

        if (
          /^\d{8}$/.test(
            analysisDate
          )
        ) {

          url +=
            `&date=${encodeURIComponent(
              analysisDate
            )}`;

        }


        const response =
          await fetch(url);


        let detail;


        try {

          detail =
            await response.json();

        } catch (error) {

          return {
            ok: false,

            code:
              candidate.code,

            name:
              candidate.name,

            market:
              candidate.market ||
              null,

            error:
              `stock-detail JSON 오류 / HTTP ${response.status}`
          };

        }


        if (
          !response.ok ||
          !detail.ok
        ) {

          return {
            ok: false,

            code:
              candidate.code,

            name:
              candidate.name,

            market:
              candidate.market ||
              null,

            error:
              detail?.error ||
              `stock-detail HTTP ${response.status}`
          };

        }


        /* ======================================
           필요한 결과만 저장

           chart 100일 데이터는 rankings에
           다시 넣지 않음
        ====================================== */

        return {

          ok: true,


          /* ----------------------------------
             기본 정보
          ---------------------------------- */

          code:
            detail.code ||
            candidate.code,

          name:
            detail.name ||
            candidate.name,

          market:
            detail.market ||
            candidate.market ||
            null,

          date:
            detail.date ||
            analysisDate,

          price:
            num(
              detail.price
            ),

          changeRate:
            num(
              candidate.changeRate ??
              detail.changeRate
            ),

          discoveryScore:
            num(
              candidate.discoveryScore
            ),

          tradingValue:
            num(
              candidate.tradingValue
            ),

          marketCap:
            num(
              candidate.marketCap
            ),


          /* ----------------------------------
             상태
          ---------------------------------- */

          stage:
            detail.stage ||
            "DISCOVERY",

          entryStatus:
            detail.entryStatus ||
            "WAIT",

          blocked:
            detail.blocked === true,


          /* ----------------------------------
             점수
          ---------------------------------- */

          scores: {

            leader:
              num(
                detail.scores
                  ?.leader
              ),

            early:
              num(
                detail.scores
                  ?.early
              ),

            entry:
              num(
                detail.scores
                  ?.entry
              ),

            exhaustion:
              num(
                detail.scores
                  ?.exhaustion
              )

          },


          /* ----------------------------------
             핵심 신호
          ---------------------------------- */

          signals: {

            alignment:
              detail.signals
                ?.alignment === true,

            ma20Rising:
              detail.signals
                ?.ma20Rising === true,

            ma60Rising:
              detail.signals
                ?.ma60Rising === true,

            ma20To60Gap:
              num(
                detail.signals
                  ?.ma20To60Gap
              ),

            distance20:
              num(
                detail.signals
                  ?.distance20
              ),

            distance60:
              num(
                detail.signals
                  ?.distance60
              ),

            return5:
              num(
                detail.signals
                  ?.return5
              ),

            return10:
              num(
                detail.signals
                  ?.return10
              ),

            return20:
              num(
                detail.signals
                  ?.return20
              ),

            return60:
              num(
                detail.signals
                  ?.return60
              ),

            volumeRatio:
              num(
                detail.signals
                  ?.volumeRatio
              ),

            tradingValueRatio:
              num(
                detail.signals
                  ?.tradingValueRatio
              ),

            breakout20:
              detail.signals
                ?.breakout20 === true

          },


          /* ====================================
             선정 이유
          ==================================== */

          reasons: {

            leader:
              Array.isArray(
                detail.scoreDetail
                  ?.leader
                  ?.reasons
              )
                ? detail.scoreDetail
                    .leader
                    .reasons
                    .slice(0, 4)
                : [],


            early:
              Array.isArray(
                detail.scoreDetail
                  ?.early
                  ?.reasons
              )
                ? detail.scoreDetail
                    .early
                    .reasons
                    .slice(0, 4)
                : [],


            entry:
              Array.isArray(
                detail.scoreDetail
                  ?.entry
                  ?.reasons
              )
                ? detail.scoreDetail
                    .entry
                    .reasons
                    .slice(0, 4)
                : [],


            exhaustion:
              Array.isArray(
                detail.scoreDetail
                  ?.exhaustion
                  ?.reasons
              )
                ? detail.scoreDetail
                    .exhaustion
                    .reasons
                    .slice(0, 4)
                : []

          },


          /* ====================================
             경고
          ==================================== */

          warnings: {

            leader:
              Array.isArray(
                detail.scoreDetail
                  ?.leader
                  ?.warnings
              )
                ? detail.scoreDetail
                    .leader
                    .warnings
                    .slice(0, 3)
                : [],


            early:
              Array.isArray(
                detail.scoreDetail
                  ?.early
                  ?.warnings
              )
                ? detail.scoreDetail
                    .early
                    .warnings
                    .slice(0, 3)
                : [],


            entry:
              Array.isArray(
                detail.scoreDetail
                  ?.entry
                  ?.warnings
              )
                ? detail.scoreDetail
                    .entry
                    .warnings
                    .slice(0, 3)
                : []

          }

        };


      } catch (error) {

        return {

          ok: false,

          code:
            candidate.code,

          name:
            candidate.name,

          market:
            candidate.market ||
            null,

          error:
            String(
              error?.message ||
              error
            )

        };

      }

    }


    /* ==========================================
       3. BATCH 분석

       ★ 중요 ★

       10개 한꺼번에 돌리지 않고
       5개씩 병렬 실행

       서버 부하 감소
    ========================================== */

    const results = [];


    const batchSize = 5;


    for (
      let i = 0;
      i < candidates.length;
      i += batchSize
    ) {

      const batch =
        candidates.slice(
          i,
          i + batchSize
        );


      const batchResults =
        await Promise.all(
          batch.map(
            analyze
          )
        );


      results.push(
        ...batchResults
      );

    }


    /* ==========================================
       4. 성공 / 실패
    ========================================== */

    const analyzed =
      results.filter(
        item =>
          item.ok
      );


    const failed =
      results.filter(
        item =>
          !item.ok
      );


    /* ==========================================
       5. ENTRY STATUS

       최종 상태 재확인
    ========================================== */

    function entryLabel(
      stock
    ) {

      if (
        stock.blocked ||
        stock.scores.exhaustion >= 75
      ) {

        return "BLOCKED";

      }


      if (
        stock.scores.entry >= 80
      ) {

        return "ATTRACTIVE";

      }


      if (
        stock.scores.entry >= 65
      ) {

        return "WATCH";

      }


      if (
        stock.scores.entry >= 50
      ) {

        return "NEUTRAL";

      }


      return "AVOID";

    }


    analyzed.forEach(
      stock => {

        stock.entryStatus =
          entryLabel(
            stock
          );

      }
    );


    /* ==========================================
       6. BUYABLE

       신규매수 후보에서 제외

       BLOCKED
       EXHAUSTION >= 75
       BROKEN
       EXHAUSTING
    ========================================== */

    const buyable =
      analyzed.filter(
        stock => {

          if (
            stock.blocked
          ) {
            return false;
          }


          if (
            stock.scores
              .exhaustion >= 75
          ) {
            return false;
          }


          if (
            stock.stage ===
              "BROKEN" ||

            stock.stage ===
              "EXHAUSTING"
          ) {

            return false;

          }


          return true;

        }
      );


    /* ==========================================
       7. ENTRY RANKING

       지금 산다면?
    ========================================== */

    const entryRanking =
      [...buyable]

        .sort(
          (a, b) => {

            /*
              1순위
              ENTRY SCORE
            */

            if (
              b.scores.entry !==
              a.scores.entry
            ) {

              return (
                b.scores.entry -
                a.scores.entry
              );

            }


            /*
              2순위
              공세소멸 낮은 종목
            */

            if (
              a.scores.exhaustion !==
              b.scores.exhaustion
            ) {

              return (
                a.scores.exhaustion -
                b.scores.exhaustion
              );

            }


            /*
              3순위
              EARLY
            */

            if (
              b.scores.early !==
              a.scores.early
            ) {

              return (
                b.scores.early -
                a.scores.early
              );

            }


            /*
              4순위
              DISCOVERY
            */

            return (
              b.discoveryScore -
              a.discoveryScore
            );

          }
        )

        .slice(
          0,
          10
        );


    /* ==========================================
       8. LEADER RANKING

       현재 실제 주도주
    ========================================== */

    const leaderRanking =
      [...analyzed]

        .filter(
          stock =>

            !stock.blocked &&

            stock.scores
              .exhaustion < 75
        )

        .sort(
          (a, b) => {

            if (
              b.scores.leader !==
              a.scores.leader
            ) {

              return (
                b.scores.leader -
                a.scores.leader
              );

            }


            if (
              a.scores.exhaustion !==
              b.scores.exhaustion
            ) {

              return (
                a.scores.exhaustion -
                b.scores.exhaustion
              );

            }


            return (
              b.discoveryScore -
              a.discoveryScore
            );

          }
        )

        .slice(
          0,
          10
        );


    /* ==========================================
       9. EARLY RANKING

       차기 주도주 후보
    ========================================== */

    const earlyRanking =
      [...buyable]

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


            if (
              b.scores.entry !==
              a.scores.entry
            ) {

              return (
                b.scores.entry -
                a.scores.entry
              );

            }


            if (
              a.scores.exhaustion !==
              b.scores.exhaustion
            ) {

              return (
                a.scores.exhaustion -
                b.scores.exhaustion
              );

            }


            return (
              b.discoveryScore -
              a.discoveryScore
            );

          }
        )

        .slice(
          0,
          10
        );


    /* ==========================================
       10. EXHAUSTION RANKING

       공세 소멸 위험
    ========================================== */

    const exhaustionRanking =
      [...analyzed]

        .filter(
          stock =>
            stock.scores
              .exhaustion >= 25
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
              b.scores.leader -
              a.scores.leader
            );

          }
        )

        .slice(
          0,
          10
        );


    /* ==========================================
       11. TOP PICKS

       사이트 메인 화면에서
       1위 종목 바로 표시 가능
    ========================================== */

    const topPicks = {

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

    };


    /* ==========================================
       12. MARKET COUNT
    ========================================== */

    const kospiCount =
      analyzed.filter(
        stock =>
          stock.market ===
          "KOSPI"
      ).length;


    const kosdaqCount =
      analyzed.filter(
        stock =>
          stock.market ===
          "KOSDAQ"
      ).length;


    /* ==========================================
       CACHE

       30분
    ========================================== */

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=1800, stale-while-revalidate=3600"
    );


    /* ==========================================
       RESPONSE
    ========================================== */

    return res.status(200).json({

      ok: true,


      version:
        "LEADER_CYCLE_RANKINGS_V3_FAST",


      requestedDate:
        requestedDate ||
        null,


      date:
        analysisDate,


      /* ========================================
         통계
      ======================================== */

      stats: {

        marketStocks:
          num(
            scan.market
              ?.totalStocks
          ),

        investableStocks:
          num(
            scan.market
              ?.investableStocks
          ),

        discoveryCandidates:
          candidates.length,

        analyzed:
          analyzed.length,

        failed:
          failed.length,

        buyable:
          buyable.length,

        analyzedMarket: {

          kospi:
            kospiCount,

          kosdaq:
            kosdaqCount,

          total:
            analyzed.length

        }

      },


      /* ========================================
         점수 설명
      ======================================== */

      scoreGuide: {

        discovery:
          "정밀분석 대상을 찾기 위한 1차 시장 탐색 점수",

        leader:
          "현재 실제 주도주로서의 추세·모멘텀·거래활동·지속성을 평가",

        early:
          "아직 과도하게 오르기 전 차기 주도주 전환 가능성을 평가",

        entry:
          "지금 신규 매수할 때의 추세·위치·모멘텀·거래활동을 평가",

        exhaustion:
          "공세 소멸 및 추세 종료 위험. 높을수록 신규매수에 불리"

      },


      /* ========================================
         각 부문 1위
      ======================================== */

      topPicks,


      /* ========================================
         전체 랭킹
      ======================================== */

      entryRanking,

      leaderRanking,

      earlyRanking,

      exhaustionRanking,


      /* ========================================
         실패 종목
      ======================================== */

      failed:
        failed.map(
          item => ({

            code:
              item.code,

            name:
              item.name,

            market:
              item.market,

            error:
              item.error

          })
        )

    });


  } catch (error) {

    console.error(
      "RANKINGS FAST ERROR",
      error
    );


    return res.status(500).json({

      ok: false,

      version:
        "LEADER_CYCLE_RANKINGS_V3_FAST",

      error:
        String(
          error?.message ||
          error
        )

    });

  }
};
