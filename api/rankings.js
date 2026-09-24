module.exports = async function handler(req, res) {
  try {

    /* ==========================================
       LEADER CYCLE - RANKINGS V3 SAFE

       MARKET SCAN
          ↓
       후보 종목
          ↓
       STOCK DETAIL 정밀 분석
          ↓
       ENTRY / LEADER / EARLY / EXHAUSTION

       핵심:
       KRX 동시 호출 폭주 방지를 위해
       2종목씩 분석 + 배치 사이 300ms 대기
    ========================================== */


    /* ==========================================
       기본 설정
    ========================================== */

    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host = req.headers.host;

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
    ) =>
      Math.max(
        min,
        Math.min(max, value)
      );


    const sleep = ms =>
      new Promise(resolve =>
        setTimeout(resolve, ms)
      );


    /* ==========================================
       요청 옵션

       기본 10개

       안정화 확인 후
       15 → 20으로 늘릴 수 있음
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
        5,
        30
      );


    /* ==========================================
       날짜 옵션

       date=20260923 형식 지원
    ========================================== */

    const requestedDate =
      String(
        req.query.date || ""
      ).trim();


    const dateQuery =
      /^\d{8}$/.test(requestedDate)
        ? `&date=${requestedDate}`
        : "";


    /* ==========================================
       1. MARKET SCAN
    ========================================== */

    const scanUrl =
      `${baseUrl}/api/market-scan?limit=${limit}${dateQuery}`;


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
       2. STOCK DETAIL 분석 함수

       한 종목이 실패해도
       전체 rankings는 계속 진행
    ========================================== */

    async function analyze(candidate) {

      try {

        let url =
          `${baseUrl}/api/stock-detail?code=${encodeURIComponent(
            candidate.code
          )}`;


        /*
          market-scan에서 사용한 날짜가 있으면
          같은 날짜를 stock-detail에도 전달 가능

          stock-detail이 date를 지원하지 않아도
          현재 구조에서는 무해함.
        */

        if (
          scan.date &&
          /^\d{8}$/.test(
            String(scan.date)
          )
        ) {

          url +=
            `&date=${encodeURIComponent(
              scan.date
            )}`;

        }


        const response =
          await fetch(url);


        let detail = null;


        try {

          detail =
            await response.json();

        } catch {

          return {
            ok: false,

            code:
              candidate.code,

            name:
              candidate.name,

            market:
              candidate.market || null,

            error:
              `stock-detail JSON 파싱 실패 (HTTP ${response.status})`
          };

        }


        if (!response.ok) {

          return {
            ok: false,

            code:
              candidate.code,

            name:
              candidate.name,

            market:
              candidate.market || null,

            error:
              detail?.error ||
              `stock-detail HTTP ${response.status}`,

            detail:
              detail?.detail || null
          };

        }


        if (!detail?.ok) {

          return {
            ok: false,

            code:
              candidate.code,

            name:
              candidate.name,

            market:
              candidate.market || null,

            error:
              detail?.error ||
              "stock-detail 분석 실패",

            detail:
              detail?.detail || null
          };

        }


        /* ======================================
           rankings에서 필요한 데이터만 사용

           100일 chart 전체를 rankings에
           다시 넣지 않음.
        ====================================== */

        return {

          ok: true,


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
            scan.date ||
            null,


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


          stage:
            detail.stage ||
            "DISCOVERY",


          entryStatus:
            detail.entryStatus ||
            "WAIT",


          blocked:
            detail.blocked === true,


          /* ====================================
             SCORES
          ==================================== */

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


          /* ====================================
             SIGNALS
          ==================================== */

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
            candidate.market || null,

          error:
            String(
              error?.message ||
              error
            )
        };

      }

    }


    /* ==========================================
       3. SAFE BATCH 분석

       ★ 핵심 수정 ★

       기존:
       5종목 동시 분석

       변경:
       2종목 동시 분석

       각 batch 사이
       300ms 대기

       KRX 요청 폭주 방지
    ========================================== */

    const results = [];


    const batchSize = 2;


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


      /*
        마지막 batch가 아니면
        300ms 쉬고 다음 batch 진행
      */

      if (
        i + batchSize <
        candidates.length
      ) {

        await sleep(300);

      }

    }


    /* ==========================================
       4. 성공 / 실패 분리
    ========================================== */

    const analyzed =
      results.filter(
        item => item.ok
      );


    const failed =
      results.filter(
        item => !item.ok
      );


    /* ==========================================
       5. 신규매수 가능 종목

       아래는 제외

       blocked
       exhaustion >= 75
       BROKEN
       EXHAUSTING
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
       ENTRY STATUS 재계산
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
       6. ENTRY RANKING

       지금 신규 진입하기 좋은 종목
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
       7. CURRENT LEADER RANKING
    ========================================== */

    const leaderRanking =
      [...analyzed]

        .filter(stock =>

          !stock.blocked &&

          stock.scores
            .exhaustion < 75

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
       8. NEXT LEADER RANKING
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


          if (
            b.scores.entry !==
            a.scores.entry
          ) {

            return (
              b.scores.entry -
              a.scores.entry
            );

          }


          return (
            b.discoveryScore -
            a.discoveryScore
          );

        })

        .slice(0, 15);


    /* ==========================================
       9. EXHAUSTION RANKING
    ========================================== */

    const exhaustionRanking =
      [...analyzed]

        .filter(
          stock =>
            stock.scores
              .exhaustion >= 25
        )

        .sort(
          (a, b) =>
            b.scores.exhaustion -
            a.scores.exhaustion
        )

        .slice(0, 15);


    /* ==========================================
       10. TOP PICKS

       사이트 메인에서 바로 사용 가능
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
       시장별 분석 성공 개수
    ========================================== */

    const analyzedMarket = {
      kospi: 0,
      kosdaq: 0,
      total:
        analyzed.length
    };


    analyzed.forEach(stock => {

      if (
        stock.market === "KOSPI"
      ) {

        analyzedMarket.kospi++;

      }


      if (
        stock.market === "KOSDAQ"
      ) {

        analyzedMarket.kosdaq++;

      }

    });


    /* ==========================================
       CACHE

       rankings는 30분 캐시
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
        "LEADER_CYCLE_RANKINGS_V3_SAFE",


      requestedDate:
        requestedDate || null,


      date:
        scan.date || null,


      stats: {

        marketStocks:
          scan.market
            ?.totalStocks || 0,


        investableStocks:
          scan.market
            ?.investableStocks || 0,


        discoveryCandidates:
          candidates.length,


        analyzed:
          analyzed.length,


        failed:
          failed.length,


        buyable:
          buyable.length,


        analyzedMarket
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


      topPicks,


      entryRanking,


      leaderRanking,


      earlyRanking,


      exhaustionRanking,


      failed:
        failed.map(item => ({

          code:
            item.code,

          name:
            item.name,

          market:
            item.market || null,

          error:
            item.error,

          detail:
            item.detail || null

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
