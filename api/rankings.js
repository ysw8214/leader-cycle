module.exports = async function handler(req, res) {
  try {

    /* ==========================================
       LEADER CYCLE - RANKINGS v1

       FAST SCAN
          ↓
       후보 종목
          ↓
       STOCK DETAIL 정밀 분석
          ↓
       ENTRY / LEADER / EARLY / EXHAUSTION
    ========================================== */

    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host = req.headers.host;

    const baseUrl =
      `${protocol}://${host}`;


    /* ==========================================
       HELPERS
    ========================================== */

    const num = value => {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    };

    const clamp = (value, min, max) =>
      Math.max(min, Math.min(max, value));


    /* ==========================================
       요청 옵션

       기본 후보 20개 정밀분석

       처음부터 30개 전부 분석하지 않는 이유:
       서버리스 실행시간 보호

       나중에 충분히 빠르면 확대 가능
    ========================================== */

    const requestedLimit =
      parseInt(
        req.query.limit || "20",
        10
      );

    const limit =
      clamp(
        Number.isFinite(requestedLimit)
          ? requestedLimit
          : 20,
        10,
        30
      );


    /* ==========================================
       1. FAST MARKET SCAN
    ========================================== */

    const scanUrl =
      `${baseUrl}/api/market-scan?limit=${limit}`;

    const scanResponse =
      await fetch(scanUrl);

    let scan;

    try {
      scan =
        await scanResponse.json();
    } catch {
      return res.status(500).json({
        ok: false,
        error:
          "market-scan 응답을 읽지 못했습니다."
      });
    }


    if (
      !scanResponse.ok ||
      !scan.ok ||
      !Array.isArray(scan.candidates)
    ) {

      return res.status(500).json({
        ok: false,
        error:
          "market-scan 호출 실패",
        detail: scan
      });
    }


    const candidates =
      scan.candidates.slice(
        0,
        limit
      );


    /* ==========================================
       2. STOCK DETAIL 호출

       한 종목 실패해도
       전체 rankings는 계속 진행
    ========================================== */

    async function analyze(candidate) {

      try {

        const url =
          `${baseUrl}/api/stock-detail?code=${encodeURIComponent(candidate.code)}`;

        const response =
          await fetch(url);

        if (!response.ok) {

          return {
            ok: false,

            code:
              candidate.code,

            name:
              candidate.name,

            error:
              `stock-detail HTTP ${response.status}`
          };
        }


        const detail =
          await response.json();


        if (!detail.ok) {

          return {
            ok: false,

            code:
              candidate.code,

            name:
              candidate.name,

            error:
              detail.error ||
              "stock-detail 분석 실패"
          };
        }


        /* ======================================
           필요한 데이터만 압축

           chart 100개는 rankings에 넣지 않음.
           응답 크기 + 속도 개선.
        ====================================== */

        return {

          ok: true,

          code:
            detail.code,

          name:
            detail.name ||
            candidate.name,

          date:
            detail.date,

          price:
            num(detail.price),

          changeRate:
            num(candidate.changeRate),

          discoveryScore:
            num(candidate.discoveryScore),

          stage:
            detail.stage ||
            "DISCOVERY",

          entryStatus:
            detail.entryStatus ||
            "WAIT",

          blocked:
            detail.blocked === true,


          scores: {

            leader:
              num(
                detail.scores?.leader
              ),

            early:
              num(
                detail.scores?.early
              ),

            entry:
              num(
                detail.scores?.entry
              ),

            exhaustion:
              num(
                detail.scores?.exhaustion
              )
          },


          signals: {

            alignment:
              detail.signals?.alignment === true,

            ma20Rising:
              detail.signals?.ma20Rising === true,

            ma60Rising:
              detail.signals?.ma60Rising === true,

            ma20To60Gap:
              num(
                detail.signals?.ma20To60Gap
              ),

            distance20:
              num(
                detail.signals?.distance20
              ),

            return5:
              num(
                detail.signals?.return5
              ),

            return20:
              num(
                detail.signals?.return20
              ),

            return60:
              num(
                detail.signals?.return60
              ),

            volumeRatio:
              num(
                detail.signals?.volumeRatio
              ),

            tradingValueRatio:
              num(
                detail.signals?.tradingValueRatio
              ),

            breakout20:
              detail.signals?.breakout20 === true
          },


          /* ====================================
             사이트에서 바로 보여줄 선정 이유
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

       5개씩 병렬 실행
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
          batch.map(analyze)
        );


      results.push(
        ...batchResults
      );
    }


    /* ==========================================
       성공 / 실패 분리
    ========================================== */

    const analyzed =
      results.filter(
        x => x.ok
      );


    const failed =
      results.filter(
        x => !x.ok
      );


    /* ==========================================
       4. 신규매수 가능 여부

       공세소멸 75 이상은 무조건 제외

       BROKEN / EXHAUSTING도 제외
    ========================================== */

    const buyable =
      analyzed.filter(stock => {

        if (stock.blocked) {
          return false;
        }

        if (
          stock.scores.exhaustion >= 75
        ) {
          return false;
        }

        if (
          stock.stage === "BROKEN" ||
          stock.stage === "EXHAUSTING"
        ) {
          return false;
        }

        return true;
      });


    /* ==========================================
       5. ENTRY RANKING

       "오늘 신규 진입한다면?"

       가장 중요한 실제 매수 후보 랭킹
    ========================================== */

    const entryRanking =
      [...buyable]
        .sort((a, b) => {

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
            b.scores.leader -
            a.scores.leader
          );
        })
        .slice(0, 15);


    /* ==========================================
       6. CURRENT LEADERS

       현재 실제 주도주

       단순 Leader Score만 높은 게 아니라
       공세 소멸 위험도 함께 확인
    ========================================== */

    const leaderRanking =
      [...analyzed]
        .filter(stock =>
          !stock.blocked &&
          stock.scores.exhaustion < 75
        )
        .sort((a, b) => {

          if (
            b.scores.leader !==
            a.scores.leader
          ) {
            return (
              b.scores.leader -
              a.scores.leader
            );
          }

          return (
            a.scores.exhaustion -
            b.scores.exhaustion
          );
        })
        .slice(0, 15);


    /* ==========================================
       7. NEXT LEADER

       차기 주도주 후보

       이미 완전히 성숙한 종목보다
       EARLY가 강한 종목 우선
    ========================================== */

    const earlyRanking =
      [...buyable]
        .sort((a, b) => {

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
            b.scores.entry -
            a.scores.entry
          );
        })
        .slice(0, 15);


    /* ==========================================
       8. EXHAUSTION

       공세 소멸 위험 종목

       높을수록 신규매수에 불리
    ========================================== */

    const exhaustionRanking =
      [...analyzed]
        .filter(
          stock =>
            stock.scores.exhaustion >= 25
        )
        .sort(
          (a, b) =>
            b.scores.exhaustion -
            a.scores.exhaustion
        )
        .slice(0, 15);


    /* ==========================================
       9. ENTRY 상태 설명
    ========================================== */

    function entryLabel(stock) {

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


    analyzed.forEach(stock => {

      stock.entryStatus =
        entryLabel(stock);

    });


    /* ==========================================
       CACHE

       정밀분석 결과는 30분 캐시
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
        "LEADER_CYCLE_RANKINGS_V1",

      date:
        scan.date,

      stats: {

        marketStocks:
          scan.market?.totalStocks || 0,

        discoveryCandidates:
          candidates.length,

        analyzed:
          analyzed.length,

        failed:
          failed.length,

        buyable:
          buyable.length
      },


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


      entryRanking,

      leaderRanking,

      earlyRanking,

      exhaustionRanking,


      failed:
        failed.map(x => ({
          code: x.code,
          name: x.name,
          error: x.error
        }))
    });


  } catch (error) {

    console.error(
      "RANKINGS ERROR",
      error
    );


    return res.status(500).json({

      ok: false,

      error:
        String(
          error?.message ||
          error
        )

    });

  }
};
