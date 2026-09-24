module.exports = async function handler(req, res) {
  const startedAt = Date.now();

  try {
    /* ==========================================
       LEADER CYCLE - RANKINGS V5 QUICK

       목표
       - 기존 market-history / stock-detail 유지
       - rankings만 교체
       - 무한 대기 방지
       - 일부 종목 실패해도 결과 반환
       - 기본 8종목 정밀분석
    ========================================== */

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=1800, stale-while-revalidate=3600"
    );

    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host = req.headers.host;

    if (!host) {
      return res.status(500).json({
        ok: false,
        error: "host 정보를 확인할 수 없습니다."
      });
    }

    const baseUrl = `${protocol}://${host}`;

    /* ==========================================
       HELPERS
    ========================================== */

    function num(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }

    function clamp(value, min, max) {
      return Math.max(
        min,
        Math.min(max, value)
      );
    }

    async function fetchJson(
      url,
      timeoutMs = 8000
    ) {
      const controller =
        new AbortController();

      const timer =
        setTimeout(() => {
          controller.abort();
        }, timeoutMs);

      try {
        const response =
          await fetch(url, {
            signal: controller.signal
          });

        let json = null;

        try {
          json =
            await response.json();
        } catch {
          json = null;
        }

        return {
          ok: response.ok,
          status: response.status,
          json
        };
      } finally {
        clearTimeout(timer);
      }
    }

    /* ==========================================
       OPTIONS

       기본 8개만 정밀분석

       ?limit=10
       식으로 늘릴 수 있음.

       최대 12개까지만 허용.
    ========================================== */

    const requestedLimit =
      parseInt(
        req.query.limit || "8",
        10
      );

    const limit =
      clamp(
        Number.isFinite(requestedLimit)
          ? requestedLimit
          : 8,
        4,
        12
      );

    const requestedDate =
      String(
        req.query.date || ""
      ).trim();

    /* ==========================================
       1. MARKET SCAN

       market-scan 자체는 빠른 전체시장
       스냅샷 기반이므로 그대로 사용.
    ========================================== */

    let scanUrl =
      `${baseUrl}/api/market-scan?limit=${limit}`;

    if (/^\d{8}$/.test(requestedDate)) {
      scanUrl +=
        `&date=${encodeURIComponent(
          requestedDate
        )}`;
    }

    let scanResult;

    try {
      scanResult =
        await fetchJson(
          scanUrl,
          7000
        );
    } catch (error) {
      return res.status(504).json({
        ok: false,
        version:
          "LEADER_CYCLE_RANKINGS_V5_QUICK",
        error:
          "market-scan timeout",
        detail:
          String(
            error?.message || error
          )
      });
    }

    const scan =
      scanResult.json;

    if (
      !scanResult.ok ||
      !scan ||
      !scan.ok ||
      !Array.isArray(scan.candidates)
    ) {
      return res.status(500).json({
        ok: false,
        version:
          "LEADER_CYCLE_RANKINGS_V5_QUICK",
        error:
          "market-scan 호출 실패",
        detail:
          scan
      });
    }

    const candidates =
      scan.candidates
        .slice(0, limit);

    if (!candidates.length) {
      return res.status(200).json({
        ok: true,
        version:
          "LEADER_CYCLE_RANKINGS_V5_QUICK",
        date:
          scan.date || null,

        stats: {
          candidates: 0,
          analyzed: 0,
          failed: 0,
          elapsedMs:
            Date.now() - startedAt
        },

        entryRanking: [],
        leaderRanking: [],
        earlyRanking: [],
        exhaustionRanking: [],
        failed: []
      });
    }

    /* ==========================================
       2. STOCK DETAIL

       핵심:
       개별 종목 최대 8초.

       stock-detail 내부에서
       market-history가 느려져도
       rankings 전체가 무한 대기하지 않음.
    ========================================== */

    async function analyze(candidate) {
      const stockStartedAt =
        Date.now();

      try {
        let url =
          `${baseUrl}/api/stock-detail?code=${encodeURIComponent(
            candidate.code
          )}`;

        /*
          market-scan 날짜와
          stock-detail 날짜 통일.

          stock-detail V3가 date를 지원하면 사용.
        */

        const date =
          scan.date ||
          requestedDate;

        if (
          date &&
          /^\d{8}$/.test(
            String(date)
          )
        ) {
          url +=
            `&date=${encodeURIComponent(
              date
            )}`;
        }

        const result =
          await fetchJson(
            url,
            8000
          );

        const detail =
          result.json;

        if (
          !result.ok ||
          !detail ||
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
              `stock-detail HTTP ${result.status}`,

            elapsedMs:
              Date.now() -
              stockStartedAt
          };
        }

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
              detail.price ||
              candidate.close
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
          },

          elapsedMs:
            Date.now() -
            stockStartedAt
        };

      } catch (error) {
        const timeout =
          error?.name ===
          "AbortError";

        return {
          ok: false,

          code:
            candidate.code,

          name:
            candidate.name,

          error:
            timeout
              ? "stock-detail timeout"
              : String(
                  error?.message ||
                  error
                ),

          elapsedMs:
            Date.now() -
            stockStartedAt
        };
      }
    }

    /* ==========================================
       3. BATCH

       4개씩 병렬.

       기본 8개라면
       총 2 batch.

       최악의 경우에도
       무한 대기하지 않음.
    ========================================== */

    const results = [];

    const batchSize = 4;

    const HARD_LIMIT_MS =
      22000;

    let stoppedEarly =
      false;

    for (
      let i = 0;
      i < candidates.length;
      i += batchSize
    ) {
      /*
        전체 요청 시간이 이미 너무 길면
        남은 후보는 포기하고
        지금까지 결과를 반환.
      */

      if (
        Date.now() -
          startedAt >
        HARD_LIMIT_MS
      ) {
        stoppedEarly = true;
        break;
      }

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
       4. SUCCESS / FAILED
    ========================================== */

    const analyzed =
      results.filter(
        stock => stock.ok
      );

    const failed =
      results.filter(
        stock => !stock.ok
      );

    /*
      HARD LIMIT 때문에
      분석 자체를 시작하지 못한 후보도 표시
    */

    if (
      results.length <
      candidates.length
    ) {
      const untouched =
        candidates.slice(
          results.length
        );

      untouched.forEach(
        candidate => {
          failed.push({
            ok: false,

            code:
              candidate.code,

            name:
              candidate.name,

            error:
              "rankings hard limit"
          });
        }
      );
    }

    /* ==========================================
       5. ENTRY STATUS 재확인
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

    analyzed.forEach(
      stock => {
        stock.entryStatus =
          entryLabel(stock);
      }
    );

    /* ==========================================
       6. BUYABLE
    ========================================== */

    const buyable =
      analyzed.filter(
        stock => {
          if (stock.blocked) {
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
        .slice(0, 10);

    /* ==========================================
       8. LEADER RANKING
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
        .slice(0, 10);

    /* ==========================================
       9. EARLY RANKING
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
        .slice(0, 10);

    /* ==========================================
       10. EXHAUSTION
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
        .slice(0, 10);

    /* ==========================================
       TOP PICKS

       프론트에서 전체 배열을
       다 뒤질 필요 없게 제공.
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
       RESPONSE
    ========================================== */

    return res.status(200).json({
      ok: true,

      version:
        "LEADER_CYCLE_RANKINGS_V5_QUICK",

      date:
        scan.date ||
        null,

      performance: {
        elapsedMs:
          Date.now() -
          startedAt,

        batchSize,

        stockTimeoutMs:
          8000,

        hardLimitMs:
          HARD_LIMIT_MS,

        stoppedEarly
      },

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
          buyable.length
      },

      scoreGuide: {
        discovery:
          "정밀분석 대상을 찾기 위한 1차 시장 탐색 점수",

        leader:
          "현재 실제 주도주로서 추세·모멘텀·거래활동·지속성을 평가",

        early:
          "아직 과도하게 오르기 전 차기 주도주 전환 가능성을 평가",

        entry:
          "현재 가격에서 신규 매수하기 좋은 위치인지 평가",

        exhaustion:
          "공세 소멸 및 추세 종료 위험. 높을수록 신규매수에 불리"
      },

      topPicks,

      entryRanking,

      leaderRanking,

      earlyRanking,

      exhaustionRanking,

      failed:
        failed.map(
          stock => ({
            code:
              stock.code,

            name:
              stock.name,

            error:
              stock.error,

            elapsedMs:
              stock.elapsedMs ||
              null
          })
        )
    });

  } catch (error) {
    console.error(
      "RANKINGS V5 ERROR",
      error
    );

    return res.status(500).json({
      ok: false,

      version:
        "LEADER_CYCLE_RANKINGS_V5_QUICK",

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
