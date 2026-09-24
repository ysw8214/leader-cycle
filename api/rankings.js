module.exports = async function handler(req, res) {
  try {
    /* ==========================================
       LEADER CYCLE - RANKINGS V2

       MARKET SCAN
           ↓
       DISCOVERY 후보
           ↓
       STOCK DETAIL
           ↓
       ENTRY / LEADER / EARLY / EXHAUSTION

       모든 분석 기준일 통일
    ========================================== */

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

    const num = value => {
      const n =
        Number(value);

      return Number.isFinite(n)
        ? n
        : 0;
    };

    const clamp =
      (value, min, max) =>
        Math.max(
          min,
          Math.min(
            max,
            value
          )
        );

    /* ==========================================
       OPTIONS
    ========================================== */

    const requestedDate =
      String(
        req.query.date || ""
      ).trim();

    if (
      requestedDate &&
      !/^\d{8}$/.test(
        requestedDate
      )
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "date는 YYYYMMDD 형식이어야 합니다."
      });
    }

    const requestedLimit =
      parseInt(
        req.query.limit || "20",
        10
      );

    const limit =
      clamp(
        Number.isFinite(
          requestedLimit
        )
          ? requestedLimit
          : 20,
        10,
        30
      );

    /* ==========================================
       1. FAST MARKET SCAN
    ========================================== */

    const scanParams =
      new URLSearchParams({
        limit:
          String(limit)
      });

    if (requestedDate) {
      scanParams.set(
        "date",
        requestedDate
      );
    }

    const scanUrl =
      `${baseUrl}/api/market-scan?${scanParams.toString()}`;

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

    /*
      scan이 실제로 사용한 거래일을
      정밀분석의 기준일로 사용한다.

      date 미지정 시에도
      market-scan이 찾아낸 최근 거래일과
      stock-detail 기준일이 일치한다.
    */

    const analysisDate =
      String(
        scan.date ||
        requestedDate ||
        ""
      );

    if (
      !/^\d{8}$/.test(
        analysisDate
      )
    ) {
      return res.status(500).json({
        ok: false,
        error:
          "분석 기준 거래일을 확인할 수 없습니다."
      });
    }

    const candidates =
      scan.candidates.slice(
        0,
        limit
      );

    /* ==========================================
       2. STOCK DETAIL
    ========================================== */

    async function analyze(
      candidate
    ) {
      try {
        const params =
          new URLSearchParams({
            code:
              String(
                candidate.code
              ),

            date:
              analysisDate
          });

        const url =
          `${baseUrl}/api/stock-detail?${params.toString()}`;

        const response =
          await fetch(url);

        let detail;

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

            error:
              `stock-detail 응답 파싱 실패 (${response.status})`
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

            error:
              detail?.error ||
              `stock-detail HTTP ${response.status}`
          };
        }

        return {
          ok: true,

          code:
            detail.code,

          name:
            detail.name ||
            candidate.name,

          market:
            detail.market ||
            candidate.market ||
            null,

          date:
            detail.date,

          price:
            num(
              detail.price
            ),

          changeRate:
            num(
              candidate.changeRate
            ),

          discoveryScore:
            num(
              candidate.discoveryScore
            ),

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

          signals: {
            alignment:
              detail.signals
                ?.alignment ===
              true,

            ma20Rising:
              detail.signals
                ?.ma20Rising ===
              true,

            ma60Rising:
              detail.signals
                ?.ma60Rising ===
              true,

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
                ?.breakout20 ===
              true
          },

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
       3. BATCH ANALYSIS

       5종목 병렬
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

    const analyzed =
      results.filter(
        result =>
          result.ok
      );

    const failed =
      results.filter(
        result =>
          !result.ok
      );

    /* ==========================================
       ENTRY 가능 종목
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
       ENTRY
    ========================================== */

    const entryRanking =
      [...buyable]
        .sort(
          (a, b) => {
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
              a.scores
                .exhaustion !==
              b.scores
                .exhaustion
            ) {
              return (
                a.scores
                  .exhaustion -
                b.scores
                  .exhaustion
              );
            }

            return (
              b.scores.leader -
              a.scores.leader
            );
          }
        )
        .slice(0, 15);

    /* ==========================================
       LEADER
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

            return (
              a.scores
                .exhaustion -
              b.scores
                .exhaustion
            );
          }
        )
        .slice(0, 15);

    /* ==========================================
       EARLY
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

            return (
              b.scores.entry -
              a.scores.entry
            );
          }
        )
        .slice(0, 15);

    /* ==========================================
       EXHAUSTION
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
            b.scores
              .exhaustion -
            a.scores
              .exhaustion
        )
        .slice(0, 15);

    /* ==========================================
       ENTRY STATUS
    ========================================== */

    function entryLabel(
      stock
    ) {
      if (
        stock.blocked ||
        stock.scores
          .exhaustion >= 75
      ) {
        return "BLOCKED";
      }

      if (
        stock.scores
          .entry >= 80
      ) {
        return "ATTRACTIVE";
      }

      if (
        stock.scores
          .entry >= 65
      ) {
        return "WATCH";
      }

      if (
        stock.scores
          .entry >= 50
      ) {
        return "NEUTRAL";
      }

      return "AVOID";
    }

    analyzed.forEach(
      stock => {
        stock.entryStatus =
          entryLabel(stock);
      }
    );

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
        "LEADER_CYCLE_RANKINGS_V2",

      requestedDate:
        requestedDate || null,

      date:
        analysisDate,

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
        failed.map(
          item => ({
            code:
              item.code,

            name:
              item.name,

            error:
              item.error
          })
        )
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
